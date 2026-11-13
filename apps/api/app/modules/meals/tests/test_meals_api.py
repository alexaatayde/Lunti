"""/pantry, /recipes and /admin/recipes against a real database (needs TEST_DATABASE_URL)."""

from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.modules.expenses import periods
from app.modules.expenses.tests.test_transactions_api import categories
from app.modules.receipts.tests.test_receipts_api import fakes, upload  # noqa: F401 (fixture)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("fakes")]

PANTRY = "/api/v1/pantry"
RECS = "/api/v1/recipes/recommendations"


def at(day: date) -> str:
    return datetime.combine(day, time(9), tzinfo=periods.app_tz()).isoformat()


def confirm(client: TestClient, headers, cats, items, category: str = "Groceries", day=None) -> str:  # noqa: ANN001
    """items: [(name, quantity, unit_price, unit)]"""
    receipt = upload(client, headers).json()
    body_items = [
        {"name": n, "quantity": q, "unit_price": p, **({"unit": u} if u else {})}
        for n, q, p, u in items
    ]
    total = sum(
        (Decimal(q) * Decimal(p)).quantize(Decimal("0.01"), ROUND_HALF_UP) for _, q, p, _ in items
    )
    response = client.post(
        f"/api/v1/receipts/{receipt['id']}/confirm",
        headers=headers,
        json={
            "category_id": cats[category],
            "occurred_at": at(day or periods.local_today()),
            "merchant": "ZZ Test Mart",
            "total": str(total),
            "discount": "0",
            "items": body_items,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


def pantry(client: TestClient, headers) -> dict:  # noqa: ANN001
    response = client.get(PANTRY, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def item(page: dict, name: str) -> dict:
    return next(i for i in page["items"] if i["name"] == name)


# ---------- pantry ----------


def test_grocery_receipts_fill_the_estimated_pantry(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    assert pantry(db_client, headers)["items"] == []
    confirm(
        db_client,
        headers,
        cats,
        [("Eggs large", "12", "8.00", "pcs"), ("Garlic", "1", "30.00", None)],
    )
    confirm(db_client, headers, cats, [("EGGS LARGE", "6", "8.00", "pcs")])  # same product
    confirm(db_client, headers, cats, [("Dish soap", "1", "75.00", None)], category="Household")

    page = pantry(db_client, headers)
    names = {i["name"] for i in page["items"]}
    assert names == {"Eggs large", "Garlic"}  # household items never reach the pantry
    eggs = item(page, "Eggs large")
    assert (eggs["quantity"], eggs["unit"], eggs["confirmed"], eggs["state"]) == (
        "18.000",
        "pcs",
        False,
        "in_stock",
    )
    assert eggs["estimated_expiry"] is None  # never guessed
    assert page["estimated_count"] == 2 and page["in_stock_count"] == 2


def test_units_convert_or_the_latest_purchase_wins(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(db_client, headers, cats, [("Chicken", "1", "210.00", "kg")])
    confirm(db_client, headers, cats, [("Chicken", "500", "0.22", "g")])
    assert item(pantry(db_client, headers), "Chicken")["quantity"] == "1.500"  # kg
    confirm(db_client, headers, cats, [("Chicken", "1", "120.00", "pack")])  # can't compare
    chicken = item(pantry(db_client, headers), "Chicken")
    assert (chicken["quantity"], chicken["unit"]) == ("1.000", "pack")


def test_a_confirmed_amount_is_never_overwritten_by_a_mismatched_unit(
    db_client: TestClient, user
) -> None:
    headers, cats, _ = user
    confirm(db_client, headers, cats, [("Chicken", "1", "210.00", "kg")])
    chicken = item(pantry(db_client, headers), "Chicken")
    db_client.patch(f"{PANTRY}/{chicken['id']}", headers=headers, json={"quantity": "2"})
    confirm(db_client, headers, cats, [("Chicken", "1", "120.00", "pack")])  # can't compare
    after = item(pantry(db_client, headers), "Chicken")
    assert (after["quantity"], after["unit"], after["confirmed"]) == ("2.000", "kg", True)
    confirm(db_client, headers, cats, [("Chicken", "500", "0.22", "g")])  # compatible: added
    after = item(pantry(db_client, headers), "Chicken")
    assert (after["quantity"], after["unit"], after["confirmed"]) == ("2.500", "kg", False)


def test_deleting_a_receipt_takes_its_estimate_off(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(db_client, headers, cats, [("Rice", "2", "60.00", "kg")])
    second = confirm(db_client, headers, cats, [("Rice", "5", "60.00", "kg")])
    assert db_client.delete(f"/api/v1/transactions/{second}", headers=headers).status_code == 204
    assert item(pantry(db_client, headers), "Rice")["quantity"] == "2.000"


def test_adjusting_confirms_and_deleting_never_goes_negative(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    tid = confirm(db_client, headers, cats, [("Milk", "2", "98.00", "pcs")])
    milk = item(pantry(db_client, headers), "Milk")

    adjusted = db_client.patch(f"{PANTRY}/{milk['id']}", headers=headers, json={"quantity": "1"})
    assert adjusted.status_code == 200, adjusted.text
    assert (adjusted.json()["quantity"], adjusted.json()["confirmed"]) == ("1.000", True)
    # A confirmed amount isn't changed by deleting the purchase.
    assert db_client.delete(f"/api/v1/transactions/{tid}", headers=headers).status_code == 204
    assert item(pantry(db_client, headers), "Milk")["quantity"] == "1.000"

    zero = db_client.patch(f"{PANTRY}/{milk['id']}", headers=headers, json={"quantity": "0"})
    assert zero.json()["state"] == "depleted"
    assert pantry(db_client, headers)["depleted_count"] == 1
    assert (
        db_client.patch(
            f"{PANTRY}/{milk['id']}", headers=headers, json={"quantity": "-1"}
        ).status_code
        == 422
    )  # noqa: E501
    assert db_client.patch(f"{PANTRY}/{milk['id']}", headers=headers, json={}).status_code == 422


def test_unconfirmed_estimate_is_clamped_at_zero(
    db_client: TestClient, user, admin_engine: Engine
) -> None:  # noqa: E501
    headers, cats, user_id = user
    tid = confirm(db_client, headers, cats, [("Bananas", "3", "10.00", "pcs")])
    with admin_engine.begin() as conn:  # e.g. an earlier manual lowering, then re-estimated
        conn.execute(
            text("update ingredient_inventory set estimated_quantity = 1 where user_id = :u"),
            {"u": user_id},
        )
    db_client.delete(f"/api/v1/transactions/{tid}", headers=headers)
    assert item(pantry(db_client, headers), "Bananas")["quantity"] == "0.000"


def test_expiry_is_user_set_and_drives_use_first(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(
        db_client,
        headers,
        cats,
        [("Spinach", "1", "40.00", "bunch"), ("Onion", "3", "10.00", "pcs")],
    )
    spinach = item(pantry(db_client, headers), "Spinach")
    soon = (periods.local_today() + timedelta(days=1)).isoformat()
    out = db_client.patch(
        f"{PANTRY}/{spinach['id']}", headers=headers, json={"estimated_expiry": soon}
    )
    assert (out.json()["days_left"], out.json()["state"], out.json()["confirmed"]) == (
        1,
        "use_soon",
        False,
    )
    page = pantry(db_client, headers)
    assert [i["name"] for i in page["use_first"]] == ["Spinach"] and page["use_soon_count"] == 1
    confirmed = db_client.patch(
        f"{PANTRY}/{spinach['id']}", headers=headers, json={"confirmed": True}
    )
    assert confirmed.json()["confirmed"] is True


def test_pantry_is_private(db_client: TestClient, user, make_user, auth_header, as_user) -> None:
    headers, cats, user_id = user
    confirm(db_client, headers, cats, [("Eggs", "6", "8.00", "pcs")])
    eggs = item(pantry(db_client, headers), "Eggs")
    other_id = make_user()
    other = auth_header(other_id)
    assert pantry(db_client, other)["items"] == []
    assert (
        db_client.patch(f"{PANTRY}/{eggs['id']}", headers=other, json={"quantity": "0"}).status_code
        == 404
    )
    assert (
        as_user(other_id).execute(text("select count(*) from ingredient_inventory")).scalar_one()
        == 0
    )
    assert (
        as_user(user_id).execute(text("select count(*) from ingredient_inventory")).scalar_one()
        == 1
    )
    assert db_client.get(PANTRY).status_code == 401


# ---------- recipes ----------


def recs(client: TestClient, headers) -> dict:  # noqa: ANN001
    response = client.get(RECS, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_catalog_is_seeded_and_empty_pantry_has_no_recommendations(
    db_client: TestClient, user, admin_engine: Engine
) -> None:  # noqa: E501
    headers, _, _ = user
    with admin_engine.connect() as conn:
        names = set(conn.execute(text("select name from recipes")).scalars())
    assert {"Chicken adobo", "Tortang talong", "Scrambled eggs with tomatoes"} <= names
    assert len(names) >= 20
    assert recs(db_client, headers)["items"] == []


def test_recommendations_rank_by_match_and_price_missing_items(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(
        db_client,
        headers,
        cats,
        [
            ("Eggs large", "12", "8.00", "pcs"),
            ("Tomatoes", "4", "12.00", "pcs"),
            ("Onion", "3", "10.00", "pcs"),
        ],
    )  # noqa: E501
    # Bought once before (now used up): a known price for a missing ingredient.
    tid = confirm(db_client, headers, cats, [("Cooking oil 1L", "1", "120.00", None)])
    oil = item(pantry(db_client, headers), "Cooking oil 1L")
    db_client.patch(f"{PANTRY}/{oil['id']}", headers=headers, json={"quantity": "0"})
    assert tid

    page = recs(db_client, headers)
    top = page["items"][0]
    assert (top["name"], top["match_pct"], top["missing"]) == (
        "Scrambled eggs with tomatoes",
        100,
        [],
    )
    assert [r["match_pct"] for r in page["items"]] == sorted(
        (r["match_pct"] for r in page["items"]), reverse=True
    )  # noqa: E501
    torta = next(r for r in page["items"] if r["name"] == "Tortang talong")
    assert torta["match_pct"] == 33  # eggs only, of eggplant/eggs/oil
    missing = {m["name"]: m["est_price"] for m in torta["missing"]}
    assert missing == {"eggplant": None, "cooking oil": "120.00"}  # never invented
    assert (torta["missing_cost"], torta["missing_unpriced_count"]) == ("120.00", 1)
    assert page["budget_label"] is None and page["over_budget_count"] == 0


def test_recipe_detail_flags_amounts_it_cannot_compare(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(
        db_client, headers, cats, [("Eggs", "6", "8.00", None), ("Tomato", "3", "12.00", "pcs")]
    )
    rid = next(
        r["id"]
        for r in recs(db_client, headers)["items"]
        if r["name"] == "Scrambled eggs with tomatoes"
    )  # noqa: E501
    detail = db_client.get(f"/api/v1/recipes/{rid}", headers=headers).json()
    status = {i["name"]: (i["status"], i["pantry_item_name"]) for i in detail["ingredients"]}
    assert status == {
        "eggs": ("check_amount", "Eggs"),  # receipt had no unit
        "tomato": ("available", "Tomato"),
        "onion": ("missing", None),
    }
    assert (detail["match_pct"], detail["check_amount_count"]) == (66, 1)
    assert (
        db_client.get(
            "/api/v1/recipes/00000000-0000-4000-8000-000000000000", headers=headers
        ).status_code
        == 404
    )  # noqa: E501


def test_add_missing_uses_the_list_without_duplicates(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(db_client, headers, cats, [("Eggs", "6", "8.00", "pcs")])
    rid = next(
        r["id"]
        for r in recs(db_client, headers)["items"]
        if r["name"] == "Scrambled eggs with tomatoes"
    )  # noqa: E501
    first = db_client.post(f"/api/v1/recipes/{rid}/add-missing", headers=headers)
    assert first.status_code == 200, first.text
    added = first.json()["added"]
    assert sorted(i["name"] for i in added) == ["Onion", "Tomato"]
    assert {i["source"] for i in added} == {"recipe"} and {i["recipe_id"] for i in added} == {rid}

    again = db_client.post(f"/api/v1/recipes/{rid}/add-missing", headers=headers).json()
    assert again["added"] == [] and sorted(again["already_on_list"]) == ["Onion", "Tomato"]
    items = db_client.get("/api/v1/shopping-lists", headers=headers).json()[0]["items"]
    assert sorted(i["name"] for i in items) == ["Onion", "Tomato"]


def test_recipes_over_the_food_budget_are_left_out(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    confirm(db_client, headers, cats, [("Chicken", "1", "210.00", "kg")])
    confirm(db_client, headers, cats, [("Soy sauce", "1", "45.00", None)])
    soy = item(pantry(db_client, headers), "Soy sauce")
    db_client.patch(f"{PANTRY}/{soy['id']}", headers=headers, json={"quantity": "0"})  # used up
    before = {r["name"]: r for r in recs(db_client, headers)["items"]}
    assert Decimal(before["Chicken adobo"]["missing_cost"]) == Decimal("45.00")

    # ₱290 Groceries budget, ₱255 spent → ₱35 left: adobo's known ₱45 doesn't fit.
    budget = db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": "290.00"},
    )
    assert budget.status_code == 201
    page = recs(db_client, headers)
    assert (page["budget_label"], page["budget_remaining"]) == ("Groceries", "35.00")
    assert "Chicken adobo" not in {r["name"] for r in page["items"]}
    assert page["over_budget_count"] >= 1
    assert all(Decimal(r["missing_cost"]) <= Decimal("35.00") for r in page["items"])


# ---------- admin catalog ----------


def test_only_admins_add_catalog_recipes(db_client: TestClient, user, admin_engine: Engine) -> None:
    headers, _, user_id = user
    body = {
        "name": "ZZ Test lumpia",
        "servings": 4,
        "prep_time_minutes": 40,
        "ingredients": [{"name": "lumpia wrapper", "quantity": "1", "unit": "pack"}],
    }
    assert db_client.post("/api/v1/admin/recipes", headers=headers, json=body).status_code == 403
    with admin_engine.begin() as conn:
        conn.execute(text("update profiles set role = 'admin' where user_id = :u"), {"u": user_id})
    created = db_client.post("/api/v1/admin/recipes", headers=headers, json=body)
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "ZZ Test lumpia" and created.json()["total_count"] == 1
    bad = db_client.post("/api/v1/admin/recipes", headers=headers, json={**body, "ingredients": []})
    assert bad.status_code == 422
    with admin_engine.begin() as conn:
        conn.execute(text("delete from recipes where name = 'ZZ Test lumpia'"))
