from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class InsightOut(BaseModel):
    id: UUID
    type: Literal["spending", "budget"]
    message: str
    engine: Literal["ai", "summary"] = Field(
        description='"ai" = worded by the model (numbers checked); "summary" = fixed template.'
    )
    generated_at: datetime


class InsightsPage(BaseModel):
    items: list[InsightOut]
    need_more_data: bool = Field(description="Too little data for insights yet.")
    placeholder: str | None
