"""/budgets and budget recalculation (AGENTS.md §7.2) against a real database."""

import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.modules.expenses import periods
from app.modules.expenses.tests.test_transactions_api import add, categories, now_local

pytestmark = pytest.mark.db

API = "/api/v1/budgets"
TXN = "/api/v1/transactions"


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


def today() -> date:
    return periods.local_today()


def create(client: TestClient, headers: dict[str, str], **body) -> dict:  # noqa: ANN003
    response = client.post(API, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def status_of(client: TestClient, headers: dict[str, str], budget_id: str) -> dict:
    return next(
        s
        for s in client.get(f"{API}/status", headers=headers).json()
        if s["budget"]["id"] == budget_id
    )


def stored_level(admin_engine, budget_id: str) -> str:  # noqa: ANN001
    with admin_engine.connect() as conn:
        return conn.scalar(
            text("select last_alert_level from public.budgets where id = :id"), {"id": budget_id}
        )


# ---------- create / list / status ----------


def test_create_monthly_category_budget_and_status(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    created = create(
        db_client,
        headers,
        category_id=cats["Dining out"],
        period_type="monthly",
        limit_amount="2000.00",
    )

    assert created["budget"]["label"] == "Dining out"
    assert created["budget"]["start_date"] == today().isoformat()  # defaults to today
    assert created["budget"]["limit_amount"] == "2000.00"
    assert created["state"] == "active"
    assert created["spent"] == "0.00" and created["remaining"] == "2000.00"
    assert created["level"] == "none" and created["percent_used"] == 0
    assert (
        created["period_end"]
        == periods.period_containing(_B("monthly", today(), None), today())[1].isoformat()
    )

    add(db_client, headers, amount="1930.00", category_id=cats["Dining out"])
    add(db_client, headers, amount="500.00", category_id=cats["Groceries"])  # other category

    status = status_of(db_client, headers, created["budget"]["id"])
    assert status["spent"] == "1930.00"
    assert status["remaining"] == "70.00"
    assert status["percent_used"] == 97
    assert status["level"] == "near"


def test_overall_budget_counts_every_category(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    overall = create(db_client, headers, period_type="weekly", limit_amount="500.00")
    assert overall["budget"]["category"] is None and overall["budget"]["label"] == "Overall"

    add(db_client, headers, amount="300.00", category_id=cats["Transport"])
    add(db_client, headers, amount="220.00", category_id=cats["Groceries"])

    status = status_of(db_client, headers, overall["budget"]["id"])
    assert status["spent"] == "520.00"
    assert status["remaining"] == "-20.00"  # "Over by ₱20"
    assert status["percent_used"] == 104
    assert status["level"] == "exceeded"
    assert status["safe_daily_amount"] == "0.00" and status["on_pace"] is False


def test_spending_outside_the_period_is_ignored(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    daily = create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="daily",
        start_date=(today() - timedelta(days=30)).isoformat(),
        limit_amount="100.00",
    )
    yesterday = now_local() - timedelta(days=1)
    add(
        db_client,
        headers,
        amount="90.00",
        category_id=cats["Groceries"],
        occurred_at=yesterday.isoformat(),
    )
    add(db_client, headers, amount="15.50", category_id=cats["Groceries"])

    status = status_of(db_client, headers, daily["budget"]["id"])
    assert status["period_start"] == status["period_end"] == today().isoformat()
    assert status["spent"] == "15.50"
    assert status["days_left"] == 1 and status["safe_daily_amount"] == "84.50"


def test_custom_upcoming_and_ended_budgets(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    upcoming = create(
        db_client,
        headers,
        category_id=cats["Utilities"],
        period_type="custom",
        start_date=(today() + timedelta(days=5)).isoformat(),
        end_date=(today() + timedelta(days=19)).isoformat(),
        limit_amount="2500.00",
    )
    ended = create(
        db_client,
        headers,
        category_id=cats["Household"],
        period_type="custom",
        start_date=(today() - timedelta(days=20)).isoformat(),
        end_date=(today() - timedelta(days=10)).isoformat(),
        limit_amount="100.00",
    )
    add(
        db_client,
        headers,
        amount="40.00",
        category_id=cats["Household"],
        occurred_at=(now_local() - timedelta(days=15)).isoformat(),
    )

    statuses = db_client.get(f"{API}/status", headers=headers).json()
    by_id = {s["budget"]["id"]: s for s in statuses}
    assert by_id[upcoming["budget"]["id"]]["state"] == "upcoming"
    assert by_id[upcoming["budget"]["id"]]["days_left"] == 0
    assert by_id[ended["budget"]["id"]]["state"] == "ended"
    assert by_id[ended["budget"]["id"]]["spent"] == "40.00"
    # Active first, then upcoming, then ended.
    assert [s["state"] for s in statuses] == ["upcoming", "ended"]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"period_type": "custom"}, "end_date"),
        (
            {"period_type": "monthly", "start_date": "2026-11-10", "end_date": "2026-11-01"},
            "end_date",
        ),
        ({"period_type": "yearly"}, "period_type"),
        ({"period_type": "monthly", "limit_amount": "0"}, "limit_amount"),
        ({"period_type": "monthly", "limit_amount": "-10"}, "limit_amount"),
        ({"period_type": "monthly", "limit_amount": "1.999"}, "limit_amount"),
        ({"period_type": "monthly", "category_id": str(uuid.uuid4())}, "category_id"),
    ],
)
def test_budget_validation(db_client: TestClient, user, body, field: str) -> None:  # noqa: ANN001
    headers, _, _ = user
    response = db_client.post(API, headers=headers, json={"limit_amount": "100.00", **body})

    assert response.status_code == 422
    assert field in [e["field"] for e in response.json()["errors"]]
    assert db_client.get(API, headers=headers).json() == []


def test_duplicate_overlapping_budget_conflicts(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="850.00",
    )

    again = db_client.post(
        API,
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": "900.00"},
    )
    assert again.status_code == 409
    assert again.json()["type"] == "urn:lunti:problem:budget-exists"
    # A different period type or category is fine.
    create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="weekly",
        limit_amount="200.00",
    )
    create(
        db_client,
        headers,
        category_id=cats["Transport"],
        period_type="monthly",
        limit_amount="200.00",
    )


def test_edit_and_delete_budget(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    budget = create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="850.00",
    )["budget"]
    add(db_client, headers, amount="512.40", category_id=cats["Groceries"])
    path = f"{API}/{budget['id']}"

    edited = db_client.patch(
        path, headers=headers, json={"limit_amount": "550.00", "alerts_enabled": False}
    )
    assert edited.status_code == 200
    assert edited.json()["budget"]["limit_amount"] == "550.00"
    assert edited.json()["budget"]["alerts_enabled"] is False
    assert edited.json()["remaining"] == "37.60"
    assert edited.json()["level"] == "near"

    assert db_client.patch(path, headers=headers, json={}).status_code == 422
    assert db_client.patch(path, headers=headers, json={"period_type": None}).status_code == 422

    assert db_client.delete(path, headers=headers).status_code == 204
    assert db_client.get(path, headers=headers).status_code == 404
    # The transactions stay.
    assert db_client.get(TXN, headers=headers).json()["items"][0]["amount"] == "512.40"


# ---------- recalculation and alerts (§7.2) ----------


def test_alerts_fire_once_when_the_level_rises_and_reset_when_it_falls(
    db_client: TestClient, user, admin_engine
) -> None:  # noqa: ANN001
    headers, cats, _ = user
    budget_id = create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="100.00",
    )["budget"]["id"]
    groceries = cats["Groceries"]

    first = add(db_client, headers, amount="50.00", category_id=groceries)
    assert first["budget_alerts"] == [] and stored_level(admin_engine, budget_id) == "none"

    near = add(db_client, headers, amount="40.00", category_id=groceries)  # 90 %
    assert [(a["label"], a["level"], a["remaining"]) for a in near["budget_alerts"]] == [
        ("Groceries", "near", "10.00")
    ]
    assert stored_level(admin_engine, budget_id) == "near"

    # Still near: no duplicate alert.
    assert add(db_client, headers, amount="1.00", category_id=groceries)["budget_alerts"] == []

    over = add(db_client, headers, amount="9.00", category_id=groceries)  # exactly 100 → exceeded
    assert [a["level"] for a in over["budget_alerts"]] == ["exceeded"]
    assert stored_level(admin_engine, budget_id) == "exceeded"

    # Deleting brings it back down: level resets silently…
    assert db_client.delete(f"{TXN}/{over['id']}", headers=headers).status_code == 204
    assert stored_level(admin_engine, budget_id) == "near"
    # …so exceeding again alerts again.
    again = db_client.patch(f"{TXN}/{near['id']}", headers=headers, json={"amount": "60.00"})
    assert [a["level"] for a in again.json()["budget_alerts"]] == ["exceeded"]

    # Moving the expense to another category lowers this budget.
    moved = db_client.patch(
        f"{TXN}/{near['id']}", headers=headers, json={"category_id": cats["Household"]}
    )
    assert moved.json()["budget_alerts"] == []
    assert stored_level(admin_engine, budget_id) == "none"


def test_disabled_alerts_still_track_level(db_client: TestClient, user, admin_engine) -> None:  # noqa: ANN001
    headers, cats, _ = user
    budget_id = create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="10.00",
        alerts_enabled=False,
    )["budget"]["id"]

    saved = add(db_client, headers, amount="20.00", category_id=cats["Groceries"])

    assert saved["budget_alerts"] == []
    assert stored_level(admin_engine, budget_id) == "exceeded"


def test_user_threshold_preference_is_used(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    prefs = db_client.get("/api/v1/me/preferences", headers=headers).json()
    db_client.put("/api/v1/me/preferences", headers=headers, json={**prefs, "budget_alert_pct": 75})
    create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="100.00",
    )

    saved = add(db_client, headers, amount="75.00", category_id=cats["Groceries"])

    assert [a["level"] for a in saved["budget_alerts"]] == ["near"]


def test_a_new_period_starts_with_a_fresh_level(db_client: TestClient, user, admin_engine) -> None:  # noqa: ANN001
    headers, cats, _ = user
    budget_id = create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="daily",
        start_date=(today() - timedelta(days=3)).isoformat(),
        limit_amount="10.00",
    )["budget"]["id"]
    # Pretend the budget was last saved as "exceeded" two days ago (an earlier period).
    with admin_engine.begin() as conn:
        conn.execute(text("set local session_replication_role = replica"))  # skip triggers
        conn.execute(
            text(
                "update public.budgets set last_alert_level = 'exceeded',"
                " updated_at = now() - interval '2 days' where id = :id"
            ),
            {"id": budget_id},
        )

    saved = add(db_client, headers, amount="12.00", category_id=cats["Groceries"])

    assert [a["level"] for a in saved["budget_alerts"]] == ["exceeded"]


def test_transaction_detail_shows_budget_impact(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats, _ = user
    create(
        db_client,
        headers,
        category_id=cats["Groceries"],
        period_type="monthly",
        limit_amount="850.00",
    )
    create(db_client, headers, period_type="monthly", limit_amount="15000.00")
    create(
        db_client,
        headers,
        category_id=cats["Transport"],
        period_type="monthly",
        limit_amount="500.00",
    )
    add(db_client, headers, amount="465.60", category_id=cats["Groceries"])
    txn = add(db_client, headers, amount="46.80", category_id=cats["Groceries"])

    budgets = db_client.get(f"{TXN}/{txn['id']}", headers=headers).json()["budgets"]

    assert [
        (b["label"], b["remaining"], b["remaining_without_this"], b["percent_used"])
        for b in budgets
    ] == [
        ("Groceries", "337.60", "384.40", 60),  # TxnDelete.png numbers
        ("Overall", "14487.60", "14534.40", 3),
    ]


# ---------- isolation ----------


def test_other_users_budgets_are_invisible_and_untouchable(
    db_client: TestClient, make_user, auth_header
) -> None:
    alice, bob = auth_header(make_user()), auth_header(make_user())
    bobs = create(db_client, bob, period_type="monthly", limit_amount="100.00")["budget"]
    add(db_client, bob, amount="80.00", category_id=categories(db_client, bob)["Groceries"])
    path = f"{API}/{bobs['id']}"

    assert db_client.get(API, headers=alice).json() == []
    assert db_client.get(f"{API}/status", headers=alice).json() == []
    assert db_client.get(path, headers=alice).status_code == 404
    assert db_client.patch(path, headers=alice, json={"limit_amount": "1.00"}).status_code == 404
    assert db_client.delete(path, headers=alice).status_code == 404
    # Alice's overall budget never counts Bob's spending.
    mine = create(db_client, alice, period_type="monthly", limit_amount="100.00")
    assert mine["spent"] == "0.00"
    assert db_client.get(path, headers=bob).json()["spent"] == "80.00"


def test_budget_on_another_users_category_is_rejected(
    db_client: TestClient, make_user, auth_header
) -> None:
    alice, bob = auth_header(make_user()), auth_header(make_user())
    secret = db_client.post("/api/v1/categories", headers=bob, json={"name": "Secret"}).json()

    response = db_client.post(
        API,
        headers=alice,
        json={"category_id": secret["id"], "period_type": "monthly", "limit_amount": "10.00"},
    )

    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "category_id"


class _B:
    def __init__(self, period_type: str, start_date: date, end_date: date | None) -> None:
        self.period_type, self.start_date, self.end_date = period_type, start_date, end_date
