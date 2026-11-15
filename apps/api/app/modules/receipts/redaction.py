"""Removes personal and payment identifiers from recognised receipt text before it is parsed
or stored (Phase 8D.4a; SRS 3.5, RA 10173 data minimisation).

What is masked:
- payment card numbers: card-shaped digit groups anywhere ("4111 1111 1111 1111"), long
  Luhn-valid digit runs (15–19 digits), and digit runs on card / account / wallet lines.
  Only the last four digits are kept ("**** 1111"), which is what receipts print anyway;
- payment metadata values: approval / authorisation codes, RRN, trace and reference numbers,
  terminal and merchant ids (labels stay so the line keeps its shape);
- the buyer's details BIR receipts ask for: name, address, TIN, signature ("SOLD TO", …),
  senior citizen / PWD / OSCA ids and names, loyalty and member numbers;
- e-mail addresses and Philippine mobile numbers anywhere.

What is kept: the store's own name, branch, address and TIN (business details printed on
every receipt), dates, items, quantities and all amounts. The parser reads only those, so
redacted text gives the same draft (tests/test_redaction.py checks every fixture).

Conservative by design: a 13-digit barcode before an item name is not a card number and is
left alone, and an amount (digits with two decimals) is never masked. The functions are pure
and safe to run twice.
"""

import re

MASK = "[redacted]"
MAX_TEXT_CHARS = 20_000  # a long receipt is ~3,000 characters; anything beyond is noise

# Control characters other than tab and newline (OCR output sometimes carries them).
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# 09XX XXX XXXX · +63 9XX XXX XXXX · 639XXXXXXXXX (spaces or dashes optional)
_MOBILE = re.compile(r"(?<![\d.,])(?:\+?63|0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?(\d{4})(?![\d.,]?\d)")
# 4-4-4-4 (and 4-6-5 Amex) groups separated by spaces or dashes, possibly partly masked.
_CARD_GROUPS = re.compile(
    r"(?<![\w.,])(?:[\dX*•]{4}[ -]){3}[\dX*•]{1,7}(?![\w.,])"
    r"|(?<![\w.,])[\dX*•]{4}[ -][\dX*•]{6}[ -][\dX*•]{5}(?![\w.,])",
    re.IGNORECASE,
)
# Continuous digit runs with no decimal part (amounts are never touched).
_LONG_DIGITS = re.compile(r"(?<![\d.,])\d{15,19}(?![\d]|[.,]\d)")
# Already-masked card numbers: "************1234", "XXXX1234".
_MASKED_CARD = re.compile(r"(?<![\w])[X*•]{4,}[ -]?(\d{4})(?!\d)", re.IGNORECASE)
# Digit runs of 6+ digits that may contain single spaces or dashes, but are not amounts.
_ID_DIGITS = re.compile(r"(?<![\d.,])\d(?:[ -]?\d){5,}(?![\d]|[.,]\d)")

# Lines about how the customer paid: any long digit run on them is an account identifier.
_PAYMENT_LINE = re.compile(
    r"\b(CARD|ACCT|ACCOUNT|A/C|VISA|MASTER\s*CARD|MASTERCARD|JCB|AMEX|DEBIT|CREDIT|BANCNET|"
    r"GCASH|MAYA|PAYMAYA|SHOPEEPAY|GRABPAY|QRPH|E-?WALLET|WALLET|MOBILE|CONTACT|CEL+(PHONE)?|"
    r"LOYALTY|REWARDS?|MEMBER(SHIP)?|ADVANTAGE|SUKI|POINTS?\s*CARD)\b"
)
# "<label> [:#] <value>": the value is replaced, the label stays.
_LABELLED_CODE = re.compile(
    r"\b(?P<label>APPR(OVAL)?\.?\s*(CODE|NO\.?|#)?|AUTH(ORI[SZ]ATION)?\.?\s*(CODE|NO\.?|#)?|"
    r"RRN|TRACE\s*(NO\.?|#)?|REF(ERENCE)?\.?\s*(NO\.?|#|ID)?|TID|MID|TERMINAL\s*ID|"
    r"MERCHANT\s*ID|BATCH\s*(NO\.?|#)?|INVOICE\s*#?\s*NO\.?\s*\(CARD\)|TXN\s*ID|"
    r"TRANSACTION\s*ID)"
    r"(?P<sep>\s*[:#.]?\s*)(?P<value>[A-Z0-9][A-Z0-9-]{3,})\b(?![.,]\d)",
    re.IGNORECASE,
)
# Buyer details: everything after the label is personal.
_PERSONAL_LABEL = re.compile(
    r"\b(?P<label>SOLD\s*TO|CUSTOMER(\s*'?S)?\s*(NAME|ADDRESS|TIN)?|BUYER(\s*'?S)?\s*"
    r"(NAME|ADDRESS|TIN)?|CARD\s*HOLDER(\s*NAME)?|CARDHOLDER(\s*NAME)?|NAME|ADDRESS|"
    r"SIGNATURE|SIGN(ED)?\s*BY|(SC|PWD|SC\s*/\s*PWD|OSCA|SENIOR(\s*CITIZEN)?)(\s*(ID|NAME|"
    r"NO\.?|#|TIN))+|ID\s*(NO\.?|#|NUMBER)|TIN\s*(NO\.?)?\s*\(?(CUSTOMER|BUYER)\)?|"
    r"MEMBER\s*(NO\.?|ID|#|NAME)|LOYALTY\s*(NO\.?|ID|#|CARD(\s*NO\.?)?))"
    r"(?P<sep>\s*[:#]\s*|\s+)(?P<value>\S.*)$",
    re.IGNORECASE,
)
# A line with money on it is never blanked wholesale (only identifiers on it are masked).
_HAS_AMOUNT = re.compile(r"(?<![\d.,])\d{1,3}(?:,\d{3})*[.,]\d{2}(?![\d])")
_ALREADY = re.compile(r"^(\[redacted\]|\*{4} \d{4}|[_\s.-]*)$")


def luhn_valid(digits: str) -> bool:
    total, parity = 0, len(digits) % 2
    for index, char in enumerate(digits):
        value = int(char)
        if index % 2 == parity:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def _last4(text: str) -> str:
    digits = re.sub(r"\D", "", text)
    return f"**** {digits[-4:]}" if len(digits) >= 4 else MASK


def _mask_card_groups(match: re.Match[str]) -> str:
    return _last4(match.group(0))


def _mask_long_digits(match: re.Match[str]) -> str:
    digits = match.group(0)
    return _last4(digits) if luhn_valid(digits) else digits


def _mask_id_digits(match: re.Match[str]) -> str:
    return _last4(match.group(0))


def _mask_labelled(match: re.Match[str]) -> str:
    value = match.group("value")
    if not any(c.isdigit() for c in value):
        return match.group(0)  # "REF: SUPERMARKET" is not a code
    return f"{match.group('label')}{match.group('sep')}{MASK}"


def _mask_personal(match: re.Match[str]) -> str:
    value = match.group("value")
    if _ALREADY.match(value.strip()):
        return match.group(0)
    if _HAS_AMOUNT.search(value):
        # e.g. "SC ID 1234567   -130.00": mask the identifier, keep the amount.
        return match.group(0)[: match.start("value") - match.start(0)] + _ID_DIGITS.sub(
            _mask_id_digits, value
        )
    sep = match.group("sep")
    return f"{match.group('label')}{sep if sep.strip() else ': '}{MASK}"


def redact_line(line: str) -> str:
    upper = line.upper()
    line = _EMAIL.sub(MASK, line)
    line = _MOBILE.sub(lambda m: f"**** {m.group(1)}", line)
    line = _CARD_GROUPS.sub(_mask_card_groups, line)
    line = _MASKED_CARD.sub(lambda m: f"**** {m.group(1)}", line)
    line = _LONG_DIGITS.sub(_mask_long_digits, line)
    line = _LABELLED_CODE.sub(_mask_labelled, line)
    line = _PERSONAL_LABEL.sub(_mask_personal, line)
    if _PAYMENT_LINE.search(upper):
        line = _ID_DIGITS.sub(_mask_id_digits, line)
    return line


def redact(text: str) -> str:
    """Recognised receipt text with personal and payment identifiers masked, control
    characters removed and the length capped. Line structure is kept, so the parser sees
    the same rows."""
    text = _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
    return "\n".join(redact_line(line) for line in text.split("\n"))
