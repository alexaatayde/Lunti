"""/me and /me/preferences against a real database (needs TEST_DATABASE_URL)."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

pytestmark = pytest.mark.db


def test_get_me_returns_the_callers_profile(db_client: TestClient, make_user, auth_header) -> None:
    user = make_user(
        email="alex@example.com",
        metadata={"full_name": "Alex Reyes", "terms_accepted_at": "x", "data_consent_at": "x"},
    )

    response = db_client.get("/api/v1/me", headers=auth_header(user, email="alex@example.com"))

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == str(user)
    assert body["email"] == "alex@example.com"
    assert body["full_name"] == "Alex Reyes"
    assert body["role"] == "user"
    assert body["currency"] == "PHP"
    assert body["terms_accepted_at"] and body["data_consent_at"]


def test_get_me_recreates_a_missing_profile(
    db_client: TestClient, make_user, auth_header, admin_engine
) -> None:
    user = make_user()
    with admin_engine.begin() as conn:
        conn.execute(text("delete from profiles where user_id = :u"), {"u": user})

    response = db_client.get(
        "/api/v1/me",
        headers=auth_header(
            user,
            user_metadata={"full_name": "From Token", "terms_accepted_at": "2026-11-01T08:00:00Z"},
        ),
    )

    assert response.status_code == 200
    assert response.json()["full_name"] == "From Token"
    accepted = datetime.fromisoformat(response.json()["terms_accepted_at"])
    assert accepted == datetime(2026, 11, 1, 8, 0, tzinfo=UTC)
    assert response.json()["data_consent_at"] is None


def test_patch_me_updates_the_name_only(db_client: TestClient, make_user, auth_header) -> None:
    user = make_user(metadata={"full_name": "Old Name"})
    headers = auth_header(user)

    response = db_client.patch("/api/v1/me", headers=headers, json={"full_name": "  New Name "})

    assert response.status_code == 200
    assert response.json()["full_name"] == "New Name"
    assert db_client.get("/api/v1/me", headers=headers).json()["full_name"] == "New Name"


def test_users_never_see_each_others_profile(db_client: TestClient, make_user, auth_header) -> None:
    alice = make_user(metadata={"full_name": "Alice"})
    bob = make_user(metadata={"full_name": "Bob"})

    db_client.patch("/api/v1/me", headers=auth_header(bob), json={"full_name": "Bob Changed"})

    alice_me = db_client.get("/api/v1/me", headers=auth_header(alice)).json()
    assert alice_me["user_id"] == str(alice)
    assert alice_me["full_name"] == "Alice"


def test_token_for_a_deleted_account_cannot_create_data(
    db_client: TestClient, make_user, auth_header, admin_engine
) -> None:
    user = make_user()
    with admin_engine.begin() as conn:
        conn.execute(text("delete from auth.users where id = :u"), {"u": user})

    response = db_client.get("/api/v1/me", headers=auth_header(user))

    # The still-valid token can't recreate rows for a user that no longer exists.
    assert response.status_code == 401
    assert response.json()["detail"] == "This account no longer exists."
    with admin_engine.connect() as conn:
        count = conn.execute(text("select count(*) from profiles where user_id = :u"), {"u": user})
        assert count.scalar_one() == 0


def test_preferences_default_then_replace(db_client: TestClient, make_user, auth_header) -> None:
    user = make_user()
    headers = auth_header(user)

    defaults = db_client.get("/api/v1/me/preferences", headers=headers)
    assert defaults.status_code == 200
    assert defaults.json() == {
        "notify_budget": True,
        "notify_replenishment": True,
        "notify_shopping": True,
        "notify_meals": True,
        "budget_alert_pct": 90,
    }

    new = {
        "notify_budget": True,
        "notify_replenishment": False,
        "notify_shopping": True,
        "notify_meals": False,
        "budget_alert_pct": 80,
    }
    replaced = db_client.put("/api/v1/me/preferences", headers=headers, json=new)
    assert replaced.status_code == 200
    assert replaced.json() == new
    assert db_client.get("/api/v1/me/preferences", headers=headers).json() == new


@pytest.mark.parametrize(
    "body",
    [
        {"budget_alert_pct": 101},
        {"budget_alert_pct": 49},
        {"notify_meals": "false"},
        {"role": "admin"},
    ],
)
def test_invalid_preferences_are_rejected_and_not_saved(
    db_client: TestClient, make_user, auth_header, body: dict
) -> None:
    user = make_user()
    headers = auth_header(user)
    valid = {
        "notify_budget": True,
        "notify_replenishment": True,
        "notify_shopping": True,
        "notify_meals": True,
        "budget_alert_pct": 90,
    }

    response = db_client.put("/api/v1/me/preferences", headers=headers, json={**valid, **body})

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    assert db_client.get("/api/v1/me/preferences", headers=headers).json() == valid
