"""Categories. Transactions: transaction_service.py; budgets: budget_service.py.

Defaults (user_id NULL) are visible to everyone and read-only; users manage their own.
Another user's category is reported as "not found" so its existence isn't revealed.
"""

from uuid import UUID

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser
from app.core.errors import ApiError, not_found
from app.modules.expenses.models import Budget, Category, Transaction
from app.modules.expenses.schemas import CategoryCreate, CategoryUpdate


def _visible(user: CurrentUser):  # noqa: ANN202
    return or_(Category.user_id.is_(None), Category.user_id == user.id)


def list_categories(db: Session, user: CurrentUser) -> list[Category]:
    stmt = (
        select(Category)
        .where(_visible(user))
        .order_by(Category.is_default.desc(), Category.sort_order, func.lower(Category.name))
    )
    return list(db.scalars(stmt))


def _name_taken(db: Session, user: CurrentUser, name: str, exclude: UUID | None = None) -> bool:
    stmt = select(Category.id).where(_visible(user), func.lower(Category.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Category.id != exclude)
    return db.scalar(stmt) is not None


def _conflict(name: str) -> ApiError:
    return ApiError(409, "category-exists", f'A category named "{name}" already exists.')


def _get_own(db: Session, user: CurrentUser, category_id: UUID) -> Category:
    category = db.scalar(select(Category).where(Category.id == category_id, _visible(user)))
    if category is None:
        raise not_found("Category")
    if category.is_default:
        raise ApiError(403, "default-category", "Default categories can't be changed.")
    return category


def create_category(db: Session, user: CurrentUser, data: CategoryCreate) -> Category:
    if _name_taken(db, user, data.name):
        raise _conflict(data.name)
    category = Category(user_id=user.id, name=data.name, icon=data.icon)
    try:
        with db.begin_nested():  # savepoint: a race on the unique index → 409, not 500
            db.add(category)
            db.flush()
    except IntegrityError as exc:
        raise _conflict(data.name) from exc
    db.refresh(category)
    return category


def update_category(
    db: Session, user: CurrentUser, category_id: UUID, data: CategoryUpdate
) -> Category:
    category = _get_own(db, user, category_id)
    if data.name is not None and _name_taken(db, user, data.name, exclude=category.id):
        raise _conflict(data.name)
    try:
        with db.begin_nested():
            if data.name is not None:
                category.name = data.name
            if "icon" in data.model_fields_set:
                category.icon = data.icon
            db.flush()
    except IntegrityError as exc:
        raise _conflict(data.name or category.name) from exc
    db.refresh(category)
    return category


def delete_category(db: Session, user: CurrentUser, category_id: UUID) -> None:
    category = _get_own(db, user, category_id)
    in_use = db.scalar(
        select(
            exists().where(Transaction.category_id == category.id, Transaction.user_id == user.id)
            | exists().where(Budget.category_id == category.id, Budget.user_id == user.id)
        )
    )
    if in_use:
        raise ApiError(
            409,
            "category-in-use",
            "This category is used by transactions or budgets. Move them first.",
        )
    db.delete(category)
    db.flush()
