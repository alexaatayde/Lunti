"""Insights (AGENTS.md §7.7, SRS 3.1.10): advisory text about figures the backend computed.

1. Figures come from the analytics and budget services (SQL sums, Decimal). The insight never
   produces or changes a financial figure, and nothing here writes financial records.
2. Too little data (fewer than INSIGHTS_MIN_TRANSACTIONS in this + last month, or nothing to
   compare with) → a "need more data" placeholder, and the model isn't called.
3. The writer (OpenAI or template) words the figures. A model reply with any number that isn't
   in the figures is rejected and the template is used instead.
4. Generated at most once a day per user (Asia/Manila), stored with its source figures.
Only default category names reach the model; a custom category is sent as "another category".
"""

import logging
from datetime import UTC, datetime, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.errors import not_found
from app.modules.analytics import service as analytics
from app.modules.expenses import budget_service, periods, transaction_service
from app.modules.insights.models import Insight
from app.modules.insights.schemas import InsightOut, InsightsPage
from app.modules.insights.writer import TEMPLATE, InsightWriter, TemplateWriter, numbers_check

logger = logging.getLogger(__name__)

PLACEHOLDER = "Add a few weeks of purchases and Lunti will start pointing out trends here."


def figures(db: Session, user: CurrentUser) -> dict[str, dict]:
    """{kind: figures} for every insight the data supports (may be empty)."""
    out: dict[str, dict] = {}
    default_ids = {c.id for c in _categories(db, user) if c.is_default}
    month = analytics.summary(db, user, "monthly")
    previous = transaction_service.summarize(
        db, user, date_from=month.previous_start, date_to=month.previous_end
    )
    enough = month.transaction_count + previous.count >= settings.insights_min_transactions
    if enough and month.previous_total > 0 and month.change_pct is not None:
        spending = {
            "month_total": str(month.total),
            "previous_total": str(month.previous_total),
            "change_pct": month.change_pct,
            "period_start": month.start.isoformat(),
            "period_end": month.end.isoformat(),
        }
        if month.by_category:
            top = month.by_category[0]
            spending["top_category"] = (
                top.category.name if top.category.id in default_ids else "Another category"
            )
            spending["top_category_total"] = str(top.total)
            spending["top_category_share_pct"] = top.share_pct
        out["spending"] = spending

    alerts = [
        s
        for s in budget_service.list_status(db, user)
        if s.state == "active" and s.level in ("near", "exceeded")
    ]
    if alerts:
        worst = sorted(alerts, key=lambda s: (s.level != "exceeded", -s.percent_used))[0]
        is_custom = (
            worst.budget.category is not None and worst.budget.category.id not in default_ids
        )
        out["budget"] = {
            "budget_label": "custom category" if is_custom else worst.budget.label,
            "budget_level": worst.level,
            "budget_spent": str(worst.spent),
            "budget_limit": str(worst.budget.limit_amount),
            "budget_remaining": str(worst.remaining),
            "budget_percent_used": worst.percent_used,
        }
    return out


def _categories(db: Session, user: CurrentUser) -> list:
    from app.modules.expenses import service as categories_service

    return categories_service.list_categories(db, user)


def _word(kind: str, data: dict, writer: InsightWriter) -> tuple[str, str]:
    template = TemplateWriter()
    if writer.engine != TEMPLATE:
        text = writer.write(kind, data)
        if text and numbers_check(text, data):
            return text, writer.engine
        if text:
            logger.warning("Insight reply cited a number outside its figures; using template")
    text = template.write(kind, data) or ""
    return text, TEMPLATE


def _today_start() -> datetime:
    return datetime.combine(periods.local_today(), time.min, tzinfo=periods.app_tz())


def _to_out(row: Insight) -> InsightOut:
    return InsightOut(
        id=row.id,
        type=row.type,  # type: ignore[arg-type]
        message=row.message,
        engine=row.source_figures.get("engine", TEMPLATE),
        generated_at=row.generated_at.astimezone(UTC),  # same form when new or reloaded
    )


def list_insights(db: Session, user: CurrentUser, writer: InsightWriter) -> InsightsPage:
    # One generation per user at a time (two screens opening at once).
    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"insights:{user.id}"))))
    today = list(
        db.scalars(
            select(Insight)
            .where(Insight.user_id == user.id, Insight.generated_at >= _today_start())
            .order_by(Insight.generated_at.desc(), Insight.id)
        )
    )
    if not today:
        for kind, data in figures(db, user).items():
            message, engine = _word(kind, data, writer)
            row = Insight(
                user_id=user.id,
                type=kind,
                message=message,
                source_figures={**data, "engine": engine},
                generated_at=datetime.now(UTC),
            )
            db.add(row)
            today.append(row)
        db.flush()
    visible = [r for r in today if not r.dismissed]
    if not today:
        return InsightsPage(items=[], need_more_data=True, placeholder=PLACEHOLDER)
    return InsightsPage(items=[_to_out(r) for r in visible], need_more_data=False, placeholder=None)


def dismiss(db: Session, user: CurrentUser, insight_id) -> InsightOut:  # noqa: ANN001
    row = db.scalar(select(Insight).where(Insight.id == insight_id, Insight.user_id == user.id))
    if row is None:
        raise not_found("Insight")
    row.dismissed = True
    db.flush()
    return _to_out(row)
