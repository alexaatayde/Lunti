"""Push delivery through Firebase Cloud Messaging (AGENTS.md §2, SRS 3.7.5).

- `FcmSender`: firebase-admin with the service-account JSON at FCM_CREDENTIALS (backend only;
  the app only ever sends us its device token).
- `DisabledSender`: used when FCM_CREDENTIALS is not set. Nothing is pushed; notifications
  still appear in the app's Notifications screen. It never pretends a push was delivered.
Tests pass their own fake sender, so test runs never reach real devices.
"""

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


class PushUnavailable(Exception):
    """FCM couldn't be reached (temporary): leave the notification for the next run."""


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    data: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PushResult:
    delivered: int
    dead_tokens: list[str]


class PushSender(Protocol):
    name: str

    def send(self, tokens: list[str], message: PushMessage) -> PushResult: ...


class DisabledSender:
    name = "disabled"

    def send(self, tokens: list[str], message: PushMessage) -> PushResult:
        return PushResult(delivered=0, dead_tokens=[])


class FcmSender:
    name = "fcm"

    def __init__(self, credentials_file: str) -> None:
        import firebase_admin
        from firebase_admin import credentials

        self._app = firebase_admin.initialize_app(
            credentials.Certificate(credentials_file), name="lunti-push"
        )

    def send(self, tokens: list[str], message: PushMessage) -> PushResult:
        from firebase_admin import exceptions, messaging

        if not tokens:
            return PushResult(0, [])
        multicast = messaging.MulticastMessage(
            tokens=tokens,
            notification=messaging.Notification(title=message.title, body=message.body),
            data=message.data,
            android=messaging.AndroidConfig(priority="high"),
        )
        try:
            batch = messaging.send_each_for_multicast(multicast, app=self._app)
        except exceptions.FirebaseError as exc:
            logger.warning("FCM request failed: %s", exc.__class__.__name__)
            raise PushUnavailable from exc
        dead = [
            token
            for token, response in zip(tokens, batch.responses, strict=True)
            if not response.success and _is_dead(response.exception)
        ]
        return PushResult(delivered=batch.success_count, dead_tokens=dead)


@lru_cache
def get_sender() -> PushSender:
    path = settings.fcm_credentials.strip()
    if not path:
        logger.warning("FCM_CREDENTIALS not set: notifications stay in the app (no push)")
        return DisabledSender()
    if not Path(path).is_file():
        logger.error("FCM_CREDENTIALS file not found: push disabled")
        return DisabledSender()
    return FcmSender(path)


def _is_dead(error: Exception | None) -> bool:
    """The token will never work again (app uninstalled, token from another project)."""
    from firebase_admin import messaging

    if isinstance(error, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
        return True
    return getattr(error, "code", None) == "INVALID_ARGUMENT"
