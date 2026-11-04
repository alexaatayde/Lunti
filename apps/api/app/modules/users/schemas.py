from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints

FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Me(BaseModel):
    """The signed-in user's profile."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str | None
    full_name: str | None
    role: Literal["user", "admin"]
    currency: Literal["PHP"]
    terms_accepted_at: datetime | None
    data_consent_at: datetime | None
    created_at: datetime


class MeUpdate(BaseModel):
    """Fields a user may change on their profile. Role and consents are not editable."""

    model_config = ConfigDict(extra="forbid")

    full_name: FullName


class Preferences(BaseModel):
    """Notification toggles and the budget alert threshold (Profile screen)."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    notify_budget: StrictBool
    notify_replenishment: StrictBool
    notify_shopping: StrictBool
    notify_meals: StrictBool
    budget_alert_pct: int = Field(
        ge=50, le=100, description="Send a 'near limit' alert at this % of a budget."
    )
