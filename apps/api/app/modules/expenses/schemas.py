from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
CategoryIcon = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,32}$")]


class Category(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    icon: str | None
    is_default: bool


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    icon: CategoryIcon | None = None


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    icon: CategoryIcon | None = None

    @model_validator(mode="after")
    def _has_changes(self) -> "CategoryUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one of: name, icon.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name can't be null.")
        return self
