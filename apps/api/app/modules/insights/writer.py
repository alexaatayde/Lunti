"""Who words an insight (AGENTS.md §4.3, §7.7). The figures are always computed by the backend.

- `OpenAiWriter`: OpenAI with OPENAI_API_KEY + OPENAI_MODEL (backend only). It receives only
  the figures (no names, emails or ids) and must use only them.
- `TemplateWriter`: fixed sentences from the same figures. Used when OpenAI isn't configured,
  fails, or returns a number that isn't in the figures. Labelled "summary", never "AI".
"""

import json
import logging
import re
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)

AI = "ai"
TEMPLATE = "summary"

SYSTEM = (
    "You write one short, friendly sentence or two about a person's spending for a budgeting "
    "app in the Philippines. Use ONLY the figures in the JSON you receive. Do not add, round, "
    "estimate or calculate any other number, date or percentage. Do not predict the future, "
    "promise savings or give financial advice beyond the figures. Write money as ₱ with two "
    "decimals exactly as given. Plain text, no lists, at most 45 words."
)


class InsightWriter(Protocol):
    engine: str

    def write(self, kind: str, figures: dict) -> str | None: ...


def peso(value: str | Decimal) -> str:
    return f"₱{Decimal(value):,.2f}"


class TemplateWriter:
    engine = TEMPLATE

    def write(self, kind: str, figures: dict) -> str | None:
        if kind == "spending":
            pct = figures["change_pct"]
            if pct > 0:
                change = f"{pct}% more than"
            elif pct < 0:
                change = f"{-pct}% less than"
            else:
                change = "about the same as"
            text = (
                f"You've spent {peso(figures['month_total'])} so far this month, {change} the "
                f"same days last month ({peso(figures['previous_total'])})."
            )
            if figures.get("top_category"):
                text += (
                    f" {figures['top_category']} is your biggest category at "
                    f"{peso(figures['top_category_total'])} ({figures['top_category_share_pct']}%)."
                )
            return text
        if kind == "budget":
            label = figures["budget_label"]
            if figures["budget_level"] == "exceeded":
                return (
                    f"Your {label} budget is exceeded: {peso(figures['budget_spent'])} spent of "
                    f"{peso(figures['budget_limit'])}."
                )
            return (
                f"Your {label} budget is at {figures['budget_percent_used']}%: "
                f"{peso(figures['budget_remaining'])} left."
            )
        return None


class OpenAiWriter:
    engine = AI

    def __init__(self, api_key: str, model: str) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key, timeout=settings.openai_timeout_seconds)
        self._model = model

    def write(self, kind: str, figures: dict) -> str | None:
        import openai

        try:
            response = self._client.responses.create(
                model=self._model,
                instructions=SYSTEM,
                input=json.dumps({"insight": kind, "figures": figures}, ensure_ascii=False),
                max_output_tokens=200,
            )
        except openai.OpenAIError as exc:
            logger.warning("OpenAI request failed: %s", exc.__class__.__name__)
            return None
        return (response.output_text or "").strip() or None


# ---------- number check ----------

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _forms(value: object) -> set[str]:
    """Ways a figure may legitimately appear in text: 1610.00 → {"1610.00", "1,610.00", "1610"}."""
    out: set[str] = set()
    if isinstance(value, bool) or value is None:
        return out
    if isinstance(value, int):
        return {str(abs(value))}
    try:
        number = Decimal(str(value))
    except ArithmeticError:
        return out
    except Exception:  # noqa: BLE001 (non-numeric strings)
        return out
    number = abs(number)
    out |= {f"{number:.2f}", f"{number:,.2f}"}
    if number == number.to_integral_value():
        out |= {f"{number:.0f}", f"{number:,.0f}"}
    return out


def allowed_numbers(figures: dict) -> set[str]:
    allowed: set[str] = set()
    for key, value in figures.items():
        if key.endswith(("_date", "_start", "_end")) and isinstance(value, str):
            allowed |= {str(int(part)) for part in value.split("-")[1:]}  # month and day
            allowed.add(value.split("-")[0])
        else:
            allowed |= _forms(value)
    return allowed


def numbers_check(text: str, figures: dict) -> bool:
    """Every number in the text must come from the figures (AGENTS.md §4.3)."""
    allowed = {a.replace(",", "") for a in allowed_numbers(figures)}
    return all(n.replace(",", "") in allowed for n in _NUMBER.findall(text))


@lru_cache
def get_writer() -> InsightWriter:
    if settings.openai_api_key.strip() and settings.openai_model.strip():
        return OpenAiWriter(settings.openai_api_key.strip(), settings.openai_model.strip())
    logger.info("OpenAI not configured: insights use the template writer")
    return TemplateWriter()
