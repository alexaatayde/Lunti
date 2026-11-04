"""RFC 7807 error responses. The database dependency is replaced, so no database is needed."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.db import get_user_db
from app.main import app

USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")


@pytest.fixture
def no_db(client: TestClient) -> Iterator[TestClient]:
    def fake_db() -> Iterator[None]:
        yield None

    app.dependency_overrides[get_user_db] = fake_db
    yield client


def test_validation_errors_list_each_field(no_db: TestClient, auth_header) -> None:
    response = no_db.put(
        "/api/v1/me/preferences",
        headers=auth_header(USER_ID),
        json={
            "notify_budget": "yes",
            "notify_replenishment": True,
            "notify_shopping": True,
            "budget_alert_pct": 30,
            "surprise": 1,
        },
    )

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["type"] == "urn:lunti:problem:validation-error"
    fields = {e["field"] for e in body["errors"]}
    assert {"notify_budget", "notify_meals", "budget_alert_pct", "surprise"} <= fields


def test_profile_update_rejects_role_changes(no_db: TestClient, auth_header) -> None:
    response = no_db.patch(
        "/api/v1/me", headers=auth_header(USER_ID), json={"full_name": "Alex", "role": "admin"}
    )

    assert response.status_code == 422
    assert [e["field"] for e in response.json()["errors"]] == ["role"]


@pytest.mark.parametrize(
    "body",
    [{}, {"name": "   "}, {"name": "x" * 41}, {"name": "Pets", "icon": "Not Valid!"}],
)
def test_category_create_validation(no_db: TestClient, auth_header, body: dict) -> None:
    response = no_db.post("/api/v1/categories", headers=auth_header(USER_ID), json=body)

    assert response.status_code == 422


def test_bad_path_id_is_a_validation_error(no_db: TestClient, auth_header) -> None:
    response = no_db.patch(
        "/api/v1/categories/not-a-uuid", headers=auth_header(USER_ID), json={"name": "x"}
    )

    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "category_id"


def test_unknown_route_is_a_problem_404(client: TestClient) -> None:
    response = client.get("/api/v1/nothing-here")

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["type"] == "urn:lunti:problem:not-found"


def test_database_outage_is_503_with_retry_after(client: TestClient, auth_header) -> None:
    def broken_db() -> Iterator[None]:
        raise OperationalError("select 1", {}, Exception("connection refused"))
        yield  # pragma: no cover

    app.dependency_overrides[get_user_db] = broken_db

    response = client.get("/api/v1/me", headers=auth_header(USER_ID))

    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"
    body = response.json()
    assert body["type"] == "urn:lunti:problem:service-unavailable"
    # Internal details never reach the client.
    assert "connection refused" not in response.text


def test_unexpected_errors_are_generic_500(client: TestClient, auth_header) -> None:
    def failing_db() -> Iterator[None]:
        raise RuntimeError("secret internal detail")
        yield  # pragma: no cover

    app.dependency_overrides[get_user_db] = failing_db

    response = client.get("/api/v1/me", headers=auth_header(USER_ID))

    assert response.status_code == 500
    assert response.json()["type"] == "urn:lunti:problem:internal-error"
    assert "secret internal detail" not in response.text
