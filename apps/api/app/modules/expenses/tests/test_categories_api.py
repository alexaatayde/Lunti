"""/categories against a real database (needs TEST_DATABASE_URL)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

pytestmark = pytest.mark.db

DEFAULTS = ["Groceries", "Dining out", "Transport", "Utilities", "Household", "Others"]


def _names(response) -> list[str]:  # noqa: ANN001
    return [c["name"] for c in response.json()]


def test_lists_defaults_in_design_order(db_client: TestClient, make_user, auth_header) -> None:
    response = db_client.get("/api/v1/categories", headers=auth_header(make_user()))

    assert response.status_code == 200
    assert _names(response) == DEFAULTS
    assert all(c["is_default"] for c in response.json())


def test_create_list_rename_delete_own_category(
    db_client: TestClient, make_user, auth_header
) -> None:
    headers = auth_header(make_user())

    created = db_client.post(
        "/api/v1/categories", headers=headers, json={"name": " Pets ", "icon": "paw"}
    )
    assert created.status_code == 201
    category = created.json()
    assert category["name"] == "Pets" and category["is_default"] is False

    assert _names(db_client.get("/api/v1/categories", headers=headers)) == [*DEFAULTS, "Pets"]

    renamed = db_client.patch(
        f"/api/v1/categories/{category['id']}", headers=headers, json={"name": "Pet care"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Pet care" and renamed.json()["icon"] == "paw"

    deleted = db_client.delete(f"/api/v1/categories/{category['id']}", headers=headers)
    assert deleted.status_code == 204
    assert _names(db_client.get("/api/v1/categories", headers=headers)) == DEFAULTS


@pytest.mark.parametrize("name", ["pets", "PETS", "groceries", "Dining Out"])
def test_duplicate_names_conflict(db_client: TestClient, make_user, auth_header, name) -> None:
    headers = auth_header(make_user())
    db_client.post("/api/v1/categories", headers=headers, json={"name": "Pets"})

    response = db_client.post("/api/v1/categories", headers=headers, json={"name": name})

    assert response.status_code == 409
    assert response.json()["type"] == "urn:lunti:problem:category-exists"


def test_same_name_is_fine_for_different_users(
    db_client: TestClient, make_user, auth_header
) -> None:
    for _ in range(2):
        response = db_client.post(
            "/api/v1/categories", headers=auth_header(make_user()), json={"name": "Pets"}
        )
        assert response.status_code == 201


def test_other_users_categories_are_invisible_and_untouchable(
    db_client: TestClient, make_user, auth_header
) -> None:
    alice, bob = auth_header(make_user()), auth_header(make_user())
    bobs = db_client.post("/api/v1/categories", headers=bob, json={"name": "Bob only"}).json()

    assert "Bob only" not in _names(db_client.get("/api/v1/categories", headers=alice))
    path = f"/api/v1/categories/{bobs['id']}"
    assert db_client.patch(path, headers=alice, json={"name": "Mine now"}).status_code == 404
    assert db_client.delete(path, headers=alice).status_code == 404
    assert "Bob only" in _names(db_client.get("/api/v1/categories", headers=bob))


def test_default_categories_cannot_be_changed(
    db_client: TestClient, make_user, auth_header
) -> None:
    headers = auth_header(make_user())
    groceries = db_client.get("/api/v1/categories", headers=headers).json()[0]
    path = f"/api/v1/categories/{groceries['id']}"

    assert db_client.patch(path, headers=headers, json={"name": "Food"}).status_code == 403
    assert db_client.delete(path, headers=headers).status_code == 403


def test_unknown_category_is_404(db_client: TestClient, make_user, auth_header) -> None:
    response = db_client.delete(
        f"/api/v1/categories/{uuid.uuid4()}", headers=auth_header(make_user())
    )
    assert response.status_code == 404


def test_a_category_in_use_cannot_be_deleted(
    db_client: TestClient, make_user, auth_header, admin_engine
) -> None:
    user = make_user()
    headers = auth_header(user)
    category = db_client.post("/api/v1/categories", headers=headers, json={"name": "Pets"}).json()
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                "insert into transactions (user_id, category_id, amount, occurred_at)"
                " values (:u, :c, 250, now())"
            ),
            {"u": user, "c": category["id"]},
        )

    response = db_client.delete(f"/api/v1/categories/{category['id']}", headers=headers)

    assert response.status_code == 409
    assert response.json()["type"] == "urn:lunti:problem:category-in-use"


def test_empty_patch_is_rejected(db_client: TestClient, make_user, auth_header) -> None:
    headers = auth_header(make_user())
    category = db_client.post("/api/v1/categories", headers=headers, json={"name": "Pets"}).json()

    response = db_client.patch(f"/api/v1/categories/{category['id']}", headers=headers, json={})

    assert response.status_code == 422
