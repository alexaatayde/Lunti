from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.modules.replenishment.schemas import Suggestion

NotificationType = Literal["budget", "replenishment", "shopping"]


class NotificationOut(BaseModel):
    id: UUID
    type: str
    title: str
    body: str
    deep_link: str | None
    level: Literal["near", "exceeded"] | None = Field(description="Budget alerts only.")
    suggestion: Suggestion | None = Field(
        description="Restock reminders: the suggestion, so open ones can be answered here."
    )
    created_at: datetime
    read_at: datetime | None


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    unread_count: int


class ReadAllResult(BaseModel):
    updated: int


Token = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=4096)]


class DeviceRegister(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fcm_token: Token
    platform: Literal["android", "ios"]
