"""Read-only checks of the OCR configuration and the Google credential file (Phase 8D.4a).

Used by `get_ocr` (the API refuses Google Vision when a check fails) and by
`python -m scripts.check_ocr_config`. Nothing here makes a network request, builds a client
or prints secret material: a finding names the problem and, at most, the key's project id
and a masked service-account address.

Credential rules (service_account_file mode):
- GOOGLE_APPLICATION_CREDENTIALS is an absolute path to a regular file outside this
  repository (so it can't be committed or end up in a build);
- readable by its owner only (no group/other permission bits, i.e. chmod 600 or 400);
- small, valid JSON of type "service_account" with the fields the client needs.

Keyless (application_default) mode needs no file: the runtime's attached service account
or workload identity is used. It is the preferred option for deployed infrastructure.
"""

import json
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.core.config import Settings

Level = Literal["ok", "warn", "error"]

AUTH_MODES = ("service_account_file", "application_default")
PROVIDERS = ("google", "fixture", "disabled")
MAX_KEY_BYTES = 64 * 1024
REQUIRED_KEY_FIELDS = ("type", "project_id", "private_key_id", "private_key", "client_email")

REPO_ROOT = Path(__file__).resolve().parents[5]


@dataclass(frozen=True)
class Finding:
    level: Level
    check: str
    detail: str


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    if not domain:
        return "***"
    return f"{name[:3]}***@{domain}"


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def check_credentials_file(raw_path: str, *, repo_root: Path = REPO_ROOT) -> list[Finding]:
    """Findings for a service-account key file. Reads the file only to validate its shape;
    the private key is never returned, printed or logged."""
    findings: list[Finding] = []
    if not raw_path.strip():
        return [Finding("error", "credentials_path", "GOOGLE_APPLICATION_CREDENTIALS is not set")]
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        return [Finding("error", "credentials_path", "the path must be absolute")]
    try:
        resolved = path.resolve(strict=True)
    except (FileNotFoundError, RuntimeError, OSError):
        return [Finding("error", "credentials_path", "the file does not exist")]
    if _inside(resolved, repo_root.resolve()) or _inside(path, repo_root.resolve()):
        findings.append(
            Finding(
                "error",
                "credentials_location",
                "the key is inside the repository; move it outside (e.g. ~/.config/lunti/)",
            )
        )
    try:
        info = resolved.stat()
    except OSError:
        return [*findings, Finding("error", "credentials_path", "the file can't be read")]
    if not stat.S_ISREG(info.st_mode):
        return [*findings, Finding("error", "credentials_path", "the path is not a regular file")]
    if info.st_mode & 0o077:
        findings.append(
            Finding(
                "error",
                "credentials_permissions",
                f"mode {stat.S_IMODE(info.st_mode):o} lets other users read it; run chmod 600",
            )
        )
    if info.st_size > MAX_KEY_BYTES:
        return [*findings, Finding("error", "credentials_content", "the file is too large")]
    try:
        data = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return [*findings, Finding("error", "credentials_content", "the file can't be read")]
    except json.JSONDecodeError:
        return [*findings, Finding("error", "credentials_content", "the file is not valid JSON")]
    if not isinstance(data, dict):
        return [*findings, Finding("error", "credentials_content", "not a credential object")]
    if data.get("type") != "service_account":
        findings.append(
            Finding("error", "credentials_type", "the key is not a service-account key")
        )
    missing = [f for f in REQUIRED_KEY_FIELDS if not isinstance(data.get(f), str) or not data[f]]
    if missing:
        findings.append(
            Finding("error", "credentials_fields", f"missing fields: {', '.join(missing)}")
        )
    key = data.get("private_key")
    if isinstance(key, str) and key and "PRIVATE KEY-----" not in key:
        findings.append(
            Finding("error", "credentials_fields", "private_key is not a PEM private key")
        )
    if not [f for f in findings if f.level == "error"]:
        email = data.get("client_email", "")
        findings.append(
            Finding(
                "ok",
                "credentials",
                f"service account {mask_email(email)} in project {data.get('project_id')}",
            )
        )
    return findings


def check_settings(settings: Settings, *, repo_root: Path = REPO_ROOT) -> list[Finding]:
    """Everything `get_ocr` and the upload path depend on, without contacting Google."""
    findings: list[Finding] = []
    provider = settings.resolved_ocr_provider
    explicit = bool(settings.ocr_provider.strip())
    env = "production" if settings.is_production else "development"
    if provider not in PROVIDERS:
        findings.append(Finding("error", "provider", f"unknown OCR_PROVIDER {provider!r}"))
        return findings
    findings.append(
        Finding(
            "ok",
            "provider",
            f"{provider} ({'set explicitly' if explicit else 'default'} for APP_ENV={env})",
        )
    )
    if provider == "fixture" and settings.is_production:
        findings.append(Finding("error", "provider", "fixture OCR is refused in production"))
    if provider == "disabled":
        findings.append(Finding("warn", "provider", "receipt scanning answers 503 (disabled)"))

    if provider == "google":
        mode = settings.google_vision_auth.strip().lower()
        if mode not in AUTH_MODES:
            findings.append(
                Finding("error", "auth_mode", f"GOOGLE_VISION_AUTH must be one of {AUTH_MODES}")
            )
        elif mode == "application_default":
            findings.append(Finding("ok", "auth_mode", "keyless (application default credentials)"))
            if settings.google_application_credentials.strip():
                findings.append(
                    Finding(
                        "warn",
                        "auth_mode",
                        "GOOGLE_APPLICATION_CREDENTIALS is set but unused in keyless mode",
                    )
                )
        else:
            findings.append(Finding("ok", "auth_mode", "service-account key file"))
            findings += check_credentials_file(
                settings.google_application_credentials, repo_root=repo_root
            )
        try:
            import google.cloud.vision  # noqa: F401
        except ImportError:
            findings.append(Finding("error", "library", "google-cloud-vision is not installed"))

    limits = (
        f"per user {settings.ocr_user_daily_limit}/day, app-wide external "
        f"{settings.ocr_global_daily_limit}/day ({settings.tz})"
    )
    findings.append(Finding("ok", "limits", limits))
    if provider == "google" and settings.ocr_global_daily_limit == 0:
        findings.append(Finding("warn", "limits", "OCR_GLOBAL_DAILY_LIMIT=0 blocks every scan"))
    findings.append(
        Finding(
            "ok",
            "timeouts",
            f"OCR timeout {settings.ocr_timeout_seconds:g}s, lease {settings.ocr_lease_seconds}s,"
            f" duplicate wait {settings.ocr_wait_seconds:g}s",
        )
    )
    retention = settings.receipt_raw_text_retention_days
    findings.append(
        Finding(
            "ok" if retention else "warn",
            "raw_text_retention",
            f"recognised text purged {retention} days after confirmation"
            if retention
            else "recognised text of confirmed receipts is kept (no retention period set)",
        )
    )
    return findings


def errors(findings: list[Finding]) -> list[Finding]:
    return [f for f in findings if f.level == "error"]
