"""/transactions against a real database (needs TEST_DATABASE_URL)."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.expenses import periods

pytestmark = pytest.mark.db

API = "/api/v1/transactions"


def categories(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    return {c["name"]: c["id"] for c in client.get("/api/v1/categories", headers=headers).json()}


def now_local() -> datetime:
    return datetime.now(periods.app_tz()).replace(microsecond=0)


def add(client: TestClient, headers: dict[str, str], **body) -> dict:  # noqa: ANN003
    body.setdefault("occurred_at", now_local().isoformat())
    response = client.post(API, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    headers = auth_header(make_user())
    return headers, categories(db_client, headers)


# ---------- create / read ----------


def test_create_and_read_back_a_manual_expense(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats = user
    when = now_local()

    created = add(
        db_client,
        headers,
        amount="6.75",
        category_id=cats["Dining out"],
        occurred_at=when.isoformat(),
        merchant="  Corner Café ",
        note="Morning coffee",
    )

    assert created["amount"] == "6.75"
    assert created["merchant"] == "Corner Café"
    assert created["source"] == "manual" and created["receipt_id"] is None
    assert created["category"]["name"] == "Dining out"
    assert created["item_count"] == 0
    assert created["budget_alerts"] == []
    assert datetime.fromisoformat(created["occurred_at"]) == when

    detail = db_client.get(f"{API}/{created['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["note"] == "Morning coffee"
    assert detail.json()["items"] == [] and detail.json()["budgets"] == []


@pytest.mark.parametrize(
    ("amount", "valid"),
    [
        ("0.01", True),
        ("9999999999.99", True),
        (12.5, True),
        ("0", False),
        ("0.00", False),
        ("-5", False),
        ("1.005", False),
        ("10000000000.00", False),
        ("abc", False),
        ("NaN", False),
        ("Infinity", False),
        (None, False),
    ],
)
def test_amount_validation(db_client: TestClient, user, amount, valid: bool) -> None:  # noqa: ANN001
    headers, cats = user
    response = db_client.post(
        API,
        headers=headers,
        json={
            "amount": amount,
            "category_id": cats["Groceries"],
            "occurred_at": now_local().isoformat(),
        },
    )
    if valid:
        assert response.status_code == 201
        assert Decimal(response.json()["amount"]) == Decimal(str(amount))
    else:
        assert response.status_code == 422
        assert response.json()["errors"][0]["field"] == "amount"


def test_money_is_stored_exactly(db_client: TestClient, user, admin_engine) -> None:  # noqa: ANN001
    headers, cats = user
    for amount in ("0.10", "0.20", "0.30"):
        add(db_client, headers, amount=amount, category_id=cats["Groceries"])

    summary = db_client.get(f"{API}/summary", headers=headers).json()

    assert summary["total"] == "0.60"  # not 0.6000000000000001
    with admin_engine.connect() as conn:
        column_type = conn.scalar(
            text(
                "select format_type(atttypid, atttypmod) from pg_attribute"
                " where attrelid = 'public.transactions'::regclass and attname = 'amount'"
            )
        )
    assert column_type == "numeric(12,2)"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"category_id": None}, "category_id"),
        ({"occurred_at": "2026-11-05T08:15:00"}, "occurred_at"),  # no time zone
        ({"occurred_at": "1999-12-31T00:00:00+08:00"}, "occurred_at"),
        ({"occurred_at": (datetime.now(UTC) + timedelta(days=3)).isoformat()}, "occurred_at"),
        ({"merchant": "x" * 121}, "merchant"),
        ({"note": "x" * 501}, "note"),
        ({"source": "receipt"}, "source"),  # clients can't fake a scanned receipt
    ],
)
def test_field_validation(db_client: TestClient, user, body, field: str) -> None:  # noqa: ANN001
    headers, cats = user
    payload = {
        "amount": "10.00",
        "category_id": cats["Groceries"],
        "occurred_at": now_local().isoformat(),
        **body,
    }
    response = db_client.post(API, headers=headers, json=payload)

    assert response.status_code == 422
    assert response.json()["type"] == "urn:lunti:problem:validation-error"
    assert field in [e["field"] for e in response.json()["errors"]]


def test_category_must_be_visible_to_the_user(
    db_client: TestClient, make_user, auth_header, user
) -> None:  # noqa: ANN001
    headers, _ = user
    other = auth_header(make_user())
    theirs = db_client.post("/api/v1/categories", headers=other, json={"name": "Secret"}).json()

    for category_id in (theirs["id"], str(uuid.uuid4())):
        response = db_client.post(
            API,
            headers=headers,
            json={
                "amount": "5.00",
                "category_id": category_id,
                "occurred_at": now_local().isoformat(),
            },
        )
        assert response.status_code == 422
        assert response.json()["errors"] == [
            {
                "field": "category_id",
                "message": "Choose one of your categories.",
                "code": "unknown_category",
            }
        ]


def test_own_custom_category_works(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, _ = user
    pets = db_client.post("/api/v1/categories", headers=headers, json={"name": "Pets"}).json()

    created = add(db_client, headers, amount="300.00", category_id=pets["id"])

    assert created["category"] == {"id": pets["id"], "name": "Pets", "icon": None}
    # A category in use can't be deleted (transactions keep their category).
    assert db_client.delete(f"/api/v1/categories/{pets['id']}", headers=headers).status_code == 409


# ---------- edit / delete ----------


def test_edit_and_clear_fields(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats = user
    created = add(
        db_client, headers, amount="46.80", category_id=cats["Groceries"], merchant="Market"
    )
    path = f"{API}/{created['id']}"

    edited = db_client.patch(
        path,
        headers=headers,
        json={"amount": "50.00", "category_id": cats["Household"], "merchant": None, "note": "ok"},
    )

    assert edited.status_code == 200
    body = edited.json()
    assert body["amount"] == "50.00"
    assert body["category"]["name"] == "Household"
    assert body["merchant"] is None and body["note"] == "ok"
    assert db_client.get(path, headers=headers).json()["amount"] == "50.00"


@pytest.mark.parametrize(
    "body", [{}, {"amount": None}, {"category_id": None}, {"occurred_at": None}, {"x": 1}]
)
def test_invalid_edits(db_client: TestClient, user, body) -> None:  # noqa: ANN001
    headers, cats = user
    created = add(db_client, headers, amount="5.00", category_id=cats["Groceries"])

    response = db_client.patch(f"{API}/{created['id']}", headers=headers, json=body)

    assert response.status_code == 422
    assert db_client.get(f"{API}/{created['id']}", headers=headers).json()["amount"] == "5.00"


def test_delete(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats = user
    created = add(db_client, headers, amount="5.00", category_id=cats["Groceries"])
    path = f"{API}/{created['id']}"

    assert db_client.delete(path, headers=headers).status_code == 204
    assert db_client.get(path, headers=headers).status_code == 404
    assert db_client.delete(path, headers=headers).status_code == 404


# ---------- history: filters, search, paging, summary ----------


def test_list_filters_search_and_summary(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats = user
    tz = periods.app_tz()
    oct_20 = datetime(2026, 10, 20, 9, 0, tzinfo=tz)
    nov_2 = datetime(2026, 11, 2, 23, 30, tzinfo=tz)  # late evening Manila = Nov 2 local
    add(
        db_client,
        headers,
        amount="46.80",
        category_id=cats["Groceries"],
        merchant="Greenfield Market",
        occurred_at=oct_20.isoformat(),
    )
    add(
        db_client,
        headers,
        amount="6.75",
        category_id=cats["Dining out"],
        merchant="Corner Café",
        note="100% arabica",
        occurred_at=nov_2.isoformat(),
    )
    add(
        db_client,
        headers,
        amount="20.00",
        category_id=cats["Transport"],
        merchant="Metro card reload",
        occurred_at=(nov_2 - timedelta(hours=1)).isoformat(),
    )

    def merchants(**params) -> list[str]:  # noqa: ANN003
        response = db_client.get(API, headers=headers, params=params)
        assert response.status_code == 200, response.text
        return [t["merchant"] for t in response.json()["items"]]

    assert merchants() == ["Corner Café", "Metro card reload", "Greenfield Market"]
    assert merchants(**{"from": "2026-11-01", "to": "2026-11-30"}) == [
        "Corner Café",
        "Metro card reload",
    ]
    assert merchants(**{"from": "2026-10-01", "to": "2026-10-31"}) == ["Greenfield Market"]
    assert merchants(category_id=cats["Transport"]) == ["Metro card reload"]
    assert merchants(q="market") == ["Greenfield Market"]
    assert merchants(q="100%") == ["Corner Café"]  # % is literal, not a wildcard
    assert merchants(q="_") == []

    summary = db_client.get(
        f"{API}/summary", headers=headers, params={"from": "2026-11-01", "to": "2026-11-30"}
    ).json()
    assert summary["total"] == "26.75"
    assert summary["count"] == 2
    assert summary["manual_count"] == 2 and summary["receipt_count"] == 0
    assert [
        (c["category"]["name"], c["total"], c["count"], c["share_pct"])
        for c in summary["by_category"]
    ] == [
        ("Transport", "20.00", 1, 75),  # 20.00 / 26.75 = 74.8 %
        ("Dining out", "6.75", 1, 25),
    ]

    bad = db_client.get(API, headers=headers, params={"from": "2026-11-30", "to": "2026-11-01"})
    assert bad.status_code == 422


def test_cursor_pagination_is_stable(db_client: TestClient, user) -> None:  # noqa: ANN001
    headers, cats = user
    same_time = now_local().isoformat()
    created = [
        add(
            db_client,
            headers,
            amount=f"{i}.00",
            category_id=cats["Others"],
            occurred_at=same_time,
        )["id"]
        for i in range(1, 6)
    ]

    seen: list[str] = []
    cursor = None
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = db_client.get(API, headers=headers, params=params).json()
        seen += [t["id"] for t in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert sorted(seen) == sorted(created) and len(seen) == 5  # no duplicates or gaps
    garbage = db_client.get(API, headers=headers, params={"cursor": "not-a-cursor"})
    assert garbage.status_code == 422


# ---------- isolation ----------


def test_other_users_transactions_are_invisible_and_untouchable(
    db_client: TestClient, make_user, auth_header
) -> None:
    alice, bob = auth_header(make_user()), auth_header(make_user())
    groceries = categories(db_client, bob)["Groceries"]
    bobs = add(db_client, bob, amount="99.00", category_id=groceries, merchant="Bob's shop")
    path = f"{API}/{bobs['id']}"

    assert db_client.get(API, headers=alice).json()["items"] == []
    assert db_client.get(f"{API}/summary", headers=alice).json()["total"] == "0.00"
    assert db_client.get(path, headers=alice).status_code == 404
    assert db_client.patch(path, headers=alice, json={"amount": "1.00"}).status_code == 404
    assert db_client.delete(path, headers=alice).status_code == 404
    assert db_client.get(path, headers=bob).json()["amount"] == "99.00"


def test_rls_blocks_cross_user_rows_even_without_api_filters(
    db_client: TestClient, make_user, auth_header, as_user
) -> None:
    alice_id, bob_id = make_user(), make_user()
    bob = auth_header(bob_id)
    add(db_client, bob, amount="10.00", category_id=categories(db_client, bob)["Groceries"])

    alice_db = as_user(alice_id)
    assert alice_db.scalar(text("select count(*) from public.transactions")) == 0
    with pytest.raises(DBAPIError):
        alice_db.execute(
            text(
                "insert into public.transactions (user_id, category_id, amount, occurred_at)"
                " select :bob, id, 1, now() from public.categories limit 1"
            ),
            {"bob": bob_id},
        )


def test_requires_authentication(db_client: TestClient) -> None:
    assert db_client.get(API).status_code == 401
    assert db_client.post(API, json={}).status_code == 401
