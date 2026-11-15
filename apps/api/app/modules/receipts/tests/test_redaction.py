"""Recognised-text redaction (Phase 8D.4a): identifiers masked, the draft unchanged."""

from dataclasses import asdict
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.modules.receipts import parser
from app.modules.receipts.redaction import MAX_TEXT_CHARS, luhn_valid, redact, redact_line

FIXTURES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "receipts"
TZ = ZoneInfo("Asia/Manila")
TODAY = date(2026, 11, 15)


def parse(text: str) -> parser.ParsedReceipt:
    return parser.parse(text, today=TODAY, tz=TZ)


@pytest.mark.parametrize("fixture", sorted(p.name for p in FIXTURES.glob("*.txt")))
def test_fixture_receipts_are_unchanged(fixture: str) -> None:
    """The synthetic receipts hold no personal data: redaction must not alter them, so fixture
    OCR, the parser and every existing draft behave exactly as before."""
    text = (FIXTURES / fixture).read_text()
    assert redact(text) == text.replace("\r\n", "\n")


# A Philippine supermarket receipt paid by card, with the buyer details BIR asks for.
SENSITIVE = """ZZ TEST HYPERMART
VAT REG TIN 000-123-456-00000
11/09/2026 14:32
4800016644221 GARDENIA WHITE 600G   88.00 V
BEAR BRAND SWAK 33G
3 @ 12.50   37.50 V
EGGS LARGE 12S   112.00 X
SUBTOTAL   237.50
LESS: SC DISC 20%   -22.40
AMOUNT DUE   215.10
VISA ************4242   215.10
CARD NO: 4111 1111 1111 1111
APPROVAL CODE: 0A12BC
RRN: 431912345678
TRACE NO. 004512
TERMINAL ID: 77001234
GCASH REF NO. 5012345678901
MOBILE NO: 0917 123 4567
SOLD TO: Juan Dela Cruz
ADDRESS: 12 Sampaguita St, Quezon City
CUSTOMER TIN: 123-456-789-000
SC/PWD ID NO: 1234567
SC NAME: Maria Clara
MEMBER NO: 9900112233
EMAIL: juan.delacruz@example.com
SIGNATURE: ________
"""

SECRETS = [
    "4111 1111 1111 1111",
    "4111111111111111",
    "0A12BC",
    "431912345678",
    "004512",
    "77001234",
    "5012345678901",
    "0917 123 4567",
    "Juan Dela Cruz",
    "Sampaguita",
    "123-456-789-000",
    "1234567",
    "Maria Clara",
    "9900112233",
    "juan.delacruz@example.com",
]


def test_personal_and_payment_identifiers_are_masked() -> None:
    redacted = redact(SENSITIVE)
    for secret in SECRETS:
        assert secret not in redacted, secret
    # Card numbers keep only their last four digits, as printed receipts do.
    assert "VISA **** 4242   215.10" in redacted
    assert "CARD NO: **** 1111" in redacted
    assert "APPROVAL CODE: [redacted]" in redacted
    assert "SOLD TO: [redacted]" in redacted
    assert "MOBILE NO: **** 4567" in redacted
    assert "SC/PWD ID NO: [redacted]" in redacted


def test_store_details_items_and_amounts_are_kept() -> None:
    redacted = redact(SENSITIVE)
    for kept in (
        "ZZ TEST HYPERMART",
        "VAT REG TIN 000-123-456-00000",  # the store's TIN is business information
        "11/09/2026 14:32",
        "4800016644221 GARDENIA WHITE 600G   88.00 V",  # a barcode is not a card number
        "3 @ 12.50   37.50 V",
        "LESS: SC DISC 20%   -22.40",
        "AMOUNT DUE   215.10",
    ):
        assert kept in redacted, kept
    assert len(redacted.split("\n")) == len(SENSITIVE.split("\n"))  # same rows


def test_the_draft_is_the_same_after_redaction() -> None:
    before, after = parse(SENSITIVE), parse(redact(SENSITIVE))
    for name in ("merchant", "occurred_at", "subtotal", "discount", "vat", "total", "items"):
        assert getattr(after, name) == getattr(before, name), name
    assert [asdict(i) for i in after.items] == [asdict(i) for i in before.items]
    assert after.total == parse(SENSITIVE).total


def test_redaction_is_idempotent() -> None:
    once = redact(SENSITIVE)
    assert redact(once) == once


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("5555-5555-5555-4444", "**** 4444"),
        ("XXXX XXXX XXXX 1881", "**** 1881"),
        ("MASTERCARD 5555555555554444   500.00", "MASTERCARD **** 4444   500.00"),
        ("378282246310005", "**** 0005"),  # Amex, Luhn-valid, no keyword needed
        ("+63 917 555 0199", "**** 0199"),
        ("AUTH CODE 7HG2K9", "AUTH CODE [redacted]"),
        ("CARDHOLDER: J DELA CRUZ", "CARDHOLDER: [redacted]"),
    ],
)
def test_masked_shapes(line: str, expected: str) -> None:
    assert redact_line(line) == expected


@pytest.mark.parametrize(
    "line",
    [
        "4800016644221 GARDENIA WHITE 600G   88.00 V",
        "1234567890123456   99.00",  # not Luhn-valid and no card keyword: an item code
        "TOTAL   1,234,567.89",
        "CASH   1000.00",
        "TIN 000-111-222-000",
        "REFUND POLICY: 7 DAYS",
        "MID-SIZE EGGS 12S   112.00",
        "LESS 5% PROMO   -3.15",
        "Date: Nov 08, 2026  Time: 9:15 AM",
        "SALES INVOICE NO. 000123",
    ],
)
def test_ordinary_receipt_lines_are_untouched(line: str) -> None:
    assert redact_line(line) == line


def test_control_characters_are_removed_and_length_capped() -> None:
    assert redact("ZZ\x00 MART\r\nEGGS\x1b   112.00") == "ZZ MART\nEGGS   112.00"
    assert len(redact("A" * (MAX_TEXT_CHARS + 500))) == MAX_TEXT_CHARS


def test_luhn() -> None:
    assert luhn_valid("4111111111111111") and luhn_valid("378282246310005")
    assert not luhn_valid("4111111111111112")
