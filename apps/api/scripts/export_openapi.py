"""Write the API's OpenAPI spec for the mobile client generator.

  python -m scripts.export_openapi          # writes ../mobile/src/api/openapi.json
  cd ../mobile && npm run api:generate      # regenerates src/api/schema.d.ts

tests/test_openapi_contract.py fails when the committed spec is out of date.
"""

import json
import sys
from pathlib import Path

from app.main import app

TARGET = Path(__file__).resolve().parents[2] / "mobile" / "src" / "api" / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(render())
    print(f"Wrote {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
