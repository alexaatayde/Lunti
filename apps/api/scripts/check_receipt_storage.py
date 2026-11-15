"""Read-only check of the receipt photo storage setup (Phase 8D.3). Changes nothing.

    cd apps/api && .venv/bin/python -m scripts.check_receipt_storage \
        [--bucket receipts] [--bucket receipts-dev] [--no-db]

Without --bucket it checks RECEIPTS_BUCKET. It never prints a key, token or signed URL.

1. SUPABASE_URL is set and SUPABASE_SERVICE_ROLE_KEY is a backend key: a legacy service-role
   JWT or a `sb_secret_…` key (an anon/publishable key is refused).
2. Each bucket exists, is private, is limited to RECEIPT_MAX_BYTES and accepts only
   image/jpeg, image/png and image/webp (GET /storage/v1/bucket/{id}).
3. The key can read the bucket (POST /object/list with a random, empty prefix).
4. The bucket's public URL serves nothing: an anonymous GET /object/public/… is refused.
5. Unless --no-db: no storage policy lets app users or the public reach these buckets
   (pg_policies on storage.objects / storage.buckets, in a READ ONLY transaction).

Exit status 0 when every check passes, 1 otherwise.
"""

import argparse
import re
import sys
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.modules.receipts.storage import TIMEOUT_SECONDS, service_key_kind

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
POLICY_QUERY = (
    "select tablename, policyname, roles, cmd, qual, with_check from pg_policies"
    " where schemaname = 'storage' and tablename in ('objects', 'buckets')"
    " order by tablename, policyname"
)


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str = ""


PolicyRow = dict[str, object]


def check_key(supabase_url: str, key: str) -> list[Check]:
    kind = service_key_kind(key) if key else None
    return [
        Check("SUPABASE_URL is set", bool(supabase_url.strip())),
        Check(
            "SUPABASE_SERVICE_ROLE_KEY is a backend key",
            kind is not None,
            f"kind: {kind}" if kind else "missing, or an anon/publishable/unknown key",
        ),
    ]


def check_bucket(client: httpx.Client, anonymous: httpx.Client, bucket: str) -> list[Check]:
    """Settings, read access and public access for one bucket (read-only requests)."""
    label = f"[{bucket}]"
    try:
        response = client.get(f"/bucket/{quote(bucket)}")
    except httpx.HTTPError as exc:
        return [Check(f"{label} storage reachable", False, exc.__class__.__name__)]
    if response.status_code in (401, 403):
        return [Check(f"{label} key accepted by Storage", False, f"HTTP {response.status_code}")]
    if response.status_code != 200:
        return [Check(f"{label} bucket exists", False, f"HTTP {response.status_code}")]
    info = response.json()
    limit = info.get("file_size_limit")
    types = set(info.get("allowed_mime_types") or [])
    checks = [
        Check(f"{label} bucket exists", True),
        Check(f"{label} bucket is private", info.get("public") is False),
        Check(
            f"{label} size limit is {settings.receipt_max_bytes} bytes",
            limit == settings.receipt_max_bytes,
            f"found {limit!r}",
        ),
        Check(
            f"{label} accepts only JPEG, PNG and WebP",
            types == ALLOWED_TYPES,
            f"found {sorted(types) or 'any type'}",
        ),
    ]
    prefix = str(uuid.uuid4())  # nothing lives here: listing reads nothing real
    listed = client.post(
        f"/object/list/{quote(bucket)}", json={"prefix": prefix, "limit": 1, "offset": 0}
    )
    checks.append(
        Check(f"{label} key can read the bucket", listed.status_code == 200, _status(listed))
    )
    probe = f"{uuid.uuid4()}/{uuid.uuid4()}.jpg"
    public = anonymous.get(f"/object/public/{quote(bucket)}/{probe}")
    checks.append(
        Check(f"{label} public URL serves nothing", public.status_code != 200, _status(public))
    )
    return checks


def _limited_to_other_buckets(text: str, column: str, buckets: list[str]) -> bool:
    """True only when a policy visibly names a bucket that isn't one of ours, never ours,
    and has no OR that could widen it. Anything less obvious fails (review it by hand)."""
    names = re.findall(r"'([^']*)'", text)
    return (
        column in text
        and bool(names)
        and not any(b in names for b in buckets)
        and re.search(r"\bor\b", text, re.IGNORECASE) is None
    )


def check_policies(rows: Iterable[PolicyRow], buckets: list[str]) -> list[Check]:
    """Fails closed: a storage policy that isn't visibly limited to some OTHER bucket counts
    as reaching these buckets."""
    checks: list[Check] = []
    for row in rows:
        table, name = row["tablename"], row["policyname"]
        text = f"{row.get('qual') or ''} {row.get('with_check') or ''}"
        column, label = (
            ("bucket_id", "no client policy on storage.objects reaches these buckets")
            if table == "objects"
            else ("id", "no client policy exposes these buckets")
        )
        if not _limited_to_other_buckets(text, column, buckets):
            checks.append(
                Check(
                    label,
                    False,
                    f"policy {name!r} ({row.get('cmd')}) for roles {row.get('roles')}",
                )
            )
    if not checks:
        checks.append(Check(f"no storage policies reach {', '.join(buckets)}", True))
    return checks


def read_policies(database_url: str) -> list[PolicyRow]:
    """pg_policies rows, read in a transaction the server enforces as READ ONLY."""
    import psycopg
    from psycopg.rows import dict_row

    from app.core import isolation
    from app.core.config import to_sqlalchemy_url

    if isolation.isolated_mode():  # under the test suite: never the live database
        isolation.check_url(to_sqlalchemy_url(database_url))
    with psycopg.connect(database_url, connect_timeout=10, row_factory=dict_row) as conn:
        conn.execute("set transaction read only")
        state = conn.execute("show transaction_read_only").fetchone()
        if not state or state["transaction_read_only"] != "on":
            raise RuntimeError("could not open a read-only transaction; nothing was queried")
        rows = conn.execute(POLICY_QUERY).fetchall()
        conn.rollback()
    return rows


def run(
    buckets: list[str],
    *,
    transport: httpx.BaseTransport | None = None,
    policies: Callable[[], list[PolicyRow]] | None = None,
) -> list[Check]:
    key = settings.supabase_service_role_key
    checks = check_key(settings.supabase_url, key)
    if not all(c.ok for c in checks):
        return checks
    base = f"{settings.supabase_url.rstrip('/')}/storage/v1"
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    with (
        httpx.Client(
            base_url=base, headers=headers, timeout=TIMEOUT_SECONDS, transport=transport
        ) as client,
        httpx.Client(base_url=base, timeout=TIMEOUT_SECONDS, transport=transport) as anonymous,
    ):
        for bucket in buckets:
            checks += check_bucket(client, anonymous, bucket)
    if policies is not None:
        try:
            checks += check_policies(policies(), buckets)
        except Exception as exc:  # noqa: BLE001 - reported, never hidden
            checks.append(Check("storage policies readable", False, exc.__class__.__name__))
    return checks


def _status(response: httpx.Response) -> str:
    return f"HTTP {response.status_code}"


def report(checks: list[Check]) -> tuple[str, int]:
    """Printable lines (names, statuses and HTTP codes only) and the exit status."""
    lines = [
        f"{'PASS' if c.ok else 'FAIL'}  {c.name}" + (f"  ({c.detail})" if c.detail else "")
        for c in checks
    ]
    return "\n".join(lines), 0 if checks and all(c.ok for c in checks) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", action="append", help="bucket to check (repeatable)")
    parser.add_argument("--no-db", action="store_true", help="skip the storage policy check")
    args = parser.parse_args(argv)
    buckets = args.bucket or [settings.receipts_bucket]
    policies = None if args.no_db else (lambda: read_policies(settings.database_url))
    text, status = report(run(buckets, policies=policies))
    print(text)
    return status


if __name__ == "__main__":
    sys.exit(main())
