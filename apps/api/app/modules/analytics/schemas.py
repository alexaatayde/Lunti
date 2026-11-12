from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.expenses.schemas import CategoryTotal

Period = Literal["daily", "weekly", "monthly"]
DataTier = Literal["sufficient", "limited", "insufficient"]


class TrendBucket(BaseModel):
    start: date
    end: date
    total: Decimal
    is_future: bool = Field(description="The bucket starts after today (no spending yet).")


class AnalyticsSummary(BaseModel):
    """Spending for the current period so far, compared with the same span of the previous
    period. All figures are SQL sums of the user's transactions (AGENTS.md §4.2)."""

    period: Period
    start: date
    end: date = Field(description="Today (Asia/Manila).")
    previous_start: date
    previous_end: date
    compared_until: datetime = Field(
        description="The previous window stops here: the current time of day on previous_end, "
        "so an unfinished today is compared like for like."
    )
    total: Decimal
    previous_total: Decimal
    change_amount: Decimal = Field(description="total − previous_total (negative = less).")
    change_pct: int | None = Field(
        description="Whole percent change vs previous_total; null when previous_total is 0."
    )
    transaction_count: int
    by_category: list[CategoryTotal]
    trend_granularity: Literal["day", "week"]
    trend: list[TrendBucket]


class ProductRef(BaseModel):
    id: UUID
    name: str
    unit: str | None


class ProductPattern(BaseModel):
    product: ProductRef
    purchase_count: int = Field(description="Distinct days the product was bought.")
    data_tier: DataTier
    avg_interval_days: Decimal | None = Field(description="Null when data is insufficient.")
    interval_stddev_days: Decimal | None
    confidence: Decimal = Field(
        description="0–1 heuristic consistency score (sample size × regularity of intervals), "
        "not a statistical probability; 0 when data is insufficient."
    )
    last_purchased_at: datetime | None
    average_spend: Decimal | None = Field(description="Average paid per purchase day.")
