"""Receipt image storage (AGENTS.md §7.1 step 1, SRS 3.5.4).

- `SupabaseStorage` (production): a PRIVATE Supabase Storage bucket, reached only from the
  backend with the service-role (legacy JWT) or secret (`sb_secret_…`) key. Objects live at
  `{user_id}/{receipt_id}.{ext}`; the app never gets the key and only ever sees short-lived
  signed URLs for its own receipts.
- `LocalStorage` (development only): files under RECEIPT_LOCAL_DIR. No URLs are served.

Both adapters refuse any object name that isn't `{uuid}/{uuid}.{jpg|png|webp}` (no traversal,
no other prefixes), never overwrite an object (`put` raises ObjectExists instead) and treat a
missing object as already deleted.
"""

import base64
import json
import logging
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal, Protocol
from urllib.parse import quote

import httpx
from fastapi import Request

from app.core.config import settings
from app.core.errors import ApiError

logger = logging.getLogger(__name__)

SIGNED_URL_SECONDS = 600
TIMEOUT_SECONDS = 20


LIST_PAGE = 100

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# The only object names receipts ever create: {user_id}/{receipt_id}.{ext} (see upload).
# New uploads are always .jpg (images.sanitize); png/webp remain valid for older objects.
RECEIPT_PATH = re.compile(rf"{_UUID}/{_UUID}\.(jpg|png|webp)")


def is_receipt_path(path: str) -> bool:
    return RECEIPT_PATH.fullmatch(path) is not None


class StorageUnavailable(Exception):
    """Storage couldn't be reached or refused the request."""


class ObjectExists(Exception):
    """`put` found an object already stored under that name (nothing was changed)."""


class InvalidObjectPath(ValueError):
    """An object name that receipts never create (refused before any request is made)."""


def check_path(path: str) -> str:
    if not is_receipt_path(path):
        raise InvalidObjectPath("not a receipt image path")
    return path


@dataclass(frozen=True)
class StoredObject:
    path: str
    # When the storage service stored it (server time, not the client's).
    created_at: datetime


class ReceiptStorage(Protocol):
    def put(self, path: str, data: bytes, content_type: str) -> None: ...
    def get(self, path: str) -> bytes | None: ...
    def delete(self, path: str) -> None: ...
    def signed_url(self, path: str) -> str | None: ...
    def list_objects(self) -> Iterator[StoredObject]: ...


# ---------- credentials ----------

KeyKind = Literal["legacy_service_role", "secret"]


def service_key_kind(key: str) -> KeyKind | None:
    """Which kind of backend key this is, without ever revealing it. None for anything that
    must not be used for storage (anon/publishable keys, user tokens, garbage)."""
    key = key.strip()
    if key.startswith("sb_secret_") and len(key) > len("sb_secret_"):
        return "secret"
    parts = key.split(".")
    if len(parts) == 3:
        try:
            padded = parts[1] + "=" * (-len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(padded))
        except (ValueError, TypeError):
            return None
        if isinstance(claims, dict) and claims.get("role") == "service_role":
            return "legacy_service_role"
    return None


# ---------- Supabase ----------


class SupabaseStorage:
    def __init__(
        self,
        supabase_url: str,
        service_key: str,
        bucket: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base = f"{supabase_url.rstrip('/')}/storage/v1"
        self.bucket = bucket
        # Both key kinds are sent the way supabase-js sends them: the gateway accepts a
        # secret key in `Authorization: Bearer` when it matches `apikey`.
        self._client = httpx.Client(
            base_url=self.base,
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=TIMEOUT_SECONDS,
            transport=transport,
        )

    def _object(self, path: str) -> str:
        return f"/object/{quote(self.bucket)}/{quote(check_path(path))}"

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:  # noqa: ANN003
        try:
            return self._client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("Storage request failed: %s", exc.__class__.__name__)
            raise StorageUnavailable from exc

    def _send(self, method: str, url: str, **kwargs) -> httpx.Response:  # noqa: ANN003
        response = self._request(method, url, **kwargs)
        if response.status_code >= 400:
            # Never log the body or headers: they can echo the key or a signed URL.
            logger.warning("Storage %s returned %s", method, response.status_code)
            raise StorageUnavailable(f"storage returned {response.status_code}")
        return response

    def put(self, path: str, data: bytes, content_type: str) -> None:
        response = self._request(
            "POST",
            self._object(path),
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "false"},
        )
        if _is_duplicate(response):
            raise ObjectExists
        if response.status_code >= 400:
            logger.warning("Storage POST returned %s", response.status_code)
            raise StorageUnavailable(f"storage returned {response.status_code}")

    def get(self, path: str) -> bytes | None:
        response = self._request("GET", self._object(path))
        if _is_not_found(response):
            return None
        if response.status_code >= 400:
            logger.warning("Storage GET returned %s", response.status_code)
            raise StorageUnavailable(f"storage returned {response.status_code}")
        return response.content

    def delete(self, path: str) -> None:
        response = self._request("DELETE", self._object(path))
        if _is_not_found(response):
            return  # already gone
        if response.status_code >= 400:
            logger.warning("Storage DELETE returned %s", response.status_code)
            raise StorageUnavailable(f"storage returned {response.status_code}")

    def signed_url(self, path: str) -> str | None:
        response = self._send(
            "POST",
            f"/object/sign/{quote(self.bucket)}/{quote(check_path(path))}",
            json={"expiresIn": SIGNED_URL_SECONDS},
        )
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        return f"{self.base}{signed}" if signed else None

    def _list(self, prefix: str) -> Iterator[dict]:
        offset = 0
        while True:
            page = self._send(
                "POST",
                f"/object/list/{quote(self.bucket)}",
                json={
                    "prefix": prefix,
                    "limit": LIST_PAGE,
                    "offset": offset,
                    # A fixed order keeps offset pages stable while nothing changes.
                    "sortBy": {"column": "name", "order": "asc"},
                },
            ).json()
            yield from page
            if len(page) < LIST_PAGE:
                return
            offset += LIST_PAGE

    def list_objects(self) -> Iterator[StoredObject]:
        """Every file one folder deep ({user_id}/{name}); folders have no id. Callers that
        delete while iterating must list everything first (see cleanup.delete_orphan_images):
        deleting shifts later objects to earlier offsets."""
        for folder in self._list(""):
            if folder.get("id") is not None or not folder.get("name"):
                continue
            for item in self._list(folder["name"]):
                created = item.get("created_at")
                if item.get("id") is None or not created:
                    continue
                yield StoredObject(
                    path=f"{folder['name']}/{item['name']}",
                    created_at=datetime.fromisoformat(created.replace("Z", "+00:00")),
                )


def _error_code(response: httpx.Response) -> str:
    """Supabase Storage puts the real status in the JSON body (`statusCode`/`error`); some
    versions answer 400 for a missing object or an existing one."""
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    return f"{body.get('statusCode', '')} {body.get('error', '')}".lower()


def _is_not_found(response: httpx.Response) -> bool:
    if response.status_code == 404:
        return True
    code = _error_code(response) if response.status_code == 400 else ""
    return "404" in code or "not_found" in code or "not found" in code


def _is_duplicate(response: httpx.Response) -> bool:
    if response.status_code == 409:
        return True
    code = _error_code(response) if response.status_code == 400 else ""
    return "409" in code or "duplicate" in code


# ---------- local (development) ----------


class LocalStorage:
    """Development only: never use for real user data."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _file(self, path: str) -> Path:
        target = (self.root / check_path(path)).resolve()
        if not target.is_relative_to(self.root):  # defence in depth; check_path already
            raise InvalidObjectPath("path escapes the storage directory")
        return target

    def put(self, path: str, data: bytes, content_type: str) -> None:
        target = self._file(path)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as handle:  # never overwrite an existing receipt
                handle.write(data)
        except FileExistsError as exc:
            raise ObjectExists from exc
        except OSError as exc:
            raise StorageUnavailable from exc

    def get(self, path: str) -> bytes | None:
        try:
            return self._file(path).read_bytes()
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise StorageUnavailable from exc

    def delete(self, path: str) -> None:
        self._file(path).unlink(missing_ok=True)

    def signed_url(self, path: str) -> str | None:
        check_path(path)
        return None

    def list_objects(self) -> Iterator[StoredObject]:
        if not self.root.is_dir():
            return
        for folder in sorted(self.root.iterdir()):
            if not folder.is_dir():
                continue
            for item in sorted(folder.iterdir()):
                if item.is_file():
                    yield StoredObject(
                        path=f"{folder.name}/{item.name}",
                        created_at=datetime.fromtimestamp(item.stat().st_mtime, UTC),
                    )


# ---------- dependency ----------


def _not_configured(detail: str) -> ApiError:
    logger.error("Receipt storage misconfigured: %s", detail)
    return ApiError(503, "service-unavailable", "Receipt scanning isn't available right now.")


@lru_cache
def get_storage() -> ReceiptStorage:
    """FastAPI dependency (tests override it). Never falls back to another backend."""
    backend = settings.receipt_storage.strip().lower()
    if backend == "supabase":
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise _not_configured("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        if service_key_kind(settings.supabase_service_role_key) is None:
            # e.g. the anon/publishable key pasted by mistake: it would fail every request.
            raise _not_configured("SUPABASE_SERVICE_ROLE_KEY is not a service-role or secret key")
        return SupabaseStorage(
            settings.supabase_url, settings.supabase_service_role_key, settings.receipts_bucket
        )
    if backend == "local":
        if settings.app_env.strip().lower() == "production":
            raise _not_configured("local storage is refused when APP_ENV=production")
        logger.warning("Receipt images are stored locally (development only)")
        return LocalStorage(Path(settings.receipt_local_dir))
    raise _not_configured(f"unknown RECEIPT_STORAGE {backend!r}")


def storage_provider(request: Request) -> Callable[[], ReceiptStorage]:
    """FastAPI dependency: get_storage, resolved only when a receipt is actually involved, so
    deleting a manual transaction never depends on storage being configured. Honours a test
    override of get_storage."""
    return request.app.dependency_overrides.get(get_storage, get_storage)
