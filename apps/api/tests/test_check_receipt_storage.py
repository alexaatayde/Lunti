"""Phase 8D.3: the read-only receipt storage checker (scripts/check_receipt_storage.py).
Fake HTTP and fake policy rows only: nothing reaches Supabase or a real database."""

import json

import httpx
import pytest

from app.core.config import settings
from app.core.isolation import IsolationError
from scripts import check_receipt_storage as checker

SECRET = "sb_secret_zz-test-not-a-real-key"
GOOD_BUCKET = {
    "id": "receipts",
    "public": False,
    "file_size_limit": 10 * 1024 * 1024,
    "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
}


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", SECRET)
    return monkeypatch


def storage_api(
    bucket: dict | None = GOOD_BUCKET,
    *,
    status: int = 200,
    public_status: int = 400,
    seen: list[httpx.Request] | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        path = request.url.path
        if request.method == "GET" and path.startswith("/storage/v1/bucket/"):
            assert request.headers["apikey"] == SECRET
            if bucket is None:
                return httpx.Response(404, json={"error": "Bucket not found"})
            return httpx.Response(status, json=bucket)
        if request.method == "POST" and path.startswith("/storage/v1/object/list/"):
            return httpx.Response(200, json=[])
        if request.method == "GET" and path.startswith("/storage/v1/object/public/"):
            assert "authorization" not in request.headers and "apikey" not in request.headers
            return httpx.Response(public_status, json={"error": "not_found"})
        raise AssertionError(f"unexpected {request.method} {path}")

    return httpx.MockTransport(handler)


def names(checks: list[checker.Check], ok: bool) -> list[str]:
    return [c.name for c in checks if c.ok is ok]


def test_a_correct_setup_passes_every_check(configured: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []
    checks = checker.run(
        ["receipts", "receipts-dev"], transport=storage_api(seen=seen), policies=lambda: []
    )
    assert names(checks, False) == []
    assert "[receipts-dev] bucket is private" in names(checks, True)
    assert "no storage policies reach receipts, receipts-dev" in names(checks, True)
    # Read-only: bucket info, an empty-prefix listing, an anonymous public-URL probe.
    assert {(r.method, r.url.path.split("/")[3]) for r in seen} == {
        ("GET", "bucket"),
        ("POST", "object"),
        ("GET", "object"),
    }
    assert all(r.method in ("GET", "POST") for r in seen)
    listing = [json.loads(r.content) for r in seen if r.method == "POST"]
    assert all(body["limit"] == 1 and len(body["prefix"]) == 36 for body in listing)


def test_missing_or_public_keys_stop_before_any_request(configured: pytest.MonkeyPatch) -> None:
    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may be made")

    for key in ("", "sb_publishable_abc", "anon-ish"):
        configured.setattr(settings, "supabase_service_role_key", key)
        checks = checker.run(["receipts"], transport=httpx.MockTransport(no_network))
        assert names(checks, False) == ["SUPABASE_SERVICE_ROLE_KEY is a backend key"]


def test_wrong_bucket_settings_fail(configured: pytest.MonkeyPatch) -> None:
    loose = {"id": "receipts", "public": True, "file_size_limit": None, "allowed_mime_types": None}
    checks = checker.run(["receipts"], transport=storage_api(loose))
    assert set(names(checks, False)) == {
        "[receipts] bucket is private",
        f"[receipts] size limit is {settings.receipt_max_bytes} bytes",
        "[receipts] accepts only JPEG, PNG and WebP",
    }


def test_missing_bucket_and_rejected_key_fail(configured: pytest.MonkeyPatch) -> None:
    missing = checker.run(["receipts"], transport=storage_api(None))
    assert names(missing, False) == ["[receipts] bucket exists"]
    rejected = checker.run(["receipts"], transport=storage_api(status=403))
    assert names(rejected, False) == ["[receipts] key accepted by Storage"]


def test_a_public_url_that_serves_files_fails(configured: pytest.MonkeyPatch) -> None:
    checks = checker.run(["receipts"], transport=storage_api(public_status=200))
    assert names(checks, False) == ["[receipts] public URL serves nothing"]


@pytest.mark.parametrize(
    ("row", "ok"),
    [
        ({"tablename": "objects", "qual": "true", "cmd": "SELECT"}, False),
        ({"tablename": "objects", "qual": None, "with_check": None, "cmd": "INSERT"}, False),
        ({"tablename": "objects", "qual": "(bucket_id = 'receipts'::text)", "cmd": "ALL"}, False),
        ({"tablename": "objects", "qual": "(auth.uid() IS NOT NULL)", "cmd": "SELECT"}, False),
        ({"tablename": "objects", "qual": "(bucket_id = 'avatars'::text)", "cmd": "ALL"}, True),
        (
            {
                "tablename": "objects",
                "qual": "((bucket_id = 'avatars'::text) OR true)",
                "cmd": "ALL",
            },
            False,
        ),
        ({"tablename": "buckets", "qual": "true", "cmd": "SELECT"}, False),
        ({"tablename": "buckets", "qual": "(id = 'avatars'::text)", "cmd": "SELECT"}, True),
    ],
    ids=[
        "objects-true",
        "objects-unrestricted",
        "objects-receipts",
        "objects-any-signed-in-user",
        "objects-other-bucket",
        "objects-other-bucket-or-anything",
        "buckets-all",
        "buckets-other",
    ],
)
def test_client_policies_reaching_the_buckets_fail(row: dict, ok: bool) -> None:
    row = {"policyname": "zz policy", "roles": ["authenticated"], "with_check": None, **row}
    checks = checker.check_policies([row], ["receipts", "receipts-dev"])
    assert all(c.ok for c in checks) is ok


def test_a_policy_read_failure_is_reported_not_hidden(configured: pytest.MonkeyPatch) -> None:
    def broken() -> list:
        raise RuntimeError("could not open a read-only transaction")

    checks = checker.run(["receipts"], transport=storage_api(), policies=broken)
    assert names(checks, False) == ["storage policies readable"]


def test_policies_are_never_read_from_a_non_test_database_under_the_test_suite() -> None:
    with pytest.raises(IsolationError):
        checker.read_policies("postgresql://postgres:pw@db.zzproject.supabase.co:5432/postgres")


def test_the_report_never_contains_the_key(configured: pytest.MonkeyPatch) -> None:
    checks = checker.run(["receipts"], transport=storage_api(public_status=200))
    text, status = checker.report(checks)
    assert status == 1 and "FAIL  [receipts] public URL serves nothing  (HTTP 200)" in text
    assert SECRET not in text and "sb_secret" not in text
    assert "kind: secret" in text
    assert checker.report([])[1] == 1  # nothing checked is not a pass
