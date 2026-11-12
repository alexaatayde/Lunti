"""Receipt text → draft (pure; no database)."""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.modules.receipts.parser import line_total, parse

TZ = ZoneInfo("Asia/Manila")
TODAY = date(2026, 11, 11)
FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "receipts"


def run(text: str):  # noqa: ANN201
    return parse(text, today=TODAY, tz=TZ)


def fixture(name: str):  # noqa: ANN201
    return run((FIXTURES / f"{name}.txt").read_text())


def codes(result) -> set[tuple[str, str]]:  # noqa: ANN001
    return {(f.field, f.code) for f in result.flags}


def test_supermarket_receipt_reconciles() -> None:
    r = fixture("zz-test-supermarket")
    assert r.merchant == "ZZ TEST SUPERMARKET"
    assert r.occurred_at == datetime(2026, 11, 9, 14, 32, tzinfo=TZ)
    assert r.total == Decimal("366.35") and r.items_total == Decimal("366.35")
    assert r.vat == Decimal("20.95") and r.subtotal == Decimal("366.35")
    assert [(i.name, i.quantity, i.unit_price, i.discount, i.line_total) for i in r.items] == [
        ("BEAR BRAND SWAK 33G", Decimal("3"), Decimal("12.50"), 0, Decimal("37.50")),
        ("NESCAFE 3IN1 ORIG 10S", Decimal("2"), Decimal("34.50"), 0, Decimal("69.00")),
        ("GARDENIA WHITE 600G", 1, Decimal("88.00"), 0, Decimal("88.00")),  # barcode stripped
        ("PECHAY BAGUIO", Decimal("0.525"), Decimal("120.00"), Decimal("3.15"), Decimal("59.85")),
        ("EGGS LARGE 12S", 1, Decimal("112.00"), 0, Decimal("112.00")),
    ]
    assert r.items[3].unit == "kg"
    assert not any(i.needs_review for i in r.items)
    assert r.confidence_total >= 0.95 and r.confidence_items == 1.0
    # 11/09 could be 9 November or 11 September: flagged, MM/DD (PH default) chosen.
    assert codes(r) == {("occurred_at", "ambiguous")}


def test_receipt_level_senior_discount() -> None:
    r = fixture("zz-test-senior-discount")
    assert r.occurred_at == datetime(2026, 11, 8, 9, 15, tzinfo=TZ)
    assert r.discount == Decimal("130.00")
    assert r.total == Decimal("651.50") and r.items_total == Decimal("651.50")
    assert r.items[0].quantity == 2 and r.items[0].unit_price == Decimal("38.75")
    assert r.confidence_total == 0.99
    assert r.flags == []


def test_total_inferred_from_cash_and_change() -> None:
    r = fixture("zz-test-no-total")
    assert r.total == Decimal("150.00")
    assert ("total", "inferred") in codes(r)
    assert r.confidence_total == 0.95  # inferred, but the items agree with it


def test_text_without_amounts_has_no_money() -> None:
    r = fixture("zz-test-not-a-receipt")
    assert not r.has_money and r.total is None and r.items == []
    assert {("total", "missing"), ("items", "missing"), ("occurred_at", "missing")} <= codes(r)


def test_strong_total_wins_and_mismatch_is_flagged() -> None:
    r = run("SHOP ONE\n11/20/2026\nRICE 5KG   300.00\nTOTAL   290.00\nAMOUNT DUE   310.00\n")
    assert r.total == Decimal("310.00")
    assert ("items", "mismatch") in codes(r)
    assert r.confidence_total == 0.85 and r.confidence_items == pytest.approx(0.6)


def test_missing_total_falls_back_to_items_with_low_confidence() -> None:
    r = run("SHOP TWO\n2026-11-10\nBREAD   45.00\nMILK   90.50\n")
    assert r.total == Decimal("135.50")
    assert ("total", "missing") in codes(r) and r.confidence_total == 0.3


def test_quantity_line_mismatch_needs_review() -> None:
    r = run("SHOP\n11/20/2026\nSARDINES\n3 @ 20.00   65.00\nTOTAL   65.00\n")
    assert r.items[0].needs_review
    assert ("items", "uncertain") in codes(r)


def test_currency_prefix_and_thousands_and_comma_decimals() -> None:
    r = run("SHOP\n11/20/2026\nKETCHUP 45.00\nTV STAND P1,234.50\nSOAP 89,50\nTOTAL ₱1,369.00\n")
    assert [(i.name, i.unit_price) for i in r.items] == [
        ("KETCHUP", Decimal("45.00")),
        ("TV STAND", Decimal("1234.50")),
        ("SOAP", Decimal("89.50")),
    ]
    assert r.total == Decimal("1369.00")


def test_total_on_the_next_line_and_summary_lines_ignored() -> None:
    text = (
        "SHOP\n11/20/2026\nA ITEM   10.00\nB ITEM   5.00\n"
        "TOTAL ITEMS 2\nTOTAL DISCOUNT 0.00\nTOTAL\n15.00\n"
    )
    r = run(text)
    assert r.total == Decimal("15.00") and r.discount == 0 and len(r.items) == 2


def test_dates() -> None:
    assert run("S\n25/12/2025\n").occurred_at.date() == date(2025, 12, 25)  # DD/MM fallback
    assert run("S\n12-Nov-26 7:05 PM\n").occurred_at == datetime(2026, 11, 12, 19, 5, tzinfo=TZ)
    # Future (beyond tomorrow) and pre-2000 dates are rejected, not guessed.
    assert run("S\n12/31/2026\n").occurred_at is None
    assert run("S\n01/02/1999\n").occurred_at is None
    no_time = run("S\nNov 10, 2026\n")
    assert no_time.occurred_at == datetime(2026, 11, 10, 12, 0, tzinfo=TZ)
    assert ("occurred_at", "no_time") in codes(no_time)


def test_merchant_skips_noise_lines() -> None:
    r = run("TIN 000-111\nOFFICIAL RECEIPT\nGOOD MART\n11/20/2026\nX ITEM 1.00\nTOTAL 1.00\n")
    assert r.merchant == "GOOD MART"
    assert ("merchant", "uncertain") in codes(r)  # not on the first two lines


def test_parse_is_deterministic() -> None:
    text = (FIXTURES / "zz-test-supermarket.txt").read_text()
    assert run(text) == run(text)


@pytest.mark.parametrize(
    ("qty", "price", "discount", "expected"),
    [
        ("1", "10.00", "0", "10.00"),
        ("0.525", "120.00", "3.15", "59.85"),
        ("3", "0.335", "0", "1.01"),
    ],
)
def test_line_total_rounds_half_up(qty: str, price: str, discount: str, expected: str) -> None:
    assert line_total(Decimal(qty), Decimal(price), Decimal(discount)) == Decimal(expected)
