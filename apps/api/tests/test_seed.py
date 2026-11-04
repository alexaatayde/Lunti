"""Seed script: deterministic, idempotent, and refuses remote databases."""

from datetime import date

import pytest
from sqlalchemy import text

from scripts.seed import main


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres",
        "postgresql://postgres.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ],
)
def test_refuses_remote_databases_by_default(url: str) -> None:
    with pytest.raises(SystemExit, match="Refusing to seed"):
        main(["--database-url", url, "--create-demo-user"])


def test_needs_an_explicit_database_url(monkeypatch) -> None:
    monkeypatch.delenv("SEED_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://should-never-be-used/db")
    with pytest.raises(SystemExit):
        main(["--create-demo-user"])


@pytest.mark.db
def test_seeds_weeks_of_history_and_is_idempotent(database, admin_engine) -> None:
    args = ["--database-url", database.admin_url, "--create-demo-user", "--end-date", "2026-11-04"]

    def counts() -> tuple[int, ...]:
        with admin_engine.connect() as conn:
            return conn.execute(
                text(
                    "select (select count(*) from products),"
                    " (select count(*) from transactions),"
                    " (select count(*) from transaction_line_items),"
                    " (select count(*) from budgets),"
                    " (select coalesce(sum(amount), 0) from transactions)"
                )
            ).one()

    before = counts()
    assert main(args) == 0
    first = counts()
    assert main(args) == 0
    assert counts() == first  # second run inserts nothing

    products, transactions, line_items, budgets, _ = (
        a - b for a, b in zip(first, before, strict=True)
    )
    assert products == 10 and budgets == 2
    assert transactions > 50 and line_items > 60

    with admin_engine.connect() as conn:
        eggs = conn.execute(
            text(
                "select count(distinct t.occurred_at::date) from transaction_line_items li"
                " join transactions t on t.id = li.transaction_id"
                " join products p on p.id = li.product_id where p.normalized_name = 'eggs'"
            )
        ).scalar_one()
        oldest = conn.execute(text("select min(occurred_at)::date from transactions")).scalar_one()
    # Weekly staple over 8 weeks: enough purchases for a "sufficient" pattern (≥ 5).
    assert eggs >= 7
    assert oldest >= date(2026, 9, 9)
