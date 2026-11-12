"""Receipt image storage (AGENTS.md §7.1 step 1, SRS 3.5.4).

- `SupabaseStorage` (production): a PRIVATE Supabase Storage bucket, reached only from the
  backend with the service-role key. Objects live at `{user_id}/{receipt_id}.{ext}`; the app
  never gets the key and only ever sees short-lived signed URLs for its own receipts.
- `LocalStorage` (development only): files under RECEIPT_LOCAL_DIR. No URLs are served.
"""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.errors import ApiError

logger = logging.getLogger(__name__)

SIGNED_URL_SECONDS = 600
TIMEOUT_SECONDS = 20


class StorageUnavailable(Exception):
    """Storage couldn't be reached or refused the request."""


class ReceiptStorage(Protocol):
    def put(self, path: str, data: bytes, content_type: str) -> None: ...
    def delete(self, path: str) -> None: ...
    def signed_url(self, path: str) -> str | None: ...


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
        self._client = httpx.Client(
            base_url=self.base,
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=TIMEOUT_SECONDS,
            transport=transport,
        )

    def _object(self, path: str) -> str:
        return f"/object/{quote(self.bucket)}/{quote(path)}"

    def _send(self, method: str, url: str, **kwargs) -> httpx.Response:  # noqa: ANN003
        try:
            response = self._client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("Storage request failed: %s", exc.__class__.__name__)
            raise StorageUnavailable from exc
        if response.status_code >= 400:
            # Never log the body or headers: they can echo the key or a signed URL.
            logger.warning("Storage %s returned %s", method, response.status_code)
            raise StorageUnavailable(f"storage returned {response.status_code}")
        return response

    def put(self, path: str, data: bytes, content_type: str) -> None:
        self._send(
            "POST",
            self._object(path),
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "false"},
        )

    def delete(self, path: str) -> None:
        try:
            self._client.request("DELETE", self._object(path)).raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Already gone: Supabase answers 404 (or 400 with a not-found body).
            if exc.response.status_code in (400, 404):
                return
            logger.warning("Storage DELETE returned %s", exc.response.status_code)
            raise StorageUnavailable from exc
        except httpx.HTTPError as exc:
            logger.warning("Storage request failed: %s", exc.__class__.__name__)
            raise StorageUnavailable from exc

    def signed_url(self, path: str) -> str | None:
        response = self._send(
            "POST",
            f"/object/sign/{quote(self.bucket)}/{quote(path)}",
            json={"expiresIn": SIGNED_URL_SECONDS},
        )
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        return f"{self.base}{signed}" if signed else None


class LocalStorage:
    """Development only: never use for real user data."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _file(self, path: str) -> Path:
        target = (self.root / path).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("path escapes the storage directory")
        return target

    def put(self, path: str, data: bytes, content_type: str) -> None:
        target = self._file(path)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as handle:  # never overwrite an existing receipt
                handle.write(data)
        except OSError as exc:
            raise StorageUnavailable from exc

    def delete(self, path: str) -> None:
        self._file(path).unlink(missing_ok=True)

    def signed_url(self, path: str) -> str | None:
        return None


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
        return SupabaseStorage(
            settings.supabase_url, settings.supabase_service_role_key, settings.receipts_bucket
        )
    if backend == "local":
        if settings.app_env.strip().lower() == "production":
            raise _not_configured("local storage is refused when APP_ENV=production")
        logger.warning("Receipt images are stored locally (development only)")
        return LocalStorage(Path(settings.receipt_local_dir))
    raise _not_configured(f"unknown RECEIPT_STORAGE {backend!r}")
