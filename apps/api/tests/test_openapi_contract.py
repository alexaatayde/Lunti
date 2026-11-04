"""The mobile app's generated client is built from apps/mobile/src/api/openapi.json.
If the API changes without regenerating it, the app and API disagree — fail early."""

from scripts.export_openapi import TARGET, render


def test_mobile_openapi_spec_is_up_to_date() -> None:
    assert TARGET.exists(), "Run: python -m scripts.export_openapi"
    assert TARGET.read_text() == render(), (
        "API changed: run `python -m scripts.export_openapi` in apps/api, then "
        "`npm run api:generate` in apps/mobile"
    )


def test_every_api_route_requires_a_bearer_token() -> None:
    import json

    spec = json.loads(render())
    for path, operations in spec["paths"].items():
        if not path.startswith("/api/v1/"):
            continue
        for method, operation in operations.items():
            assert "401" in operation["responses"], f"{method.upper()} {path} has no 401"
