"""/replenishment and /shopping-lists against a real database (needs TEST_DATABASE_URL)."""

from datetime import date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.modules.expenses import periods
from app.modules.expenses.tests.test_transactions_api import categories
from app.modules.receipts.tests.test_receipts_api import fakes, upload  # noqa: F401 (fixture)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("fakes")]

SUGGESTIONS = "/api/v1/replenishment/suggestions"
LISTS = "/api/v1/shopping-lists"


def today() -> date:
    return periods.local_today()


def at(day: date) -> str:
    return datetime.combine(day, time(9), tzinfo=periods.app_tz()).isoformat()


def buy(
    client: TestClient, headers, cats, day: date, name: str = "Eggs large", price: str = "112.00"
) -> str:  # noqa: ANN001, E501
    receipt = upload(client, headers).json()
    response = client.post(
        f"/api/v1/receipts/{receipt['id']}/confirm",
        headers=headers,
        json={
            "category_id": cats["Groceries"],
            "occurred_at": at(day),
            "merchant": "ZZ Test Mart",
            "total": price,
            "discount": "0",
            "items": [{"name": name, "quantity": "1", "unit_price": price}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def history(client: TestClient, headers, cats, last: date, gaps: list[int], **kw) -> list[str]:  # noqa: ANN001, ANN003
    """Purchases ending on `last`, with these gaps (days) between them, oldest first."""
    days = [last]
    for gap in reversed(gaps):
        days.insert(0, days[0] - timedelta(days=gap))
    return [buy(client, headers, cats, d, **kw) for d in days]


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


def suggestions(client: TestClient, headers) -> list[dict]:  # noqa: ANN001
    response = client.get(SUGGESTIONS, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def feedback(client: TestClient, headers, sid: str, **body) -> dict:  # noqa: ANN001, ANN003
    response = client.post(f"{SUGGESTIONS}/{sid}/feedback", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def the_list(client: TestClient, headers) -> dict:  # noqa: ANN001
    response = client.get(LISTS, headers=headers)
    assert response.status_code == 200, response.text
    lists = response.json()
    assert len(lists) == 1
    return lists[0]


# ---------- generation ----------


def test_regular_sufficient_pattern_is_suggested_once(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    # Every 7 days, last bought 12 days ago → predicted 5 days ago (overdue = due).
    history(db_client, headers, cats, today() - timedelta(days=12), [7, 7, 7, 7])

    first = suggestions(db_client, headers)
    assert len(first) == 1
    s = first[0]
    assert s["product"]["name"] == "Eggs large"
    assert s["predicted_date"] == (today() - timedelta(days=5)).isoformat()
    assert s["days_until"] == -5 and s["status"] == "pending"
    assert (s["avg_interval_days"], s["confidence"]) == ("7.00", "1.000")
    assert suggestions(db_client, headers) == first  # idempotent, no duplicates


def test_not_due_limited_and_irregular_patterns_get_no_suggestion(
    db_client: TestClient, user
) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=1), [7, 7, 7, 7], name="Milk")
    history(db_client, headers, cats, today() - timedelta(days=20), [7, 7, 7], name="Rice")
    history(db_client, headers, cats, today() - timedelta(days=20), [1, 1, 1, 40], name="Soap")
    # Milk: due in 6 days (outside the 3-day window). Rice: limited (4 days). Soap: irregular.
    assert suggestions(db_client, headers) == []


def test_window_edge_three_days_ahead_is_due(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=4), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    assert s["days_until"] == 3


# ---------- feedback ----------


def test_add_to_list_creates_one_suggested_item(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7], price="95.50")
    [s] = suggestions(db_client, headers)

    result = feedback(db_client, headers, s["id"], action="add_to_list")
    assert result["suggestion"]["status"] == "added"
    item = result["shopping_item"]
    assert (item["name"], item["source"], item["quantity"]) == ("Eggs large", "suggested", "1.000")
    assert item["est_price"] == "95.50" and item["line_estimate"] == "95.50"

    assert suggestions(db_client, headers) == []  # answered for this cycle, not recreated
    again = db_client.post(
        f"{SUGGESTIONS}/{s['id']}/feedback", headers=headers, json={"action": "dismiss"}
    )
    assert again.status_code == 409
    listed = the_list(db_client, headers)
    assert [i["name"] for i in listed["items"]] == ["Eggs large"]
    assert listed["estimated_total"] == "95.50"


def test_still_have_some_snoozes_by_half_the_interval(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)

    result = feedback(db_client, headers, s["id"], action="still_have")["suggestion"]
    assert result["status"] == "modified"
    assert result["predicted_date"] == (today() + timedelta(days=4)).isoformat()  # max(3, 7/2→4)
    assert suggestions(db_client, headers) == []  # 4 days away: back when within 3 days


def test_bought_elsewhere_restarts_the_cycle_without_a_transaction(
    db_client: TestClient, user
) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    count_before = db_client.get("/api/v1/transactions/summary", headers=headers).json()["count"]
    [s] = suggestions(db_client, headers)

    assert (
        feedback(db_client, headers, s["id"], action="bought_elsewhere")["suggestion"]["status"]
        == "dismissed"
    )
    assert suggestions(db_client, headers) == []  # next due in 7 days
    assert (
        db_client.get("/api/v1/transactions/summary", headers=headers).json()["count"]
        == count_before
    )


def test_dont_remind_mutes_the_product_even_after_new_purchases(
    db_client: TestClient, user
) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=17), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    feedback(db_client, headers, s["id"], action="dont_remind")

    buy(db_client, headers, cats, today() - timedelta(days=10))  # a new cycle, due again
    assert suggestions(db_client, headers) == []


def test_modify_sets_date_and_quantity(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)

    past = db_client.post(
        f"{SUGGESTIONS}/{s['id']}/feedback",
        headers=headers,
        json={"action": "modify", "predicted_date": (today() - timedelta(days=1)).isoformat()},
    )
    assert past.status_code == 422
    empty = db_client.post(
        f"{SUGGESTIONS}/{s['id']}/feedback", headers=headers, json={"action": "modify"}
    )
    assert empty.status_code == 422

    feedback(
        db_client,
        headers,
        s["id"],
        action="modify",
        quantity="2",
        predicted_date=today().isoformat(),
    )
    [modified] = suggestions(db_client, headers)
    assert (modified["status"], modified["quantity"], modified["days_until"]) == (
        "modified",
        "2.000",
        0,
    )
    item = feedback(db_client, headers, s["id"], action="add_to_list")["shopping_item"]
    assert item["quantity"] == "2.000" and item["line_estimate"] == "224.00"


def test_a_new_purchase_closes_the_open_suggestion(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    assert len(suggestions(db_client, headers)) == 1
    buy(db_client, headers, cats, today())  # restocked: next due in ~7 days
    assert suggestions(db_client, headers) == []


def test_deleting_purchases_removes_the_suggestion(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    ids = history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    assert len(suggestions(db_client, headers)) == 1
    assert db_client.delete(f"/api/v1/transactions/{ids[0]}", headers=headers).status_code == 204
    assert suggestions(db_client, headers) == []  # 4 purchase days left: limited tier


def test_suggestions_are_private(
    db_client: TestClient, user, make_user, auth_header, as_user
) -> None:  # noqa: E501
    headers, cats, user_id = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    other_id = make_user()
    other = auth_header(other_id)

    assert suggestions(db_client, other) == []
    stolen = db_client.post(
        f"{SUGGESTIONS}/{s['id']}/feedback", headers=other, json={"action": "dismiss"}
    )
    assert stolen.status_code == 404
    assert (
        as_user(other_id)
        .execute(text("select count(*) from replenishment_suggestions"))
        .scalar_one()
        == 0
    )
    assert (
        as_user(user_id)
        .execute(text("select count(*) from replenishment_suggestions"))
        .scalar_one()
        == 1
    )


# ---------- shopping list ----------


def test_shopping_list_crud_totals_and_duplicates(db_client: TestClient, user) -> None:
    headers, _, _ = user
    first = the_list(db_client, headers)
    assert the_list(db_client, headers)["id"] == first["id"]  # one default list
    assert (first["name"], first["items"], first["estimated_total"]) == ("Grocery list", [], "0.00")
    items = f"{LISTS}/{first['id']}/items"

    lemons = db_client.post(
        items, headers=headers, json={"name": "Lemons", "quantity": "2", "est_price": "15.75"}
    )
    assert lemons.status_code == 201, lemons.text
    lemons = lemons.json()
    assert (lemons["source"], lemons["line_estimate"]) == ("manual", "31.50")
    salt = db_client.post(items, headers=headers, json={"name": "Salt"}).json()
    dup = db_client.post(items, headers=headers, json={"name": "  LEMONS "})
    assert dup.status_code == 409

    listed = the_list(db_client, headers)
    assert (listed["open_count"], listed["estimated_total"], listed["unpriced_count"]) == (
        2,
        "31.50",
        1,
    )

    ticked = db_client.patch(
        f"{items}/{lemons['id']}", headers=headers, json={"is_purchased": True}
    )
    assert ticked.status_code == 200 and ticked.json()["is_purchased"] is True
    listed = the_list(db_client, headers)
    assert (listed["open_count"], listed["purchased_count"]) == (1, 1)
    assert (listed["estimated_total"], listed["picked_total"]) == ("0.00", "31.50")
    # Bought lemons no longer block adding lemons again.
    assert db_client.post(items, headers=headers, json={"name": "Lemons"}).status_code == 201

    renamed = db_client.patch(f"{items}/{salt['id']}", headers=headers, json={"name": "Lemons"})
    assert renamed.status_code == 409
    assert db_client.patch(f"{items}/{salt['id']}", headers=headers, json={}).status_code == 422
    assert db_client.delete(f"{items}/{salt['id']}", headers=headers).status_code == 204
    assert db_client.delete(f"{items}/{salt['id']}", headers=headers).status_code == 404


def test_shopping_list_validation_and_isolation(
    db_client: TestClient, user, make_user, auth_header
) -> None:  # noqa: E501
    headers, _, _ = user
    mine = the_list(db_client, headers)
    items = f"{LISTS}/{mine['id']}/items"
    assert (
        db_client.post(items, headers=headers, json={"name": "Eggs", "quantity": "0"}).status_code
        == 422
    )
    assert db_client.post(items, headers=headers, json={"name": "   "}).status_code == 422
    assert (
        db_client.post(items, headers=headers, json={"name": "Eggs", "est_price": "-1"}).status_code
        == 422
    )
    item = db_client.post(items, headers=headers, json={"name": "Eggs"}).json()

    other = auth_header(make_user())
    assert db_client.post(items, headers=other, json={"name": "Mine now"}).status_code == 404
    assert (
        db_client.patch(
            f"{items}/{item['id']}", headers=other, json={"is_purchased": True}
        ).status_code
        == 404
    )
    assert db_client.delete(f"{items}/{item['id']}", headers=other).status_code == 404
    assert the_list(db_client, other)["id"] != mine["id"]
    assert db_client.get(LISTS).status_code == 401


def test_list_is_checked_against_the_groceries_budget(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    budget = db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={
            "category_id": cats["Groceries"],
            "period_type": "monthly",
            "limit_amount": "1000.00",
        },
    )
    assert budget.status_code == 201, budget.text
    spent = db_client.post(
        "/api/v1/transactions",
        headers=headers,
        json={"amount": "200.00", "category_id": cats["Groceries"], "occurred_at": at(today())},
    )
    assert spent.status_code == 201
    lst = the_list(db_client, headers)
    db_client.post(
        f"{LISTS}/{lst['id']}/items", headers=headers, json={"name": "Rice", "est_price": "150.00"}
    )

    b = the_list(db_client, headers)["budget"]
    assert b["label"] == "Groceries"
    assert (b["remaining"], b["remaining_after"], b["percent_left_after"]) == (
        "800.00",
        "650.00",
        65,
    )


# ---------- muting ----------

MUTED = "/api/v1/replenishment/muted"


def test_undo_dont_remind_reopens_the_same_suggestion(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    feedback(db_client, headers, s["id"], action="dont_remind")

    [muted] = db_client.get(MUTED, headers=headers).json()
    assert muted["product"] == s["product"]
    assert suggestions(db_client, headers) == []

    assert db_client.delete(f"{MUTED}/{s['product']['id']}", headers=headers).status_code == 204
    assert db_client.get(MUTED, headers=headers).json() == []
    [back] = suggestions(db_client, headers)
    assert (back["id"], back["status"], back["predicted_date"]) == (
        s["id"],
        "pending",
        s["predicted_date"],
    )
    assert suggestions(db_client, headers) == [back]  # still one, no duplicate
    # Answerable again, and muting again works.
    feedback(db_client, headers, back["id"], action="dont_remind")
    assert len(db_client.get(MUTED, headers=headers).json()) == 1


def test_unmuting_later_waits_for_the_next_due_cycle(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=17), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    feedback(db_client, headers, s["id"], action="dont_remind")
    buy(db_client, headers, cats, today() - timedelta(days=1))  # restocked while muted

    assert db_client.delete(f"{MUTED}/{s['product']['id']}", headers=headers).status_code == 204
    assert suggestions(db_client, headers) == []  # next due in ~6 days, not reopened early


def test_unmute_errors_and_isolation(db_client: TestClient, user, make_user, auth_header) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    [s] = suggestions(db_client, headers)
    product = s["product"]["id"]
    assert db_client.delete(f"{MUTED}/{product}", headers=headers).status_code == 404  # not muted
    feedback(db_client, headers, s["id"], action="dont_remind")

    other = auth_header(make_user())
    assert db_client.get(MUTED, headers=other).json() == []
    assert db_client.delete(f"{MUTED}/{product}", headers=other).status_code == 404
    assert len(db_client.get(MUTED, headers=headers).json()) == 1
    assert db_client.get(MUTED).status_code == 401
