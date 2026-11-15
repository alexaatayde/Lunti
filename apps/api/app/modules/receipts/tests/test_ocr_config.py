"""OCR configuration and credential checks (Phase 8D.4a). No network, no real keys: the key
files here are fabricated and never valid credentials."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.core.config import Settings, settings
from app.core.errors import ApiError
from app.modules.receipts import ocr as ocr_module
from app.modules.receipts import ocr_config
from app.modules.receipts.ocr import FixtureOcr
from scripts import check_ocr_config

API_DIR = Path(__file__).resolve().parents[4]
FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nZZTESTNOTAREALKEYZZ\n-----END PRIVATE KEY-----\n"


def key_file(directory: Path, *, mode: int = 0o600, **overrides: object) -> Path:
    data = {
        "type": "service_account",
        "project_id": "zz-test-project",
        "private_key_id": "zz0123",
        "private_key": FAKE_PEM,
        "client_email": "lunti-ocr@zz-test-project.iam.gserviceaccount.com",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    data.update(overrides)
    data = {k: v for k, v in data.items() if v is not None}
    path = directory / "vision-key.json"
    path.write_text(json.dumps(data))
    path.chmod(mode)
    return path


@pytest.fixture
def outside(tmp_path: Path) -> Path:
    """A directory outside the repository (pytest's tmp dir)."""
    return tmp_path


def levels(findings: list[ocr_config.Finding]) -> dict[str, str]:
    worst: dict[str, str] = {}
    for f in findings:
        if worst.get(f.check) != "error":
            worst[f.check] = f.level
    return worst


# ---------- the key file ----------


def test_a_good_key_passes_and_nothing_secret_is_reported(outside: Path) -> None:
    findings = ocr_config.check_credentials_file(str(key_file(outside)))
    assert ocr_config.errors(findings) == []
    text = " ".join(f.detail for f in findings)
    assert "zz-test-project" in text and "lun***@zz-test-project" in text
    assert "ZZTESTNOTAREALKEYZZ" not in text and "PRIVATE KEY" not in text
    assert "zz0123" not in text


@pytest.mark.parametrize(
    ("raw", "detail"),
    [
        ("", "not set"),
        ("relative/key.json", "absolute"),
        ("/nonexistent/zz/key.json", "does not exist"),
    ],
)
def test_missing_or_unusable_paths(raw: str, detail: str) -> None:
    (finding,) = ocr_config.check_credentials_file(raw)
    assert finding.level == "error" and detail in finding.detail


def test_group_or_world_readable_key_is_refused(outside: Path) -> None:
    findings = ocr_config.check_credentials_file(str(key_file(outside, mode=0o644)))
    assert levels(findings)["credentials_permissions"] == "error"
    assert "chmod 600" in " ".join(f.detail for f in findings)
    assert (
        ocr_config.errors(ocr_config.check_credentials_file(str(key_file(outside, mode=0o400))))
        == []
    )


def test_key_inside_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "apps" / "api").mkdir(parents=True)
    path = key_file(repo / "apps" / "api")
    findings = ocr_config.check_credentials_file(str(path), repo_root=repo)
    assert levels(findings)["credentials_location"] == "error"


def test_symlink_into_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    real = key_file(repo)
    link = tmp_path / "elsewhere.json"
    link.symlink_to(real)
    findings = ocr_config.check_credentials_file(str(link), repo_root=repo)
    assert levels(findings)["credentials_location"] == "error"


@pytest.mark.parametrize(
    ("overrides", "check"),
    [
        ({"type": "authorized_user"}, "credentials_type"),
        ({"private_key": None}, "credentials_fields"),
        ({"client_email": ""}, "credentials_fields"),
        ({"private_key": "not a pem"}, "credentials_fields"),
    ],
)
def test_wrong_key_shapes(outside: Path, overrides: dict, check: str) -> None:
    findings = ocr_config.check_credentials_file(str(key_file(outside, **overrides)))
    assert levels(findings)[check] == "error"


def test_invalid_json_and_directories(outside: Path) -> None:
    bad = outside / "bad.json"
    bad.write_text("{not json")
    bad.chmod(0o600)
    assert "not valid JSON" in ocr_config.check_credentials_file(str(bad))[-1].detail
    assert "not a regular file" in ocr_config.check_credentials_file(str(outside))[-1].detail


# ---------- provider selection ----------


def test_development_default_is_disabled_and_production_default_is_google() -> None:
    assert Settings(app_env="development", ocr_provider="").resolved_ocr_provider == "disabled"
    assert Settings(app_env="production", ocr_provider="").resolved_ocr_provider == "google"
    assert Settings(app_env="development", ocr_provider=" Google ").resolved_ocr_provider == (
        "google"
    )


def test_lease_must_cover_the_ocr_timeout() -> None:
    with pytest.raises(ValueError, match="OCR_LEASE_SECONDS"):
        Settings(ocr_timeout_seconds=55, ocr_lease_seconds=60)


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    ocr_module.get_ocr.cache_clear()
    yield monkeypatch
    ocr_module.get_ocr.cache_clear()


def test_disabled_provider_answers_503(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "app_env", "development")
    configured.setattr(settings, "ocr_provider", "")
    with pytest.raises(ApiError) as error:
        ocr_module.get_ocr()
    assert error.value.status == 503


def test_bad_credentials_are_refused_before_any_client_is_built(
    configured: pytest.MonkeyPatch, outside: Path
) -> None:
    built: list[object] = []
    configured.setattr(
        ocr_module.GoogleVisionOcr, "__init__", lambda self, *a, **k: built.append(a)
    )
    configured.setattr(settings, "ocr_provider", "google")
    configured.setattr(settings, "google_vision_auth", "service_account_file")
    configured.setattr(
        settings, "google_application_credentials", str(key_file(outside, mode=0o644))
    )
    with pytest.raises(ApiError) as error:
        ocr_module.get_ocr()
    assert error.value.status == 503 and built == []

    configured.setattr(settings, "google_application_credentials", str(key_file(outside)))
    ocr_module.get_ocr()
    assert built == [(str(outside / "vision-key.json"),)]


def test_keyless_mode_needs_no_key_file(configured: pytest.MonkeyPatch) -> None:
    built: list[tuple] = []
    configured.setattr(
        ocr_module.GoogleVisionOcr, "__init__", lambda self, *a, **k: built.append(a)
    )
    configured.setattr(settings, "ocr_provider", "google")
    configured.setattr(settings, "google_vision_auth", "application_default")
    configured.setattr(settings, "google_application_credentials", "")
    ocr_module.get_ocr()
    assert built == [()]  # no key file: application default credentials


def test_unknown_auth_mode_is_refused(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "ocr_provider", "google")
    configured.setattr(settings, "google_vision_auth", "api_key")
    with pytest.raises(ApiError):
        ocr_module.get_ocr()


def test_fixture_ocr_still_works_in_development(configured: pytest.MonkeyPatch) -> None:
    configured.setattr(settings, "app_env", "development")
    configured.setattr(settings, "ocr_provider", "fixture")
    assert isinstance(ocr_module.get_ocr(), FixtureOcr)


# ---------- the checker script ----------


def test_checker_reports_without_secrets(
    monkeypatch: pytest.MonkeyPatch, outside: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(settings, "google_application_credentials", str(key_file(outside)))
    monkeypatch.setattr(settings, "google_vision_auth", "service_account_file")
    assert check_ocr_config.main(["--provider", "google"]) == 0
    out = capsys.readouterr().out
    assert "[PASS] credentials" in out and "OCR configuration OK" in out
    assert "ZZTESTNOTAREALKEYZZ" not in out and "PRIVATE KEY" not in out

    monkeypatch.setattr(settings, "google_application_credentials", "")
    assert check_ocr_config.main(["--provider", "google"]) == 1
    assert "[FAIL] credentials_path" in capsys.readouterr().out


def test_checker_runs_as_a_module_without_network(outside: Path) -> None:
    env = {
        **os.environ,
        "OCR_PROVIDER": "google",
        "GOOGLE_VISION_AUTH": "service_account_file",
        "GOOGLE_APPLICATION_CREDENTIALS": str(key_file(outside)),
        "DATABASE_URL": "",
        # Any attempt to reach Google would fail fast instead of hanging.
        "HTTPS_PROXY": "http://127.0.0.1:9",
    }
    result = subprocess.run(
        [sys.executable, "-m", "scripts.check_ocr_config"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ZZTESTNOTAREALKEYZZ" not in result.stdout + result.stderr


# ---------- repository hygiene ----------


def test_credential_files_are_git_ignored_but_ordinary_json_is_not() -> None:
    repo = API_DIR.parents[1]

    def ignored(path: str) -> bool:
        return (
            subprocess.run(
                ["git", "check-ignore", "-q", "--no-index", path], cwd=repo, check=False
            ).returncode
            == 0
        )

    for path in (
        "apps/api/lunti-vision-service-account.json",
        "apps/api/gcp-vision-key.json",
        "apps/api/google-credentials.json",
        "apps/api/lunti-firebase-adminsdk-abc12-0123456789.json",
        "apps/api/secrets/anything.json",
        "service-account.json",
    ):
        assert ignored(path), path
    for path in (
        "apps/mobile/package.json",
        "apps/mobile/src/api/openapi.json",
        "apps/mobile/app.json",
        "apps/api/tests/fixtures/receipts/sample.json",
    ):
        assert not ignored(path), path
