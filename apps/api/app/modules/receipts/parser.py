"""Turns OCR text from a Philippine grocery receipt into a draft (AGENTS.md §7.1 step 3).

Pure and deterministic: the same text always gives the same draft, so a stored draft can be
rebuilt from `receipts.ocr_raw_text` without a column of its own. All money is Decimal.

What it looks for:
- merchant: the first name-like line at the top;
- date and time (MM/DD/YYYY is the Philippine default; DD/MM only when the month can't be
  a month, and ambiguous dates are flagged);
- line items, before the first SUBTOTAL / TOTAL / payment line. Quantity lines such as
  "3 @ 12.50  37.50" or "0.525 KG @ 120.00" attach to the item name above or below them,
  and negative / "LESS" lines become that item's discount;
- receipt-level discounts (senior citizen / PWD / promo) after the subtotal;
- VAT (PH receipts are 12 % VAT-inclusive, so VAT is informational, never added);
- the total, preferring AMOUNT DUE / GRAND TOTAL over a plain TOTAL, then CASH − CHANGE,
  then the items' sum.

Each field gets a heuristic confidence in 0–1 (the service multiplies it by the OCR
engine's own confidence) plus review flags the app shows next to the field.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

CENT = Decimal("0.01")
TOLERANCE = Decimal("0.01")
MAX_NAME = 120
EARLIEST = date(2000, 1, 1)

# ---------- patterns ----------

# 1,234.50 · 89.50 · 89,50 (OCR often reads "." as ",") · optional P/₱/PHP and minus sign.
_AMOUNT = (
    r"(?P<neg>-)?\s?(?:(?<![A-Za-z])(?:PHP|P|₱)\s?)?"
    r"(?P<whole>\d{1,3}(?:,\d{3})+|\d+)[.,](?P<cents>\d{2})(?P<trail>-)?"
)
# An amount at the end of a line, optionally followed by a VAT code (V, X, Z, T, VE, *).
_TRAILING_AMOUNT = re.compile(r"(?<![\d.,])" + _AMOUNT + r"\s*(?:[A-Z]{1,2}|\*)?\s*$")
_ANY_AMOUNT = re.compile(r"(?<![\d.,:/])" + _AMOUNT + r"(?![\d:/])")

# "3 @ 12.50", "2 X 34.50", "2PC @45.00", "0.525 KG @ 120.00/KG"
_QTY = re.compile(
    r"(?P<qty>\d{1,4}(?:\.\d{1,3})?)\s*(?P<unit>KGS?|G|GRAMS?|L|ML|PCS?|EA|PK|PACKS?)?\s*"
    r"[@xX×*]\s*(?:PHP|P|₱)?\s?(?P<price>\d{1,3}(?:,\d{3})+|\d+)[.,](?P<pcents>\d{2})"
    r"(?:\s*/\s*(?:KGS?|PCS?|EA|L|G))?"
)

_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    )
}
_DATE_NUMERIC = re.compile(r"(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)")
_DATE_ISO = re.compile(r"(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)")
_MONTH_NAME = r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?"
_DATE_DAY_MONTH = re.compile(
    r"(?<!\d)(\d{1,2})[\s-]*" + _MONTH_NAME + r"[\s,-]*(\d{4}|\d{2})(?!\d)"
)
_DATE_MONTH_DAY = re.compile(_MONTH_NAME + r"\s*(\d{1,2}),?\s*(\d{4})(?!\d)")
_TIME = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|A\.M\.|P\.M\.|A|P)?(?![A-Z])")

_STRONG_TOTAL = re.compile(
    r"\b(AMOUNT\s*DUE|TOTAL\s*DUE|GRAND\s*TOTAL|TOTAL\s*AMOUNT(\s*DUE)?|NET\s*TOTAL|NET\s*AMOUNT\s*DUE)\b"
)
_TOTAL = re.compile(r"\bTOTAL\b")
_NOT_TOTAL = re.compile(
    r"SUB\s*-?\s*TOTAL|TOTAL\s*(ITEMS?|QTY|QUANTITY|DISC\w*|SAVINGS?|VAT|NO\.?|COUNT|PCS?)"
    r"|NO\.?\s*OF\s*ITEMS|ITEMS?\s*PURCHASED"
)
_SUBTOTAL = re.compile(r"SUB\s*-?\s*TOTAL")
_PAYMENT = re.compile(
    r"\b(CASH|CHANGE|CARD|GCASH|MAYA|PAYMAYA|CREDIT|DEBIT|VISA|MASTERCARD|TENDER(ED)?|"
    r"AMOUNT\s*PAID|PAYMENT|QRPH|E-?WALLET)\b"
)
_CASH = re.compile(r"\b(CASH|AMOUNT\s*TENDERED|TENDERED)\b")
_CHANGE = re.compile(r"\bCHANGE\b")
_VAT_AMOUNT = re.compile(r"\b(VAT\s*AMOUNT|VAT\s*\(?12\s*%\)?|12\s*%\s*VAT|VAT)\b")
_NOT_VAT_AMOUNT = re.compile(
    r"VATABLE|VAT[\s-]*EXEMPT|ZERO[\s-]*RATED|NON[\s-]*VAT|VAT\s*REG|VAT\s*SALES"
)
_DISCOUNT = re.compile(
    r"\b(DISC(OUNT)?|LESS|SC\s*DISC|PWD|SENIOR|PROMO|SAVINGS?|COUPON|VOUCHER|MARKDOWN)\b"
)
_RECEIPT_DISCOUNT = re.compile(r"\b(SC|PWD|SENIOR|CITIZEN|VOUCHER|COUPON|MEMBER)\b")
# Lines that are never items and never the merchant.
_NOISE = re.compile(
    r"\b(TIN|VAT\s*REG|VATABLE|VAT[\s-]*EXEMPT|ZERO[\s-]*RATED|MIN|S/?N|SERIAL|PTU|"
    r"ACCRED\w*|PERMIT|OFFICIAL\s*RECEIPT|SALES\s*INVOICE|INVOICE|OR\s*NO|SI\s*NO|TXN|TRANS\w*|"
    r"CASHIER|TERMINAL|POS|REG\s*NO|THANK|CUSTOMER|BUSINESS\s*STYLE|ADDRESS|TEL|PHONE|"
    r"WWW|HTTP|EMAIL|SUPPLIER|BIR|THIS\s*SERVES|THIS\s*DOCUMENT|VALID|MEMBER\s*(NO|ID)|CARD\s*NO|"
    r"POINTS?|STORE\s*(NO|#)|BRANCH)\b"
)
_BARCODE_PREFIX = re.compile(r"^\d{6,}\s+")
_TRAILING_CODES = re.compile(r"[\s*#]+$")


# ---------- results ----------


@dataclass(frozen=True)
class Flag:
    """Something the user should check before saving (shown next to the field)."""

    field: str  # merchant | occurred_at | total | items
    code: str
    message: str


@dataclass
class DraftItem:
    name: str
    quantity: Decimal = Decimal("1")
    unit: str | None = None
    unit_price: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    needs_review: bool = False

    @property
    def line_total(self) -> Decimal:
        return line_total(self.quantity, self.unit_price, self.discount)


@dataclass
class ParsedReceipt:
    merchant: str | None = None
    occurred_at: datetime | None = None
    items: list[DraftItem] = field(default_factory=list)
    subtotal: Decimal | None = None
    discount: Decimal = Decimal("0")  # receipt-level (senior/PWD/promo), not per item
    vat: Decimal | None = None
    total: Decimal | None = None
    # Heuristic confidences in 0–1, before the OCR engine's own confidence is applied.
    confidence_store: float = 0.0
    confidence_items: float = 0.0
    confidence_total: float = 0.0
    flags: list[Flag] = field(default_factory=list)
    amount_count: int = 0  # how many money amounts the text contains at all

    @property
    def items_total(self) -> Decimal:
        """Sum of item line totals minus the receipt-level discount."""
        return sum((i.line_total for i in self.items), Decimal("0")) - self.discount

    @property
    def has_money(self) -> bool:
        return self.total is not None or bool(self.items)


# ---------- money helpers (also used when confirming) ----------


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def line_total(quantity: Decimal, unit_price: Decimal, discount: Decimal) -> Decimal:
    """quantity × unit price, rounded half up to the centavo, minus the item discount."""
    return money(quantity * unit_price) - discount


def _amount(match: re.Match[str]) -> Decimal:
    value = Decimal(f"{match['whole'].replace(',', '')}.{match['cents']}")
    return -value if (match["neg"] or match["trail"]) else value


def _trailing_amount(line: str) -> tuple[Decimal | None, str]:
    """The amount at the end of a line, and the text before it."""
    match = _TRAILING_AMOUNT.search(line)
    if not match:
        return None, line
    return _amount(match), line[: match.start()].strip()


# ---------- small parsers ----------


def _clean_line(line: str) -> str:
    line = line.replace("\t", " ").replace("₱ ", "₱")
    return re.sub(r"\s+", " ", line).strip()


def _letters(text: str) -> int:
    return sum(c.isalpha() for c in text)


def _clean_name(text: str) -> str:
    text = _BARCODE_PREFIX.sub("", text)
    text = _TRAILING_CODES.sub("", text).strip(" .:-")
    return text[:MAX_NAME].strip()


def _looks_like_date_or_time(upper: str) -> bool:
    return bool(
        _DATE_NUMERIC.search(upper)
        or _DATE_ISO.search(upper)
        or _DATE_DAY_MONTH.search(upper)
        or _DATE_MONTH_DAY.search(upper)
        or _TIME.search(upper)
    )


def _year(text: str) -> int:
    value = int(text)
    return value + 2000 if value < 100 else value


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def find_date(upper_lines: list[str], today: date) -> tuple[date | None, bool]:
    """First plausible date (2000 … tomorrow) and whether its day/month order is ambiguous."""
    for line in upper_lines:
        for match in _DATE_ISO.finditer(line):
            found = _safe_date(int(match[1]), int(match[2]), int(match[3]))
            if found and EARLIEST <= found <= _tomorrow(today):
                return found, False
        for match in _DATE_NUMERIC.finditer(line):
            a, b, y = int(match[1]), int(match[2]), _year(match[3])
            # Philippine receipts print MM/DD/YYYY; fall back to DD/MM only when needed.
            candidates = [(a, b, a != b and a <= 12 and b <= 12), (b, a, False)]
            for month, day, ambiguous in candidates:
                found = _safe_date(y, month, day)
                if found and EARLIEST <= found <= _tomorrow(today):
                    return found, ambiguous
        for match in _DATE_DAY_MONTH.finditer(line):
            found = _safe_date(_year(match[3]), _MONTHS[match[2]], int(match[1]))
            if found and EARLIEST <= found <= _tomorrow(today):
                return found, False
        for match in _DATE_MONTH_DAY.finditer(line):
            found = _safe_date(int(match[3]), _MONTHS[match[1]], int(match[2]))
            if found and EARLIEST <= found <= _tomorrow(today):
                return found, False
    return None, False


def _tomorrow(today: date) -> date:
    return date.fromordinal(today.toordinal() + 1)


def find_time(upper_lines: list[str]) -> time | None:
    for line in upper_lines:
        for match in _TIME.finditer(line):
            hour, minute = int(match[1]), int(match[2])
            second = int(match[3]) if match[3] else 0
            meridiem = (match[4] or "").replace(".", "")
            if meridiem.startswith("P") and hour < 12:
                hour += 12
            elif meridiem.startswith("A") and hour == 12:
                hour = 0
            if hour <= 23 and minute <= 59 and second <= 59:
                return time(hour, minute, second)
    return None


def find_merchant(lines: list[str]) -> tuple[str | None, float]:
    """The first name-like line near the top (store names come before addresses and TINs)."""
    for index, line in enumerate(lines[:6]):
        upper = line.upper()
        if _NOISE.search(upper) or _ANY_AMOUNT.search(line) or _looks_like_date_or_time(upper):
            continue
        letters = _letters(line)
        if letters < 3 or letters / max(len(line.replace(" ", "")), 1) < 0.6:
            continue
        name = _clean_name(line)
        if name:
            return name, 0.95 if index <= 1 else 0.75
    return None, 0.0


# ---------- the parser ----------


def parse(text: str, *, today: date, tz: ZoneInfo) -> ParsedReceipt:
    lines = [c for c in (_clean_line(raw) for raw in text.splitlines()) if c]
    upper = [line.upper() for line in lines]
    result = ParsedReceipt()
    result.amount_count = sum(len(_ANY_AMOUNT.findall(line)) for line in lines)

    result.merchant, result.confidence_store = find_merchant(lines)
    if result.merchant is None:
        result.flags.append(Flag("merchant", "missing", "We couldn't find the store name."))
    elif result.confidence_store < 0.8:
        result.flags.append(Flag("merchant", "uncertain", "Check the store name."))

    found_date, ambiguous = find_date(upper, today)
    if found_date is None:
        result.flags.append(Flag("occurred_at", "missing", "We couldn't find the date."))
    else:
        found_time = find_time(upper)
        result.occurred_at = datetime.combine(found_date, found_time or time(12, 0), tz)
        if ambiguous:
            result.flags.append(
                Flag("occurred_at", "ambiguous", "Check the date: day and month could be swapped.")
            )
        elif found_time is None:
            result.flags.append(Flag("occurred_at", "no_time", "We couldn't find the time."))

    end = _items_and_discounts(lines, upper, result)
    total_source = _totals(lines, upper, end, result)
    _score(result, total_source)
    return result


def _items_and_discounts(lines: list[str], upper: list[str], result: ParsedReceipt) -> int:
    """Reads items until the first SUBTOTAL / TOTAL / payment line; returns that index."""
    items = result.items
    pending_name: str | None = None
    # Item whose quantity line may follow it ("NESCAFE 69.00" then "2 X 34.50").
    awaiting_qty: DraftItem | None = None
    end = len(lines)
    # Store name, address and TIN come first; item names can't start before the header ends
    # (at the first date/time line or the first priced line).
    header_done = False

    for index, (line, up) in enumerate(zip(lines, upper, strict=True)):
        if _SUBTOTAL.search(up) or _TOTAL.search(up) or _PAYMENT.search(up):
            end = index
            break
        if _looks_like_date_or_time(up) and not _QTY.search(up):
            header_done = True
            continue
        if _NOISE.search(up) or (_VAT_AMOUNT.search(up) and not _QTY.search(up)):
            continue

        trailing = _TRAILING_AMOUNT.search(line)
        amount, before = _trailing_amount(line)
        qty = _QTY.search(up)
        if amount is not None:
            header_done = True

        # Item discount: a negative amount or a discount word right after an item.
        if amount is not None and (amount < 0 or (_DISCOUNT.search(up) and not qty)):
            value = abs(amount)
            if items and not _RECEIPT_DISCOUNT.search(up):
                last = items[-1]
                if value <= money(last.quantity * last.unit_price) - last.discount:
                    last.discount += value
                    continue
            result.discount += value
            continue

        if qty:
            quantity = Decimal(qty["qty"])
            unit = _unit(qty["unit"])
            price = Decimal(f"{qty['price'].replace(',', '')}.{qty['pcents']}")
            name_part = _clean_name(line[: qty.start()])
            printed = amount if trailing and trailing.start() >= qty.end() else None
            if quantity <= 0:
                continue
            if _letters(name_part) >= 2 or pending_name:
                # "NAME 3 @ 12.50 37.50" or pending "NAME" then "3 @ 12.50 37.50"
                item = DraftItem(
                    name=name_part if _letters(name_part) >= 2 else pending_name or "",
                    quantity=quantity,
                    unit=unit,
                    unit_price=price,
                )
                if printed is not None and abs(money(quantity * price) - printed) > TOLERANCE:
                    item.needs_review = True
                items.append(item)
                pending_name, awaiting_qty = None, None
            elif awaiting_qty is not None:
                # "NAME 69.00" then "2 X 34.50": the quantity line explains the item above.
                previous_total = awaiting_qty.unit_price
                awaiting_qty.quantity, awaiting_qty.unit, awaiting_qty.unit_price = (
                    quantity,
                    unit,
                    price,
                )
                if abs(money(quantity * price) - previous_total) > TOLERANCE:
                    awaiting_qty.needs_review = True
                awaiting_qty = None
            continue

        if amount is not None:
            name = _clean_name(before)
            if _letters(name) < 2 and pending_name:
                name = pending_name
            if _letters(name) < 2:
                continue  # a bare number we can't attach to anything
            item = DraftItem(name=name, unit_price=amount)
            items.append(item)
            pending_name, awaiting_qty = None, item
            continue

        # A line with letters and no amount: an item name whose price is on the next line.
        name = _clean_name(line)
        if _letters(name) >= 2 and header_done:
            pending_name, awaiting_qty = name, None
    return end


def _unit(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.upper()
    if raw.startswith("KG"):
        return "kg"
    if raw.startswith("G"):
        return "g"
    if raw in ("L", "ML"):
        return raw.lower() if raw == "ML" else "L"
    if raw.startswith("PC") or raw == "EA":
        return "pc"
    return "pack"


def _amount_on_or_after(lines: list[str], index: int) -> Decimal | None:
    """Amount at the end of this line, or alone on the next line (split columns)."""
    amount, _ = _trailing_amount(lines[index])
    if amount is not None:
        return amount
    if index + 1 < len(lines):
        nxt = lines[index + 1]
        amount, before = _trailing_amount(nxt)
        if amount is not None and _letters(before) == 0:
            return amount
    return None


def _totals(lines: list[str], upper: list[str], start: int, result: ParsedReceipt) -> str:
    """Reads subtotal, discounts, VAT and total after the items. Returns how the total was found."""
    strong: Decimal | None = None
    weak: Decimal | None = None
    cash: Decimal | None = None
    change: Decimal | None = None

    for index, up in enumerate(upper):
        if _VAT_AMOUNT.search(up) and not _NOT_VAT_AMOUNT.search(up) and not _TOTAL.search(up):
            value = _amount_on_or_after(lines, index)
            if result.vat is None and value is not None and value >= 0:
                result.vat = value

    for index in range(start, len(lines)):
        up = upper[index]
        if _VAT_AMOUNT.search(up) and not _NOT_VAT_AMOUNT.search(up) and not _TOTAL.search(up):
            continue
        if _SUBTOTAL.search(up):
            if result.subtotal is None:
                result.subtotal = _amount_on_or_after(lines, index)
            continue
        if _STRONG_TOTAL.search(up):
            value = _amount_on_or_after(lines, index)
            if strong is None and value is not None and value > 0:
                strong = value
            continue
        if _TOTAL.search(up) and not _NOT_TOTAL.search(up) and not _VAT_AMOUNT.search(up):
            value = _amount_on_or_after(lines, index)
            if weak is None and value is not None and value > 0:
                weak = value
            continue
        if _CHANGE.search(up):
            change = change if change is not None else _amount_on_or_after(lines, index)
            continue
        if _CASH.search(up):
            cash = cash if cash is not None else _amount_on_or_after(lines, index)
            continue
        if _NOT_TOTAL.search(up):
            continue  # "TOTAL DISCOUNT", "TOTAL SAVINGS": summaries of what's already counted
        if _DISCOUNT.search(up) and strong is None and weak is None:
            amount, _ = _trailing_amount(lines[index])
            if amount is not None:
                result.discount += abs(amount)

    if strong is not None:
        result.total = strong
        return "strong"
    if weak is not None:
        result.total = weak
        return "weak"
    if cash is not None and change is not None and cash - change > 0:
        result.total = cash - change
        result.flags.append(Flag("total", "inferred", "Total worked out from cash and change."))
        return "cash"
    if result.items and result.items_total > 0:
        result.total = result.items_total
        result.flags.append(Flag("total", "missing", "We couldn't find the total; check it."))
        return "items"
    result.flags.append(Flag("total", "missing", "We couldn't find the total."))
    return "none"


def _score(result: ParsedReceipt, total_source: str) -> None:
    reconciles = (
        result.total is not None
        and bool(result.items)
        and abs(result.items_total - result.total) <= TOLERANCE
    )
    base = {"strong": 0.85, "weak": 0.75, "cash": 0.6, "items": 0.3, "none": 0.0}[total_source]
    if reconciles and total_source in ("strong", "weak", "cash"):
        base = 0.99 if total_source == "strong" else 0.95
    result.confidence_total = base

    if not result.items:
        result.confidence_items = 0.0
        result.flags.append(Flag("items", "missing", "We couldn't read any items."))
        return
    clean = sum(1 for item in result.items if not item.needs_review) / len(result.items)
    result.confidence_items = clean * (1.0 if reconciles else 0.6)
    if not reconciles and result.total is not None and total_source != "items":
        result.flags.append(
            Flag("items", "mismatch", "The items don't add up to the total. Check them.")
        )
    if any(item.needs_review for item in result.items):
        result.flags.append(Flag("items", "uncertain", "Some item prices need checking."))
