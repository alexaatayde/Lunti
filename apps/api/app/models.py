"""Imports every module's models so Base.metadata is complete (Alembic, tests, seed)."""

from app.core.db import Base
from app.modules.analytics.models import Product, PurchasePattern
from app.modules.expenses.models import (
    Budget,
    Category,
    IdempotencyKey,
    Transaction,
    TransactionLineItem,
)
from app.modules.insights.models import Insight
from app.modules.meals.models import IngredientInventory, Recipe, RecipeIngredient
from app.modules.notifications.models import DeviceToken, Notification
from app.modules.receipts.models import Receipt
from app.modules.replenishment.models import (
    ReplenishmentSuggestion,
    ShoppingList,
    ShoppingListItem,
)
from app.modules.users.models import Feedback, Profile, UserPreferences

metadata = Base.metadata

__all__ = [
    "Budget",
    "Category",
    "DeviceToken",
    "Feedback",
    "IdempotencyKey",
    "IngredientInventory",
    "Insight",
    "Notification",
    "Product",
    "Profile",
    "PurchasePattern",
    "Recipe",
    "RecipeIngredient",
    "Receipt",
    "ReplenishmentSuggestion",
    "ShoppingList",
    "ShoppingListItem",
    "Transaction",
    "TransactionLineItem",
    "UserPreferences",
    "metadata",
]
