"""Read-only check of the receipt OCR configuration (Phase 8D.4a). Changes nothing.

    cd apps/api && .venv/bin/python -m scripts.check_ocr_config [--provider google]

Reports which OCR provider the API would use and why, the Google Vision authentication mode,
and, for a service-account key file, whether it is outside the repository, readable by its
owner only and shaped like a service-account key. Also shows the daily limits, timeouts and
the recognised-text retention setting.

It never contacts Google, never creates a client and never prints key material: at most the
key's project id and a masked service-account address. --provider checks a provider other
than the configured one (e.g. google before enabling it). Exit status 0 when there is no
error, 1 otherwise.
"""

import argparse
import sys

from app.core.config import settings
from app.modules.receipts import ocr_config
from app.modules.receipts.ocr_config import Finding

MARK = {"ok": "PASS", "warn": "WARN", "error": "FAIL"}


def report(findings: list[Finding]) -> tuple[str, int]:
    lines = [f"[{MARK[f.level]}] {f.check}: {f.detail}" for f in findings]
    failed = ocr_config.errors(findings)
    lines.append(f"{len(failed)} error(s)" if failed else "OCR configuration OK")
    return "\n".join(lines), 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--provider", choices=ocr_config.PROVIDERS, help="provider to check")
    args = parser.parse_args(argv)
    checked = (
        settings.model_copy(update={"ocr_provider": args.provider}) if args.provider else settings
    )
    text, status = report(ocr_config.check_settings(checked))
    print(text)
    return status


if __name__ == "__main__":
    sys.exit(main())
