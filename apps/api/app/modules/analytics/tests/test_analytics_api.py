"""/analytics against a real database (needs TEST_DATABASE_URL)."""

from datetime import date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.modules.expenses import periods
from app.modules.expenses.tests.test_transactions_api import add, categories
from app.modules.receipts.tests.test_receipts_api import fakes, upload  # noqa: F401 (fixture)

pytestmark = pytest.mark.db

SUMMARY = "/api/v1/analytics/summary"
PATTERNS = "/api/v1/analytics/patterns"
TODAY = date(2026, 10, 21)
NOW_HOUR = 18  # frozen "now": 2026-10-21 18:00 Asia/Manila


def at(day: date, hour: int = 12, minute: int = 0) -> str:
    return datetime.combine(day, time(hour, minute), tzinfo=periods.app_tz()).isoformat()


@pytest.fixture
def frozen_today(monkeypatch: pytest.MonkeyPatch) -> date:
    now = datetime.combine(TODAY, time(NOW_HOUR), tzinfo=periods.app_tz())
    monkeypatch.setattr(periods, "local_now", lambda: now)
    return TODAY


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


# ---------- summary ----------


def test_monthly_summary_compares_month_to_date_with_last_month(
    db_client: TestClient, user, frozen_today: date
) -> None:
    headers, cats, _ = user
    g, d, t = cats["Groceries"], cats["Dining out"], cats["Transport"]
    # Previous window: Sep 1–21.
    add(db_client, headers, amount="1000.00", category_id=g, occurred_at=at(date(2026, 9, 10)))
    add(db_client, headers, amount="500.00", category_id=d, occurred_at=at(date(2026, 9, 21), 17))
    # Sep 21 after 18:00 is later in the day than "now": not like for like, so not compared.
    add(db_client, headers, amount="40.00", category_id=d, occurred_at=at(date(2026, 9, 21), 19))
    add(db_client, headers, amount="9999.00", category_id=t, occurred_at=at(date(2026, 9, 25)))
    # Current window: Oct 1–21. 00:15 Manila on Oct 1 is still Sep 30 in UTC.
    add(db_client, headers, amount="10.00", category_id=t, occurred_at=at(date(2026, 10, 1), 0, 15))
    add(db_client, headers, amount="1200.50", category_id=g, occurred_at=at(date(2026, 10, 2)))
    add(db_client, headers, amount="300.00", category_id=d, occurred_at=at(date(2026, 10, 9)))
    add(
        db_client,
        headers,
        amount="99.50",
        category_id=g,
        occurred_at=at(date(2026, 10, 21), 17, 30),
    )
    # After "today": not part of the month so far.
    add(db_client, headers, amount="777.00", category_id=t, occurred_at=at(date(2026, 10, 25)))

    response = db_client.get(SUMMARY, headers=headers, params={"period": "monthly"})
    assert response.status_code == 200, response.text
    s = response.json()

    assert (s["start"], s["end"]) == ("2026-10-01", "2026-10-21")
    assert (s["previous_start"], s["previous_end"]) == ("2026-09-01", "2026-09-21")
    assert s["compared_until"] == "2026-09-21T18:00:00+08:00"
    assert s["total"] == "1610.00"
    assert s["previous_total"] == "1500.00"
    assert s["change_amount"] == "110.00"
    assert s["change_pct"] == 7
    assert s["transaction_count"] == 4
    assert [(c["category"]["name"], c["total"], c["share_pct"]) for c in s["by_category"]] == [
        ("Groceries", "1300.00", 81),
        ("Dining out", "300.00", 19),
        ("Transport", "10.00", 1),
    ]
    assert s["trend_granularity"] == "week"
    assert [(b["start"], b["end"], b["total"], b["is_future"]) for b in s["trend"]] == [
        ("2026-10-01", "2026-10-07", "1210.50", False),
        ("2026-10-08", "2026-10-14", "300.00", False),
        ("2026-10-15", "2026-10-21", "99.50", False),
        ("2026-10-22", "2026-10-31", "0.00", True),
    ]


def test_weekly_and_daily_summaries(db_client: TestClient, user, frozen_today: date) -> None:
    headers, cats, _ = user
    g = cats["Groceries"]
    # TODAY is a Wednesday: this week is Mon Oct 19 → Wed Oct 21; last week Oct 12 → 14.
    add(db_client, headers, amount="100.00", category_id=g, occurred_at=at(date(2026, 10, 13)))
    add(db_client, headers, amount="50.00", category_id=g, occurred_at=at(date(2026, 10, 15)))
    add(db_client, headers, amount="40.00", category_id=g, occurred_at=at(date(2026, 10, 19)))
    add(db_client, headers, amount="60.00", category_id=g, occurred_at=at(date(2026, 10, 20)))
    # Yesterday after 18:00: counted in this week and its bar, not in "yesterday by now".
    add(db_client, headers, amount="15.00", category_id=g, occurred_at=at(date(2026, 10, 20), 20))
    add(db_client, headers, amount="25.00", category_id=g, occurred_at=at(TODAY))

    weekly = db_client.get(SUMMARY, headers=headers, params={"period": "weekly"}).json()
    assert (weekly["start"], weekly["previous_start"], weekly["previous_end"]) == (
        "2026-10-19",
        "2026-10-12",
        "2026-10-14",
    )
    assert (weekly["total"], weekly["previous_total"], weekly["change_pct"]) == (
        "140.00",
        "100.00",
        40,
    )
    assert weekly["compared_until"] == "2026-10-14T18:00:00+08:00"
    assert weekly["trend_granularity"] == "day"
    assert [b["total"] for b in weekly["trend"]] == ["40.00", "75.00", "25.00"] + ["0.00"] * 4
    assert [b["is_future"] for b in weekly["trend"]] == [False] * 3 + [True] * 4

    daily = db_client.get(SUMMARY, headers=headers, params={"period": "daily"}).json()
    assert (daily["total"], daily["previous_total"], daily["change_amount"]) == (
        "25.00",
        "60.00",
        "-35.00",
    )
    assert daily["change_pct"] == -58
    assert daily["compared_until"] == "2026-10-20T18:00:00+08:00"
    assert len(daily["trend"]) == 7 and daily["trend"][-1]["start"] == "2026-10-21"
    assert [b["total"] for b in daily["trend"]] == [
        "50.00",  # Oct 15
        "0.00",
        "0.00",
        "0.00",
        "40.00",
        "75.00",
        "25.00",  # today
    ]


def test_empty_summary_and_other_users_spending_is_invisible(
    db_client: TestClient, user, make_user, auth_header, frozen_today: date
) -> None:
    headers, _, _ = user
    other = auth_header(make_user())
    add(db_client, other, amount="500.00", category_id=categories(db_client, other)["Groceries"],
        occurred_at=at(TODAY))  # fmt: skip

    s = db_client.get(SUMMARY, headers=headers).json()  # monthly by default
    assert s["period"] == "monthly"
    assert (s["total"], s["previous_total"], s["change_amount"]) == ("0.00", "0.00", "0.00")
    assert s["change_pct"] is None
    assert s["transaction_count"] == 0 and s["by_category"] == []
    assert all(b["total"] == "0.00" for b in s["trend"])


def test_summary_rejects_unknown_period_and_needs_a_token(db_client: TestClient, user) -> None:
    headers, _, _ = user
    bad = db_client.get(SUMMARY, headers=headers, params={"period": "yearly"})
    assert bad.status_code == 422
    assert bad.headers["content-type"].startswith("application/problem+json")
    assert db_client.get(SUMMARY).status_code == 401
    assert db_client.get(PATTERNS).status_code == 401


# ---------- purchase patterns ----------


def confirm_eggs(client: TestClient, headers, cats, day: date, name: str = "Eggs large") -> str:  # noqa: ANN001
    receipt = upload(client, headers).json()
    response = client.post(
        f"/api/v1/receipts/{receipt['id']}/confirm",
        headers=headers,
        json={
            "category_id": cats["Groceries"],
            "occurred_at": at(day, 9),
            "merchant": "ZZ Test Mart",
            "total": "112.00",
            "discount": "0",
            "items": [{"name": name, "quantity": "1", "unit_price": "112.00"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def eggs_pattern(client: TestClient, headers) -> dict | None:  # noqa: ANN001
    found = [
        p
        for p in client.get(PATTERNS, headers=headers).json()
        if p["product"]["name"] == "Eggs large"
    ]
    return found[0] if found else None


@pytest.mark.usefixtures("fakes")
def test_patterns_grow_from_confirmed_receipts(
    db_client: TestClient,
    user,
    make_user,
    auth_header,
    as_user,  # noqa: ANN001, F811
) -> None:
    headers, cats, user_id = user
    start = periods.local_today() - timedelta(days=40)
    days = [start + timedelta(days=7 * i) for i in range(5)]

    assert db_client.get(PATTERNS, headers=headers).json() == []
    ids = [confirm_eggs(db_client, headers, cats, days[0])]
    ids.append(confirm_eggs(db_client, headers, cats, days[1], name="EGGS  LARGE"))  # same product
    p = eggs_pattern(db_client, headers)
    assert p["purchase_count"] == 2 and p["data_tier"] == "insufficient"
    assert p["avg_interval_days"] is None and p["confidence"] == "0.000"

    ids.append(confirm_eggs(db_client, headers, cats, days[2]))
    p = eggs_pattern(db_client, headers)
    assert (p["data_tier"], p["avg_interval_days"], p["confidence"]) == ("limited", "7.00", "0.500")

    ids += [confirm_eggs(db_client, headers, cats, d) for d in days[3:]]
    p = eggs_pattern(db_client, headers)
    assert p["purchase_count"] == 5 and p["data_tier"] == "sufficient"
    assert (p["avg_interval_days"], p["interval_stddev_days"], p["confidence"]) == (
        "7.00",
        "0.00",
        "1.000",
    )
    assert p["average_spend"] == "112.00"
    assert p["last_purchased_at"].startswith(days[4].isoformat())

    # Another user sees nothing of it, through the API or with raw SQL under RLS.
    other = make_user()
    assert db_client.get(PATTERNS, headers=auth_header(other)).json() == []
    db = as_user(other)
    assert db.execute(text("select count(*) from products")).scalar_one() == 0
    assert db.execute(text("select count(*) from purchase_patterns")).scalar_one() == 0
    assert as_user(user_id).execute(text("select count(*) from products")).scalar_one() == 1

    # Deleting the latest purchase recomputes the pattern in the same request.
    assert db_client.delete(f"/api/v1/transactions/{ids[4]}", headers=headers).status_code == 204
    p = eggs_pattern(db_client, headers)
    assert p["purchase_count"] == 4 and p["data_tier"] == "limited"
    assert p["last_purchased_at"].startswith(days[3].isoformat())

    # Moving a purchase to another day recomputes the intervals: 7, 7, 10 days.
    later = days[3] + timedelta(days=3)
    moved = db_client.patch(
        f"/api/v1/transactions/{ids[3]}", headers=headers, json={"occurred_at": at(later, 9)}
    )
    assert moved.status_code == 200, moved.text
    p = eggs_pattern(db_client, headers)
    assert p["last_purchased_at"].startswith(later.isoformat())
    assert (p["avg_interval_days"], p["interval_stddev_days"], p["confidence"]) == (
        "8.00",
        "1.73",
        "0.588",
    )

    # No purchases left: no pattern.
    for tid in ids[:4]:
        assert db_client.delete(f"/api/v1/transactions/{tid}", headers=headers).status_code == 204
    assert db_client.get(PATTERNS, headers=headers).json() == []


def test_manual_transactions_do_not_create_patterns(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    for i in range(5):
        day = periods.local_today() - timedelta(days=7 * i)
        add(
            db_client,
            headers,
            amount="95.00",
            category_id=cats["Groceries"],
            occurred_at=at(day),
            merchant="Eggs",
        )
    assert db_client.get(PATTERNS, headers=headers).json() == []
