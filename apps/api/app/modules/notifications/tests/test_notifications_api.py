"""Notifications, devices, push dispatch and the daily job (needs TEST_DATABASE_URL).
Push goes to a fake sender: tests never reach FCM or real devices."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text

from app.core.db import make_session_factory
from app.jobs.daily import DAILY_LOCK, run_daily
from app.modules.expenses.tests.test_transactions_api import categories
from app.modules.notifications.dispatch import dispatch_pending
from app.modules.notifications.push import PushMessage, PushResult, PushUnavailable
from app.modules.receipts.tests.test_receipts_api import fakes  # noqa: F401 (fixture)
from app.modules.replenishment.tests.test_replenishment_api import at, history, today

pytestmark = pytest.mark.db

NOTIFICATIONS = "/api/v1/notifications"
DEVICES = "/api/v1/devices"
TOKEN_A = "fcm-token-aaaaaaaaaaaa"


class FakeSender:
    name = "fake"

    def __init__(self) -> None:
        self.sent: list[tuple[list[str], PushMessage]] = []
        self.dead: set[str] = set()
        self.down = False

    def send(self, tokens: list[str], message: PushMessage) -> PushResult:
        if self.down:
            raise PushUnavailable
        self.sent.append((list(tokens), message))
        dead = [t for t in tokens if t in self.dead]
        return PushResult(delivered=len(tokens) - len(dead), dead_tokens=dead)


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


@pytest.fixture
def factory(app_engine: Engine):  # noqa: ANN201
    return make_session_factory(app_engine)


def page(client: TestClient, headers) -> dict:  # noqa: ANN001
    response = client.get(NOTIFICATIONS, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def set_prefs(client: TestClient, headers, **changes) -> None:  # noqa: ANN001, ANN003
    prefs = client.get("/api/v1/me/preferences", headers=headers).json()
    assert (
        client.put("/api/v1/me/preferences", headers=headers, json={**prefs, **changes}).status_code
        == 200
    )


def spend(client: TestClient, headers, cats, amount: str) -> None:  # noqa: ANN001
    response = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={"amount": amount, "category_id": cats["Groceries"], "occurred_at": at(today())},
    )
    assert response.status_code == 201, response.text


def groceries_budget(client: TestClient, headers, cats, limit: str = "100.00") -> None:  # noqa: ANN001
    response = client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": cats["Groceries"], "period_type": "monthly", "limit_amount": limit},
    )
    assert response.status_code == 201, response.text


# ---------- budget alerts ----------


def test_budget_alerts_are_stored_once_per_level_rise(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    groceries_budget(db_client, headers, cats)
    spend(db_client, headers, cats, "95.00")  # near (90 %)
    spend(db_client, headers, cats, "1.00")  # still near: no second alert
    spend(db_client, headers, cats, "10.00")  # exceeded

    p = page(db_client, headers)
    assert p["unread_count"] == 2
    exceeded, near = p["items"]
    assert (exceeded["type"], exceeded["level"]) == ("budget", "exceeded")
    assert exceeded["title"] == "Groceries budget exceeded"
    assert exceeded["body"] == "You've spent ₱106.00 of your ₱100.00 Groceries budget."
    assert near["title"] == "Groceries budget at 95%"
    assert near["body"] == "₱5.00 left in your Groceries budget."
    assert exceeded["deep_link"] == "/budget" and exceeded["read_at"] is None


def test_budget_alerts_respect_the_preference(db_client: TestClient, user) -> None:
    headers, cats, _ = user
    set_prefs(db_client, headers, notify_budget=False)
    groceries_budget(db_client, headers, cats)
    spend(db_client, headers, cats, "150.00")
    assert page(db_client, headers)["items"] == []


def test_read_one_read_all_and_ownership(
    db_client: TestClient, user, make_user, auth_header
) -> None:  # noqa: E501
    headers, cats, _ = user
    groceries_budget(db_client, headers, cats)
    spend(db_client, headers, cats, "95.00")
    spend(db_client, headers, cats, "10.00")
    first, second = page(db_client, headers)["items"]

    other = auth_header(make_user())
    assert db_client.post(f"{NOTIFICATIONS}/{first['id']}/read", headers=other).status_code == 404
    assert page(db_client, other) == {"items": [], "unread_count": 0}

    read = db_client.post(f"{NOTIFICATIONS}/{first['id']}/read", headers=headers)
    assert read.status_code == 200 and read.json()["read_at"] is not None
    assert page(db_client, headers)["unread_count"] == 1
    assert db_client.post(f"{NOTIFICATIONS}/read-all", headers=headers).json() == {"updated": 1}
    assert page(db_client, headers)["unread_count"] == 0
    assert db_client.get(NOTIFICATIONS).status_code == 401


# ---------- devices ----------


def test_device_registration_moves_a_token_to_the_signed_in_account(
    db_client: TestClient, user, make_user, auth_header, admin_engine: Engine
) -> None:
    headers, _, user_a = user
    user_b = make_user()
    headers_b = auth_header(user_b)

    def owners() -> list:
        with admin_engine.connect() as conn:
            return (
                conn.execute(
                    text("select user_id from device_tokens where fcm_token = :t"), {"t": TOKEN_A}
                )
                .scalars()
                .all()
            )

    body = {"fcm_token": TOKEN_A, "platform": "android"}
    assert db_client.post(DEVICES, headers=headers, json=body).status_code == 204
    assert db_client.post(DEVICES, headers=headers, json=body).status_code == 204  # idempotent
    assert owners() == [user_a]

    assert db_client.post(DEVICES, headers=headers_b, json=body).status_code == 204
    assert owners() == [user_b]  # the phone signed in to B: A gets no more pushes

    assert db_client.delete(f"{DEVICES}/{TOKEN_A}", headers=headers).status_code == 204
    assert owners() == [user_b]  # A can't remove B's device
    assert db_client.delete(f"{DEVICES}/{TOKEN_A}", headers=headers_b).status_code == 204
    assert owners() == []

    bad = db_client.post(DEVICES, headers=headers, json={"fcm_token": TOKEN_A, "platform": "web"})
    assert bad.status_code == 422
    assert db_client.post(DEVICES, json=body).status_code == 401


def test_rls_hides_notifications_and_devices(
    db_client: TestClient, user, make_user, as_user
) -> None:  # noqa: E501
    headers, cats, user_a = user
    groceries_budget(db_client, headers, cats)
    spend(db_client, headers, cats, "150.00")
    db_client.post(DEVICES, headers=headers, json={"fcm_token": TOKEN_A, "platform": "android"})
    stranger = as_user(make_user())
    assert stranger.execute(text("select count(*) from notifications")).scalar_one() == 0
    assert stranger.execute(text("select count(*) from device_tokens")).scalar_one() == 0
    assert as_user(user_a).execute(text("select count(*) from notifications")).scalar_one() == 1


# ---------- dispatch ----------


def test_dispatch_pushes_unsent_notifications_once_and_drops_dead_tokens(
    db_client: TestClient, user, factory, admin_engine: Engine
) -> None:
    headers, cats, _ = user
    db_client.post(DEVICES, headers=headers, json={"fcm_token": TOKEN_A, "platform": "android"})
    dead = "fcm-token-dead-000000"
    db_client.post(DEVICES, headers=headers, json={"fcm_token": dead, "platform": "android"})
    groceries_budget(db_client, headers, cats)
    spend(db_client, headers, cats, "150.00")

    sender = FakeSender()
    sender.down = True
    assert dispatch_pending(factory, sender)["pushed"] == 0  # FCM down: stays unsent
    sender.down = False
    sender.dead = {dead}
    counts = dispatch_pending(factory, sender)
    assert counts["pushed"] == 1 and counts["dead_tokens"] == 1
    [(tokens, message)] = sender.sent
    assert sorted(tokens) == sorted([TOKEN_A, dead])
    assert message.title == "Groceries budget exceeded"
    assert message.data["deep_link"] == "/budget"

    assert dispatch_pending(factory, sender)["notifications"] == 0  # already sent
    with admin_engine.connect() as conn:
        left = (
            conn.execute(
                text("select fcm_token from device_tokens where fcm_token like 'fcm-token-%'")
            )
            .scalars()
            .all()
        )
    assert dead not in left


# ---------- daily job ----------


@pytest.mark.usefixtures("fakes")
def test_daily_job_creates_reminders_once_and_respects_preferences(
    db_client: TestClient, user, factory, make_user, auth_header
) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7])
    lst = db_client.get("/api/v1/shopping-lists", headers=headers).json()[0]
    db_client.post(
        f"/api/v1/shopping-lists/{lst['id']}/items",
        headers=headers,
        json={"name": "Salt", "est_price": "25.00"},
    )  # noqa: E501
    db_client.post(DEVICES, headers=headers, json={"fcm_token": TOKEN_A, "platform": "android"})

    # A second user with reminders switched off gets nothing.
    quiet = auth_header(make_user())
    set_prefs(db_client, quiet, notify_replenishment=False, notify_shopping=False)
    quiet_list = db_client.get("/api/v1/shopping-lists", headers=quiet).json()[0]
    db_client.post(
        f"/api/v1/shopping-lists/{quiet_list['id']}/items", headers=quiet, json={"name": "Salt"}
    )

    sender = FakeSender()
    counts = run_daily(factory, today(), sender)
    assert counts["reminders"] == 2 and counts["failed_users"] == 0
    assert run_daily(factory, today(), sender)["reminders"] == 0  # repeated run: no duplicates

    items = page(db_client, headers)["items"]
    by_type = {n["type"]: n for n in items}
    assert set(by_type) == {"replenishment", "shopping"}
    restock = by_type["replenishment"]
    assert restock["title"] == "Eggs large may be running low"
    assert restock["body"] == "You usually buy Eggs large every ~7 days. Add it to your list?"
    assert restock["suggestion"]["status"] == "pending"
    assert by_type["shopping"]["body"] == "1 item on your list · est. ₱25.00."
    assert len(sender.sent) == 2  # pushed once each, never again
    assert page(db_client, quiet)["items"] == []

    # Answering the suggestion shows on the notification card.
    sid = restock["suggestion"]["id"]
    db_client.post(
        f"/api/v1/replenishment/suggestions/{sid}/feedback",
        headers=headers,
        json={"action": "add_to_list"},
    )  # noqa: E501
    refreshed = {n["type"]: n for n in page(db_client, headers)["items"]}
    assert refreshed["replenishment"]["suggestion"]["status"] == "added"


def test_daily_job_skips_when_another_run_holds_the_lock(factory, app_engine: Engine) -> None:
    with app_engine.connect() as holder:
        holder.execute(select(func.pg_advisory_lock(func.hashtext(DAILY_LOCK))))
        try:
            assert run_daily(factory, today(), FakeSender())["skipped"] == 1
        finally:
            holder.execute(select(func.pg_advisory_unlock(func.hashtext(DAILY_LOCK))))


@pytest.mark.usefixtures("fakes")
def test_mute_then_unmute_does_not_repeat_the_reminder(
    db_client: TestClient, user, factory
) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats, today() - timedelta(days=10), [7, 7, 7, 7], name="Rice 5kg")
    sender = FakeSender()
    run_daily(factory, today(), sender)
    restock = [n for n in page(db_client, headers)["items"] if n["type"] == "replenishment"]
    assert len(restock) == 1
    sid = restock[0]["suggestion"]["id"]
    product = restock[0]["suggestion"]["product"]["id"]

    db_client.post(
        f"/api/v1/replenishment/suggestions/{sid}/feedback",
        headers=headers,
        json={"action": "dont_remind"},
    )  # noqa: E501
    assert (
        db_client.delete(f"/api/v1/replenishment/muted/{product}", headers=headers).status_code
        == 204
    )
    run_daily(factory, today(), sender)

    restock = [n for n in page(db_client, headers)["items"] if n["type"] == "replenishment"]
    assert len(restock) == 1  # same suggestion, same key: no second reminder
    assert restock[0]["suggestion"]["status"] == "pending"  # and it can be answered again
