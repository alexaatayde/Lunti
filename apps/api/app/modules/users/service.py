"""Profile and preferences. Every query is filtered by the caller's user_id (RLS also applies)."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, unauthorized
from app.modules.users.models import Profile, UserPreferences
from app.modules.users.schemas import Me, MeUpdate, Preferences


def _metadata_timestamp(metadata: dict[str, Any], key: str) -> datetime | None:
    """A consent time from sign-up metadata, if present and sane (never in the future)."""
    raw = metadata.get(key)
    if not isinstance(raw, str):
        return None
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if value.tzinfo is None:
        return None
    return min(value, datetime.now(UTC))


def _get_or_create_profile(db: Session, user: CurrentUser) -> Profile:
    profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
    if profile is not None:
        return profile
    # Normally created by the on_auth_user_created trigger. This covers a user whose
    # profile is missing (e.g. created before the trigger existed and not backfilled).
    metadata = user.claims.get("user_metadata") or {}
    full_name = metadata.get("full_name")
    profile = Profile(
        user_id=user.id,
        full_name=full_name.strip()[:100] or None if isinstance(full_name, str) else None,
        terms_accepted_at=_metadata_timestamp(metadata, "terms_accepted_at"),
        data_consent_at=_metadata_timestamp(metadata, "data_consent_at"),
    )
    _insert_for_existing_user(db, profile)
    return profile


def _insert_for_existing_user(db: Session, row: Profile | UserPreferences) -> None:
    """Insert a row keyed by user_id. If the auth user was deleted while their token is
    still valid, the foreign key fails: answer 401 instead of a server error."""
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError as exc:
        raise unauthorized("This account no longer exists.") from exc
    db.refresh(row)


def _to_me(profile: Profile, user: CurrentUser) -> Me:
    return Me(
        user_id=profile.user_id,
        email=user.email,
        full_name=profile.full_name,
        role=profile.role,  # type: ignore[arg-type]
        currency=profile.currency,  # type: ignore[arg-type]
        terms_accepted_at=profile.terms_accepted_at,
        data_consent_at=profile.data_consent_at,
        created_at=profile.created_at,
    )


def get_me(db: Session, user: CurrentUser) -> Me:
    return _to_me(_get_or_create_profile(db, user), user)


def update_me(db: Session, user: CurrentUser, changes: MeUpdate) -> Me:
    profile = _get_or_create_profile(db, user)
    profile.full_name = changes.full_name
    db.flush()
    db.refresh(profile)
    return _to_me(profile, user)


def _get_or_create_preferences(db: Session, user: CurrentUser) -> UserPreferences:
    prefs = db.scalar(select(UserPreferences).where(UserPreferences.user_id == user.id))
    if prefs is None:
        prefs = UserPreferences(user_id=user.id)
        _insert_for_existing_user(db, prefs)
    return prefs


def get_preferences(db: Session, user: CurrentUser) -> Preferences:
    return Preferences.model_validate(_get_or_create_preferences(db, user))


def replace_preferences(db: Session, user: CurrentUser, new: Preferences) -> Preferences:
    prefs = _get_or_create_preferences(db, user)
    for field, value in new.model_dump().items():
        setattr(prefs, field, value)
    db.flush()
    return Preferences.model_validate(prefs)
