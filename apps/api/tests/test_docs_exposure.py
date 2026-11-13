"""API documentation endpoints (Phase 8B): served in development and tests, not in production."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app, create_app, docs_urls
from scripts.export_openapi import render

DOC_PATHS = ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect")


@pytest.fixture
def production_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "app_env", "production")
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        yield client
    monkeypatch.setattr(settings, "app_env", "development")
    create_app()  # restore development logging configuration


@pytest.mark.parametrize("path", DOC_PATHS)
def test_production_serves_no_api_docs(production_client: TestClient, path: str) -> None:
    response = production_client.get(path)
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert "Lunti API" not in response.text and "/api/v1/" not in response.text


def test_production_still_serves_the_api(production_client: TestClient) -> None:
    assert production_client.get("/health").json() == {"status": "ok"}
    # Routes still require a token (401, not 404): only the docs are gone.
    assert production_client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_development_serves_api_docs(client: TestClient, path: str) -> None:
    assert settings.is_production is False
    response = client.get(path)
    assert response.status_code == 200
    assert "Lunti API" in response.text


def test_production_app_builds_the_same_spec_for_client_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The mobile client and CI contract check use app.openapi(), not the HTTP endpoint."""
    monkeypatch.setattr(settings, "app_env", "production")
    try:
        production = create_app()
        assert production.openapi()["paths"] == app.openapi()["paths"]
    finally:
        monkeypatch.setattr(settings, "app_env", "development")
        create_app()
    assert render()  # the export script works in development


def test_docs_url_settings() -> None:
    assert docs_urls(True) == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert docs_urls(False)["openapi_url"] == "/openapi.json"
