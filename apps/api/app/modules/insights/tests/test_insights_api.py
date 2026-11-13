"""/insights against a real database (needs TEST_DATABASE_URL). The AI writer is a fake:
tests never call OpenAI."""

from datetime import datetime, time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import app
from app.modules.analytics import service as analytics
from app.modules.expenses import periods
from app.modules.expenses.tests.test_transactions_api import add, categories
from app.modules.insights.writer import get_writer

pytestmark = pytest.mark.db

INSIGHTS = "/api/v1/insights"


class FakeAi:
    engine = "ai"

    def __init__(self, reply: str | None) -> None:
        self.reply = reply
        self.calls: list[tuple[str, dict]] = []

    def write(self, kind: str, figures: dict) -> str | None:
        self.calls.append((kind, figures))
        return self.reply


@pytest.fixture
def writer(db_client: TestClient):  # noqa: ANN201
    fake = FakeAi(None)
    app.dependency_overrides[get_writer] = lambda: fake
    return fake


@pytest.fixture
def user(db_client: TestClient, make_user, auth_header):  # noqa: ANN001, ANN201
    user_id = make_user()
    headers = auth_header(user_id)
    return headers, categories(db_client, headers), user_id


def at(day, hour: int = 0, minute: int = 30) -> str:  # noqa: ANN001
    return datetime.combine(day, time(hour, minute), tzinfo=periods.app_tz()).isoformat()


def history(client: TestClient, headers, cats) -> None:  # noqa: ANN001
    """3 purchases this month, 2 in the same span of last month (5 = the minimum)."""
    start, prev_start, _, _ = analytics.windows("monthly", periods.local_today())
    for amount in ("300.00", "200.00", "100.00"):
        add(client, headers, amount=amount, category_id=cats["Groceries"], occurred_at=at(start))
    for amount in ("250.00", "250.00"):
        add(
            client,
            headers,
            amount=amount,
            category_id=cats["Groceries"],
            occurred_at=at(prev_start),
        )


def page(client: TestClient, headers) -> dict:  # noqa: ANN001
    response = client.get(INSIGHTS, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_new_user_gets_a_placeholder_and_the_model_is_not_called(
    db_client: TestClient, user, writer
) -> None:  # noqa: E501
    headers, cats, _ = user
    add(db_client, headers, amount="50.00", category_id=cats["Groceries"])
    p = page(db_client, headers)
    assert p["items"] == [] and p["need_more_data"] is True and p["placeholder"]
    assert writer.calls == []


def test_ai_wording_is_used_only_when_its_numbers_check_out(
    db_client: TestClient, user, writer
) -> None:  # noqa: E501
    headers, cats, _ = user
    history(db_client, headers, cats)
    writer.reply = (
        "You've spent ₱600.00 this month, 20% more than the ₱500.00 at this point last month."  # noqa: E501
    )
    [insight] = page(db_client, headers)["items"]
    assert (insight["type"], insight["engine"]) == ("spending", "ai")
    assert insight["message"] == writer.reply
    kind, figures = writer.calls[0]
    assert kind == "spending"
    assert (figures["month_total"], figures["previous_total"], figures["change_pct"]) == (
        "600.00",
        "500.00",
        20,
    )  # noqa: E501
    assert figures["top_category"] == "Groceries"

    # Once a day: the same insight again, no second model call.
    assert page(db_client, headers)["items"] == [insight] and len(writer.calls) == 1


def test_a_reply_with_an_invented_number_falls_back_to_the_template(
    db_client: TestClient, user, writer
) -> None:  # noqa: E501
    headers, cats, _ = user
    history(db_client, headers, cats)
    writer.reply = "You could save ₱150.00 next month by cooking at home."
    [insight] = page(db_client, headers)["items"]
    assert insight["engine"] == "summary"
    assert insight["message"].startswith("You've spent ₱600.00 so far this month, 20% more than")


def test_model_unavailable_uses_the_template(db_client: TestClient, user, writer) -> None:
    headers, cats, _ = user
    history(db_client, headers, cats)
    writer.reply = None  # timeout / error
    [insight] = page(db_client, headers)["items"]
    assert insight["engine"] == "summary"


def test_budget_insight_and_custom_names_stay_private(db_client: TestClient, user, writer) -> None:
    headers, cats, _ = user
    custom = db_client.post(
        "/api/v1/categories", headers=headers, json={"name": "Lola's meds"}
    ).json()
    db_client.post(
        "/api/v1/budgets",
        headers=headers,
        json={"category_id": custom["id"], "period_type": "monthly", "limit_amount": "100.00"},
    )
    add(db_client, headers, amount="95.00", category_id=custom["id"])
    p = page(db_client, headers)
    [insight] = p["items"]
    assert insight["type"] == "budget"
    sent = writer.calls[0][1]
    assert "Lola" not in str(sent) and sent["budget_label"] == "custom category"
    assert insight["message"] == "Your custom category budget is at 95%: ₱5.00 left."


def test_dismiss_and_isolation(
    db_client: TestClient, user, writer, make_user, auth_header, as_user
) -> None:  # noqa: E501
    headers, cats, user_id = user
    history(db_client, headers, cats)
    [insight] = page(db_client, headers)["items"]
    other_id = make_user()
    other = auth_header(other_id)
    assert db_client.post(f"{INSIGHTS}/{insight['id']}/dismiss", headers=other).status_code == 404
    assert as_user(other_id).execute(text("select count(*) from insights")).scalar_one() == 0
    assert db_client.post(f"{INSIGHTS}/{insight['id']}/dismiss", headers=headers).status_code == 200
    p = page(db_client, headers)
    assert p["items"] == [] and p["need_more_data"] is False  # dismissed, not regenerated today
    assert as_user(user_id).execute(text("select count(*) from insights")).scalar_one() == 1
    assert db_client.get(INSIGHTS).status_code == 401


def test_insights_never_change_financial_records(
    db_client: TestClient, user, writer, admin_engine: Engine
) -> None:  # noqa: E501
    headers, cats, user_id = user
    history(db_client, headers, cats)

    def money() -> tuple:
        with admin_engine.connect() as conn:
            return conn.execute(
                text("select count(*), sum(amount) from transactions where user_id = :u"),
                {"u": user_id},
            ).one()

    before = money()
    writer.reply = "You've spent ₱600.00 this month."
    page(db_client, headers)
    assert money() == before
