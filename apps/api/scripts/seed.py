"""Seed synthetic purchase history for demos and tests (AGENTS.md §11).

Safety
- Never reads DATABASE_URL: the target must be given with --database-url or SEED_DATABASE_URL.
- Refuses non-local hosts (e.g. the live Supabase project) unless --allow-remote is passed.
- Only INSERTs rows with deterministic ids (`on conflict do nothing`): running it twice
  changes nothing, and existing rows are never updated or deleted.
- Writes only to the one user given by --user-id (or the local demo user).

Usage (from apps/api):
  python -m scripts.seed --database-url postgresql://postgres:postgres@localhost:5432/lunti_dev \\
      --create-demo-user
  python -m scripts.seed --database-url ... --user-id <existing auth user uuid>

Same --end-date + --seed → identical data. Default end date is today (Asia/Manila).
"""

import argparse
import os
import random
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, create_engine, make_url, text

from app.core.config import to_sqlalchemy_url

MANILA = ZoneInfo("Asia/Manila")
NAMESPACE = uuid.UUID("6f1c1f0e-0b7a-4c55-9a43-3d8f6c2b9e10")
DEMO_EMAIL = "demo@lunti.test"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db"}
CENT = Decimal("0.01")
VAT_RATE = Decimal("0.12")  # PH prices are VAT-inclusive


@dataclass(frozen=True)
class Staple:
    key: str
    name: str
    unit: str
    price: Decimal
    every_days: int
    jitter_days: int
    is_food: bool = True
    category: str = "Groceries"


STAPLES = [
    Staple("rice", "Rice 5kg", "bag", Decimal("290.00"), 14, 2),
    Staple("eggs", "Eggs (12)", "tray", Decimal("95.00"), 7, 1),
    Staple("milk", "Fresh milk 1L", "carton", Decimal("98.00"), 5, 1),
    Staple("bread", "Pandesal (10)", "pack", Decimal("50.00"), 3, 1),
    Staple("coffee", "Instant coffee 200g", "jar", Decimal("185.00"), 21, 3),
    Staple("oil", "Cooking oil 1L", "bottle", Decimal("120.00"), 30, 4),
    Staple("chicken", "Chicken 1kg", "kg", Decimal("210.00"), 7, 2),
    Staple("bananas", "Bananas", "kg", Decimal("60.00"), 6, 2),
    Staple("onions", "Red onions", "kg", Decimal("140.00"), 10, 3),
    Staple("soap", "Dish soap 500ml", "bottle", Decimal("75.00"), 28, 4, False, "Household"),
]
MARKETS = ["Suki Mart", "Palengke Fresh", "Weekly Supermarket"]


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def sid(user_id: uuid.UUID, *parts: object) -> uuid.UUID:
    """Deterministic id, so re-running the seed inserts nothing new."""
    return uuid.uuid5(NAMESPACE, ":".join([str(user_id), *map(str, parts)]))


def at(day: date, hour: int, minute: int) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=MANILA)


def ensure_safe_target(url: str, allow_remote: bool) -> None:
    host = make_url(to_sqlalchemy_url(url)).host or "localhost"
    if host not in LOCAL_HOSTS and not allow_remote:
        raise SystemExit(
            f"Refusing to seed '{host}': only local databases are seeded by default.\n"
            "Use a dedicated development/test database. If this really is one, pass --allow-remote."
        )


def ensure_demo_user(conn: Connection) -> uuid.UUID:
    """Local/test databases only: auth.users is the plain stand-in from tests/supabase_stub.sql."""
    user_id = uuid.uuid5(NAMESPACE, DEMO_EMAIL)
    conn.execute(
        text(
            "insert into auth.users (id, email, raw_user_meta_data) values (:id, :email,"
            " jsonb_build_object('full_name', 'Demo User', 'terms_accepted_at', now()::text,"
            " 'data_consent_at', now()::text)) on conflict (id) do nothing"
        ),
        {"id": user_id, "email": DEMO_EMAIL},
    )
    return user_id


def category_ids(conn: Connection) -> dict[str, uuid.UUID]:
    rows = conn.execute(text("select name, id from categories where is_default")).all()
    if not rows:
        raise SystemExit("No default categories: run `alembic upgrade head` first.")
    return {name: cid for name, cid in rows}


def seed(conn: Connection, user_id: uuid.UUID, end: date, weeks: int, rng_seed: int) -> dict:
    exists = conn.execute(text("select 1 from auth.users where id = :u"), {"u": user_id}).first()
    if not exists:
        raise SystemExit(f"No auth user {user_id}. Create the user first (sign up in the app).")

    rng = random.Random(rng_seed)
    categories = category_ids(conn)
    start = end - timedelta(weeks=weeks)
    counts = {"products": 0, "transactions": 0, "line_items": 0, "budgets": 0}

    def insert(sql: str, params: dict) -> None:
        result = conn.execute(text(sql + " on conflict do nothing"), params)
        return result.rowcount

    # Products
    for s in STAPLES:
        counts["products"] += insert(
            "insert into products (id, user_id, name, normalized_name, is_food,"
            " default_category_id, default_unit) values (:id, :u, :n, :nn, :food, :c, :unit)",
            {
                "id": sid(user_id, "product", s.key),
                "u": user_id,
                "n": s.name,
                "nn": s.key,
                "food": s.is_food,
                "c": categories[s.category],
                "unit": s.unit,
            },
        )

    # Purchase dates per staple, then grouped into shopping trips by (day, category).
    trips: dict[tuple[date, str], list[Staple]] = {}
    for s in STAPLES:
        day = start + timedelta(days=rng.randint(0, s.every_days - 1))
        while day <= end:
            trips.setdefault((day, s.category), []).append(s)
            day += timedelta(days=max(1, s.every_days + rng.randint(-s.jitter_days, s.jitter_days)))

    for (day, category), items in sorted(trips.items()):
        txn_id = sid(user_id, "trip", day.isoformat(), category)
        lines = []
        for s in items:
            qty = Decimal(rng.choice([1, 1, 1, 2]))
            unit_price = money(s.price * Decimal(rng.uniform(0.95, 1.08)))
            total = money(unit_price * qty)
            lines.append((s, qty, unit_price, total))
        amount = sum((line[3] for line in lines), Decimal("0"))
        counts["transactions"] += insert(
            "insert into transactions (id, user_id, category_id, amount, occurred_at, merchant,"
            " note, source) values (:id, :u, :c, :a, :t, :m, :note, 'manual')",
            {
                "id": txn_id,
                "u": user_id,
                "c": categories[category],
                "a": amount,
                "t": at(day, rng.randint(9, 19), rng.choice([0, 15, 30, 45])),
                "m": rng.choice(MARKETS),
                "note": "Synthetic seed data",
            },
        )
        for s, qty, unit_price, total in lines:
            counts["line_items"] += insert(
                "insert into transaction_line_items (id, transaction_id, product_id, name,"
                " quantity, unit, unit_price, tax, line_total)"
                " values (:id, :t, :p, :n, :q, :unit, :price, :tax, :total)",
                {
                    "id": sid(user_id, "line", txn_id, s.key),
                    "t": txn_id,
                    "p": sid(user_id, "product", s.key),
                    "n": s.name,
                    "q": qty,
                    "unit": s.unit,
                    "price": unit_price,
                    "tax": money(total * VAT_RATE / (1 + VAT_RATE)),
                    "total": total,
                },
            )

    # Everyday spending outside groceries.
    day = start
    while day <= end:
        extras = []
        if day.weekday() in (0, 2, 4):
            extras.append(("Transport", "Jeep and MRT", Decimal(rng.randint(40, 120))))
        if day.weekday() == 5:
            extras.append(("Dining out", "Carinderia lunch", Decimal(rng.randint(180, 450))))
        if day.day == 15:
            extras.append(("Utilities", "Electricity bill", Decimal(rng.randint(2400, 3200))))
        for category, merchant, amount in extras:
            counts["transactions"] += insert(
                "insert into transactions (id, user_id, category_id, amount, occurred_at,"
                " merchant, note, source) values (:id, :u, :c, :a, :t, :m, :note, 'manual')",
                {
                    "id": sid(user_id, "extra", day.isoformat(), category),
                    "u": user_id,
                    "c": categories[category],
                    "a": money(amount),
                    "t": at(day, rng.randint(7, 20), 0),
                    "m": merchant,
                    "note": "Synthetic seed data",
                },
            )
        day += timedelta(days=1)

    # Budgets for the current month.
    month_start = end.replace(day=1)
    for key, category, limit in [
        ("overall", None, Decimal("20000.00")),
        ("groceries", "Groceries", Decimal("8000.00")),
    ]:
        counts["budgets"] += insert(
            "insert into budgets (id, user_id, category_id, period_type, start_date, limit_amount)"
            " values (:id, :u, :c, 'monthly', :s, :l)",
            {
                "id": sid(user_id, "budget", key, month_start.isoformat()),
                "u": user_id,
                "c": categories[category] if category else None,
                "s": month_start,
                "l": limit,
            },
        )
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--database-url", default=os.environ.get("SEED_DATABASE_URL", ""))
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--user-id", type=uuid.UUID, help="Existing auth user to seed data for.")
    who.add_argument(
        "--create-demo-user",
        action="store_true",
        help=f"Create {DEMO_EMAIL} in a LOCAL test database (stand-in auth.users only).",
    )
    parser.add_argument("--weeks", type=int, default=8)
    parser.add_argument("--end-date", type=date.fromisoformat, default=datetime.now(MANILA).date())
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--allow-remote", action="store_true")
    args = parser.parse_args(argv)

    if not args.database_url:
        parser.error("pass --database-url or set SEED_DATABASE_URL (DATABASE_URL is never used)")
    ensure_safe_target(args.database_url, args.allow_remote)
    if args.create_demo_user and args.allow_remote:
        parser.error("--create-demo-user is for local databases; sign up in the app instead")

    engine = create_engine(to_sqlalchemy_url(args.database_url))
    with engine.begin() as conn:
        user_id = args.user_id or ensure_demo_user(conn)
        counts = seed(conn, user_id, args.end_date, args.weeks, args.seed)
    engine.dispose()
    print(f"Seeded user {user_id}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
