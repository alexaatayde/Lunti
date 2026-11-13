"""`/notifications` and `/devices` (AGENTS.md §9, SRS 3.7.5)."""

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.core.auth import CurrentUserDep
from app.core.db import UserDbDep
from app.core.errors import PROBLEM_JSON, PROBLEM_RESPONSES, Problem
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    DeviceRegister,
    NotificationOut,
    NotificationPage,
    ReadAllResult,
)

_problem = {"model": Problem, "content": {PROBLEM_JSON: {}}}

notifications_router = APIRouter(
    prefix="/notifications", tags=["notifications"], responses=PROBLEM_RESPONSES
)
devices_router = APIRouter(prefix="/devices", tags=["devices"], responses=PROBLEM_RESPONSES)


@notifications_router.get(
    "", response_model=NotificationPage, summary="Your latest notifications, newest first"
)
def list_notifications(user: CurrentUserDep, db: UserDbDep) -> NotificationPage:
    return service.list_notifications(db, user)


@notifications_router.post(
    "/read-all", response_model=ReadAllResult, summary="Mark every notification as read"
)
def read_all(user: CurrentUserDep, db: UserDbDep) -> ReadAllResult:
    return ReadAllResult(updated=service.mark_all_read(db, user))


@notifications_router.post(
    "/{notification_id}/read",
    response_model=NotificationOut,
    summary="Mark a notification as read",
    responses={404: {**_problem, "description": "Notification not found."}},
)
def read_one(notification_id: UUID, user: CurrentUserDep, db: UserDbDep) -> NotificationOut:
    return service.mark_read(db, user, notification_id)


@devices_router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Register this phone's FCM token for push notifications",
)
def register_device(body: DeviceRegister, user: CurrentUserDep, db: UserDbDep) -> Response:
    service.register_device(db, user, body.fcm_token, body.platform)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@devices_router.delete(
    "/{fcm_token}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop push notifications to this phone (sign-out)",
)
def unregister_device(fcm_token: str, user: CurrentUserDep, db: UserDbDep) -> Response:
    service.unregister_device(db, user, fcm_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
