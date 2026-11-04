"""`/me` and `/me/preferences` (AGENTS.md §9). Account deletion (DELETE /me) waits on the
data-retention decision (AGENTS.md §13)."""

from fastapi import APIRouter

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_RESPONSES
from app.modules.users import service
from app.modules.users.schemas import Me, MeUpdate, Preferences

router = APIRouter(prefix="/me", tags=["me"], responses=PROBLEM_RESPONSES)


@router.get("", response_model=Me, summary="Get the signed-in user's profile")
def get_me(user: CurrentUserDep, db: UserDbDep) -> Me:
    return service.get_me(db, user)


@router.patch("", response_model=Me, summary="Update the signed-in user's profile")
def update_me(body: MeUpdate, user: CurrentUserDep, db: UserDbDep) -> Me:
    return service.update_me(db, user, body)


@router.get("/preferences", response_model=Preferences, summary="Get notification preferences")
def get_preferences(user: CurrentUserDep, db: UserDbDep) -> Preferences:
    return service.get_preferences(db, user)


@router.put("/preferences", response_model=Preferences, summary="Replace notification preferences")
def replace_preferences(body: Preferences, user: CurrentUserDep, db: UserDbDep) -> Preferences:
    return service.replace_preferences(db, user, body)
