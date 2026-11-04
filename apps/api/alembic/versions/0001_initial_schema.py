"""Initial Lunti schema: all AGENTS.md §6 tables, RLS, grants and the sign-up trigger.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-11-04

Security model
- The API switches each request to the NOLOGIN role `lunti_app_user` and sets
  `request.jwt.claims` (app/core/db.py). Policies below compare `user_id` with
  `lunti_private.current_user_id()`, which reads that claim — the same mechanism as
  Supabase's auth.uid(), kept in our own schema so no grants on `auth` are needed.
- Supabase's Data API roles (`anon`, `authenticated`) get NO privileges on these tables:
  the mobile app reaches data only through FastAPI (AGENTS.md §3). RLS is enabled on every
  table, so even an accidental grant would expose nothing without a matching policy.
- `profiles.role` and consent timestamps are not updatable by the app role.

Requires a Supabase-like database: the `auth.users` table and the `anon`/`authenticated`
roles (tests create stand-ins; see tests/supabase_stub.sql).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lunti_app_user"

# Tables whose rows belong to one user through a user_id column.
OWNED_TABLES = [
    "budgets",
    "device_tokens",
    "feedback",
    "ingredient_inventory",
    "insights",
    "notifications",
    "products",
    "purchase_patterns",
    "receipts",
    "replenishment_suggestions",
    "shopping_lists",
    "transactions",
]
ALL_TABLES = [
    *OWNED_TABLES,
    "categories",
    "profiles",
    "recipe_ingredients",
    "recipes",
    "shopping_list_items",
    "transaction_line_items",
    "user_preferences",
]

UID = "(select lunti_private.current_user_id())"

PRELUDE = """
create schema if not exists lunti_private;
revoke all on schema lunti_private from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lunti_app_user') then
    create role lunti_app_user nologin noinherit;
  end if;
end $$;

-- The connecting role (postgres on Supabase) must be able to SET ROLE lunti_app_user.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    execute format('grant lunti_app_user to %I with inherit false, set true', current_user);
  else
    execute format('grant lunti_app_user to %I', current_user);
  end if;
end $$;

grant usage on schema public to lunti_app_user;
grant usage on schema lunti_private to lunti_app_user;

-- Caller's user id for RLS, from the claims the API sets per transaction.
create or replace function lunti_private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid
$fn$;
revoke execute on function lunti_private.current_user_id() from public;
grant execute on function lunti_private.current_user_id() to lunti_app_user;

create or replace function lunti_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;
revoke execute on function lunti_private.set_updated_at() from public;
"""

TABLES_DDL = """
CREATE TABLE recipes (
    name TEXT NOT NULL,
    servings SMALLINT NOT NULL,
    prep_time_minutes SMALLINT NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_recipes PRIMARY KEY (id),
    CONSTRAINT ck_recipes_servings_positive CHECK (servings > 0),
    CONSTRAINT ck_recipes_prep_time_non_negative CHECK (prep_time_minutes >= 0),
    CONSTRAINT ck_recipes_name_length CHECK (char_length(btrim(name)) between 1 and 120)
);

CREATE TABLE categories (
    user_id UUID,
    name TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false NOT NULL,
    icon TEXT,
    sort_order SMALLINT DEFAULT 100 NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_categories PRIMARY KEY (id),
    CONSTRAINT ck_categories_owner CHECK ((is_default and user_id is null) or (not is_default and user_id is not null)),
    CONSTRAINT ck_categories_name_length CHECK (char_length(btrim(name)) between 1 and 40),
    CONSTRAINT ck_categories_icon_format CHECK (icon is null or icon ~ '^[a-z0-9-]{1,32}$'),
    CONSTRAINT fk_categories_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_categories_default_name ON categories (lower(name)) WHERE user_id is null;

CREATE UNIQUE INDEX uq_categories_user_id_name ON categories (user_id, lower(name)) WHERE user_id is not null;

CREATE TABLE device_tokens (
    user_id UUID NOT NULL,
    fcm_token TEXT NOT NULL,
    platform TEXT NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_device_tokens PRIMARY KEY (id),
    CONSTRAINT ck_device_tokens_platform CHECK (platform in ('android', 'ios')),
    CONSTRAINT fk_device_tokens_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT uq_device_tokens_fcm_token UNIQUE (fcm_token)
);

CREATE INDEX ix_device_tokens_user_id ON device_tokens (user_id);

CREATE TABLE feedback (
    user_id UUID NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    action TEXT NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_feedback PRIMARY KEY (id),
    CONSTRAINT ck_feedback_target_type CHECK (target_type in ('replenishment_suggestion', 'insight', 'recipe', 'shopping_list_item')),
    CONSTRAINT ck_feedback_action CHECK (action in ('add_to_list', 'still_have', 'bought_elsewhere', 'dont_remind', 'dismiss', 'modify')),
    CONSTRAINT fk_feedback_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_feedback_user_id_target ON feedback (user_id, target_type, target_id);

CREATE TABLE insights (
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    source_figures JSONB DEFAULT '{}'::jsonb NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    dismissed BOOLEAN DEFAULT false NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_insights PRIMARY KEY (id),
    CONSTRAINT fk_insights_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_insights_user_id_generated_at ON insights (user_id, generated_at desc);

CREATE TABLE notifications (
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb NOT NULL,
    deep_link TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT fk_notifications_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_notifications_user_id_created_at ON notifications (user_id, created_at desc);

CREATE TABLE profiles (
    user_id UUID NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'user' NOT NULL,
    currency VARCHAR(3) DEFAULT 'PHP' NOT NULL,
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    data_consent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_profiles PRIMARY KEY (user_id),
    CONSTRAINT ck_profiles_role CHECK (role in ('user', 'admin')),
    CONSTRAINT ck_profiles_currency CHECK (currency = 'PHP'),
    CONSTRAINT ck_profiles_full_name_length CHECK (char_length(full_name) <= 100),
    CONSTRAINT fk_profiles_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE receipts (
    user_id UUID NOT NULL,
    image_path TEXT NOT NULL,
    ocr_raw_text TEXT,
    ocr_status TEXT DEFAULT 'processing' NOT NULL,
    confidence_store NUMERIC(4, 3),
    confidence_items NUMERIC(4, 3),
    confidence_total NUMERIC(4, 3),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_receipts PRIMARY KEY (id),
    CONSTRAINT ck_receipts_ocr_status CHECK (ocr_status in ('processing', 'draft', 'failed', 'confirmed')),
    CONSTRAINT ck_receipts_confirmed_at CHECK ((ocr_status = 'confirmed') = (confirmed_at is not null)),
    CONSTRAINT ck_receipts_confidence_range CHECK (confidence_store between 0 and 1 and confidence_items between 0 and 1 and confidence_total between 0 and 1),
    CONSTRAINT fk_receipts_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_receipts_user_id_created_at ON receipts (user_id, created_at desc);

CREATE TABLE shopping_lists (
    user_id UUID NOT NULL,
    name TEXT DEFAULT 'Grocery list' NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_shopping_lists PRIMARY KEY (id),
    CONSTRAINT ck_shopping_lists_name_length CHECK (char_length(btrim(name)) between 1 and 60),
    CONSTRAINT fk_shopping_lists_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_shopping_lists_user_id ON shopping_lists (user_id);

CREATE TABLE user_preferences (
    user_id UUID NOT NULL,
    notify_budget BOOLEAN DEFAULT true NOT NULL,
    notify_replenishment BOOLEAN DEFAULT true NOT NULL,
    notify_shopping BOOLEAN DEFAULT true NOT NULL,
    notify_meals BOOLEAN DEFAULT true NOT NULL,
    budget_alert_pct SMALLINT DEFAULT 90 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_user_preferences PRIMARY KEY (user_id),
    CONSTRAINT ck_user_preferences_budget_alert_pct CHECK (budget_alert_pct between 50 and 100),
    CONSTRAINT fk_user_preferences_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE budgets (
    user_id UUID NOT NULL,
    category_id UUID,
    period_type TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    limit_amount NUMERIC(12, 2) NOT NULL,
    alerts_enabled BOOLEAN DEFAULT true NOT NULL,
    last_alert_level TEXT DEFAULT 'none' NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_budgets PRIMARY KEY (id),
    CONSTRAINT ck_budgets_period_type CHECK (period_type in ('daily', 'weekly', 'monthly', 'custom')),
    CONSTRAINT ck_budgets_limit_positive CHECK (limit_amount > 0),
    CONSTRAINT ck_budgets_date_order CHECK (end_date is null or end_date >= start_date),
    CONSTRAINT ck_budgets_custom_has_end_date CHECK (period_type <> 'custom' or end_date is not null),
    CONSTRAINT ck_budgets_last_alert_level CHECK (last_alert_level in ('none', 'near', 'exceeded')),
    CONSTRAINT fk_budgets_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_budgets_category_id_categories FOREIGN KEY(category_id) REFERENCES categories (id) ON DELETE RESTRICT
);

CREATE INDEX ix_budgets_category_id ON budgets (category_id);

CREATE INDEX ix_budgets_user_id ON budgets (user_id);

CREATE TABLE products (
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    is_food BOOLEAN DEFAULT true NOT NULL,
    default_category_id UUID,
    default_unit TEXT,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_products PRIMARY KEY (id),
    CONSTRAINT uq_products_user_id_normalized_name UNIQUE (user_id, normalized_name),
    CONSTRAINT ck_products_name_length CHECK (char_length(btrim(name)) between 1 and 120),
    CONSTRAINT fk_products_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_products_default_category_id_categories FOREIGN KEY(default_category_id) REFERENCES categories (id) ON DELETE SET NULL
);

CREATE TABLE transactions (
    user_id UUID NOT NULL,
    category_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    merchant TEXT,
    note TEXT,
    source TEXT DEFAULT 'manual' NOT NULL,
    receipt_id UUID,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_transactions PRIMARY KEY (id),
    CONSTRAINT ck_transactions_amount_non_negative CHECK (amount >= 0),
    CONSTRAINT ck_transactions_source CHECK (source in ('manual', 'receipt')),
    CONSTRAINT ck_transactions_manual_has_no_receipt CHECK (source = 'receipt' or receipt_id is null),
    CONSTRAINT ck_transactions_merchant_length CHECK (merchant is null or char_length(merchant) <= 120),
    CONSTRAINT ck_transactions_note_length CHECK (note is null or char_length(note) <= 500),
    CONSTRAINT fk_transactions_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_transactions_category_id_categories FOREIGN KEY(category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT uq_transactions_receipt_id UNIQUE (receipt_id),
    CONSTRAINT fk_transactions_receipt_id_receipts FOREIGN KEY(receipt_id) REFERENCES receipts (id) ON DELETE SET NULL
);

CREATE INDEX ix_transactions_user_id_category_id ON transactions (user_id, category_id);

CREATE INDEX ix_transactions_user_id_occurred_at ON transactions (user_id, occurred_at desc);

CREATE TABLE ingredient_inventory (
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    estimated_quantity NUMERIC(10, 3) NOT NULL,
    unit TEXT,
    estimated_expiry DATE,
    confirmed_by_user BOOLEAN DEFAULT false NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_ingredient_inventory PRIMARY KEY (id),
    CONSTRAINT uq_ingredient_inventory_user_id_product_id UNIQUE (user_id, product_id),
    CONSTRAINT ck_ingredient_inventory_quantity_non_negative CHECK (estimated_quantity >= 0),
    CONSTRAINT fk_ingredient_inventory_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ingredient_inventory_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE purchase_patterns (
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    avg_interval_days NUMERIC(8, 2),
    interval_stddev_days NUMERIC(8, 2),
    purchase_count INTEGER DEFAULT 0 NOT NULL,
    last_purchased_at TIMESTAMP WITH TIME ZONE,
    confidence_score NUMERIC(4, 3) DEFAULT 0 NOT NULL,
    data_tier TEXT DEFAULT 'insufficient' NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_purchase_patterns PRIMARY KEY (id),
    CONSTRAINT uq_purchase_patterns_user_id_product_id UNIQUE (user_id, product_id),
    CONSTRAINT ck_purchase_patterns_purchase_count CHECK (purchase_count >= 0),
    CONSTRAINT ck_purchase_patterns_confidence_range CHECK (confidence_score between 0 and 1),
    CONSTRAINT ck_purchase_patterns_data_tier CHECK (data_tier in ('sufficient', 'limited', 'insufficient')),
    CONSTRAINT fk_purchase_patterns_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_purchase_patterns_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE recipe_ingredients (
    recipe_id UUID NOT NULL,
    product_id UUID,
    name TEXT NOT NULL,
    quantity_required NUMERIC(10, 3) NOT NULL,
    unit TEXT,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_recipe_ingredients PRIMARY KEY (id),
    CONSTRAINT ck_recipe_ingredients_quantity_positive CHECK (quantity_required > 0),
    CONSTRAINT ck_recipe_ingredients_name_length CHECK (char_length(btrim(name)) between 1 and 120),
    CONSTRAINT fk_recipe_ingredients_recipe_id_recipes FOREIGN KEY(recipe_id) REFERENCES recipes (id) ON DELETE CASCADE,
    CONSTRAINT fk_recipe_ingredients_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL
);

CREATE INDEX ix_recipe_ingredients_recipe_id ON recipe_ingredients (recipe_id);

CREATE TABLE shopping_list_items (
    shopping_list_id UUID NOT NULL,
    name TEXT NOT NULL,
    quantity NUMERIC(10, 3) DEFAULT 1 NOT NULL,
    unit TEXT,
    est_price NUMERIC(12, 2),
    is_purchased BOOLEAN DEFAULT false NOT NULL,
    source TEXT DEFAULT 'manual' NOT NULL,
    product_id UUID,
    recipe_id UUID,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_shopping_list_items PRIMARY KEY (id),
    CONSTRAINT ck_shopping_list_items_source CHECK (source in ('manual', 'suggested', 'recipe')),
    CONSTRAINT ck_shopping_list_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_shopping_list_items_est_price_non_negative CHECK (est_price is null or est_price >= 0),
    CONSTRAINT ck_shopping_list_items_name_length CHECK (char_length(btrim(name)) between 1 and 120),
    CONSTRAINT fk_shopping_list_items_shopping_list_id_shopping_lists FOREIGN KEY(shopping_list_id) REFERENCES shopping_lists (id) ON DELETE CASCADE,
    CONSTRAINT fk_shopping_list_items_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL,
    CONSTRAINT fk_shopping_list_items_recipe_id_recipes FOREIGN KEY(recipe_id) REFERENCES recipes (id) ON DELETE SET NULL
);

CREATE INDEX ix_shopping_list_items_shopping_list_id ON shopping_list_items (shopping_list_id);

CREATE TABLE transaction_line_items (
    transaction_id UUID NOT NULL,
    product_id UUID,
    name TEXT NOT NULL,
    quantity NUMERIC(10, 3) DEFAULT 1 NOT NULL,
    unit TEXT,
    unit_price NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    tax NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_transaction_line_items PRIMARY KEY (id),
    CONSTRAINT ck_transaction_line_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_transaction_line_items_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT ck_transaction_line_items_discount_non_negative CHECK (discount >= 0),
    CONSTRAINT ck_transaction_line_items_tax_non_negative CHECK (tax >= 0),
    CONSTRAINT ck_transaction_line_items_line_total_non_negative CHECK (line_total >= 0),
    CONSTRAINT ck_transaction_line_items_name_length CHECK (char_length(btrim(name)) between 1 and 120),
    CONSTRAINT fk_transaction_line_items_transaction_id_transactions FOREIGN KEY(transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
    CONSTRAINT fk_transaction_line_items_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE SET NULL
);

CREATE INDEX ix_transaction_line_items_product_id ON transaction_line_items (product_id);

CREATE INDEX ix_transaction_line_items_transaction_id ON transaction_line_items (transaction_id);

CREATE TABLE replenishment_suggestions (
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    pattern_id UUID,
    predicted_date DATE NOT NULL,
    confidence_score NUMERIC(4, 3) NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_replenishment_suggestions PRIMARY KEY (id),
    CONSTRAINT ck_replenishment_suggestions_status CHECK (status in ('pending', 'added', 'dismissed', 'modified')),
    CONSTRAINT ck_replenishment_suggestions_confidence_range CHECK (confidence_score between 0 and 1),
    CONSTRAINT fk_replenishment_suggestions_user_id_users FOREIGN KEY(user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT fk_replenishment_suggestions_product_id_products FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT fk_replenishment_suggestions_pattern_id_purchase_patterns FOREIGN KEY(pattern_id) REFERENCES purchase_patterns (id) ON DELETE SET NULL
);

CREATE INDEX ix_replenishment_suggestions_user_id_status ON replenishment_suggestions (user_id, status);

CREATE UNIQUE INDEX uq_replenishment_suggestions_pending ON replenishment_suggestions (user_id, product_id) WHERE status = 'pending';
"""

NEW_USER_TRIGGER = """
-- Creates the profile and default preferences when Supabase Auth creates a user.
-- Consent: the sign-up form sends terms_accepted_at / data_consent_at in user metadata;
-- the server records its own sign-up time rather than trusting the client's clock.
create or replace function lunti_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  signed_up timestamptz := coalesce(new.created_at, now());
begin
  insert into public.profiles (user_id, full_name, terms_accepted_at, data_consent_at)
  values (
    new.id,
    left(nullif(btrim(meta ->> 'full_name'), ''), 100),
    case when meta ? 'terms_accepted_at' then signed_up end,
    case when meta ? 'data_consent_at' then signed_up end
  )
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end
$fn$;
revoke execute on function lunti_private.handle_new_user() from public;

-- Supabase Auth inserts users as supabase_auth_admin. Postgres doesn't check schema access
-- when a trigger fires, but grant it anyway: a failing trigger would block every sign-up.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema lunti_private to supabase_auth_admin;
  end if;
end $$;

-- Supabase's migration role has the TRIGGER privilege on auth.users but doesn't own it, so it
-- can create the trigger but not DROP/REPLACE it: create it only when missing.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function lunti_private.handle_new_user();
  end if;
end $$;

-- Backfill users who signed up before this migration (read-only on auth.users).
insert into public.profiles (user_id, full_name, terms_accepted_at, data_consent_at)
select
  u.id,
  left(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 100),
  case when u.raw_user_meta_data ? 'terms_accepted_at' then u.created_at end,
  case when u.raw_user_meta_data ? 'data_consent_at' then u.created_at end
from auth.users u
on conflict (user_id) do nothing;

insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;
"""

DEFAULT_CATEGORIES = """
-- Order and names from design/screens/TxnCategory.html.
insert into public.categories (name, is_default, icon, sort_order) values
  ('Groceries', true, 'groceries', 1),
  ('Dining out', true, 'dining', 2),
  ('Transport', true, 'transport', 3),
  ('Utilities', true, 'utilities', 4),
  ('Household', true, 'household', 5),
  ('Others', true, 'others', 6)
on conflict do nothing;
"""


def owned_by(table: str, column: str = "id", owner_column: str = "user_id") -> str:
    """SQL: the row `column` in `table` belongs to the caller."""
    return f"exists (select 1 from public.{table} o where o.{column} = {{ref}} and o.{owner_column} = {UID})"


def security_sql() -> str:
    statements: list[str] = []

    tables = ", ".join(f"public.{t}" for t in ALL_TABLES)
    # Close the Supabase Data API for these tables (default privileges grant them to anon
    # and authenticated). service_role keeps its default access for admin tooling.
    statements.append(f"revoke all on {tables} from public, anon, authenticated;")
    statements.append(
        "revoke all on public.alembic_version from public, anon, authenticated;"
        " alter table public.alembic_version enable row level security;"
    )
    for t in ALL_TABLES:
        statements.append(f"alter table public.{t} enable row level security;")
        statements.append(
            f"create trigger set_updated_at before update on public.{t}"
            " for each row execute function lunti_private.set_updated_at();"
        )

    category_visible = (
        "exists (select 1 from public.categories c where c.id = {col}"
        f" and (c.user_id is null or c.user_id = {UID}))"
    )
    product_owned = owned_by("products").replace("{ref}", "{col}")

    extra_check = {
        "transactions": " and "
        + category_visible.format(col="category_id")
        + " and (receipt_id is null or "
        + owned_by("receipts").format(ref="receipt_id")
        + ")",
        "budgets": " and (category_id is null or " + category_visible.format(col="category_id") + ")",
        "products": " and (default_category_id is null or "
        + category_visible.format(col="default_category_id")
        + ")",
        "purchase_patterns": " and " + product_owned.format(col="product_id"),
        "replenishment_suggestions": " and " + product_owned.format(col="product_id"),
        "ingredient_inventory": " and " + product_owned.format(col="product_id"),
    }

    for t in OWNED_TABLES:
        statements.append(f"grant select, insert, update, delete on public.{t} to {APP_ROLE};")
        statements.append(
            f"create policy {t}_owner on public.{t} for all to {APP_ROLE}"
            f" using (user_id = {UID})"
            f" with check (user_id = {UID}{extra_check.get(t, '')});"
        )

    # profiles: read own; create own (fallback if the trigger missed it); rename only.
    statements += [
        f"grant select on public.profiles to {APP_ROLE};",
        f"grant insert (user_id, full_name, terms_accepted_at, data_consent_at)"
        f" on public.profiles to {APP_ROLE};",
        f"grant update (full_name) on public.profiles to {APP_ROLE};",
        f"create policy profiles_select on public.profiles for select to {APP_ROLE}"
        f" using (user_id = {UID});",
        f"create policy profiles_insert on public.profiles for insert to {APP_ROLE}"
        f" with check (user_id = {UID} and role = 'user');",
        f"create policy profiles_update on public.profiles for update to {APP_ROLE}"
        f" using (user_id = {UID}) with check (user_id = {UID});",
    ]

    # user_preferences: read, create, update own.
    statements += [
        f"grant select, insert, update on public.user_preferences to {APP_ROLE};",
        f"create policy user_preferences_owner on public.user_preferences for all to {APP_ROLE}"
        f" using (user_id = {UID}) with check (user_id = {UID});",
    ]

    # categories: everyone sees defaults; users manage only their own (never defaults).
    statements += [
        f"grant select, delete on public.categories to {APP_ROLE};",
        f"grant insert (user_id, name, icon) on public.categories to {APP_ROLE};",
        f"grant update (name, icon) on public.categories to {APP_ROLE};",
        f"create policy categories_select on public.categories for select to {APP_ROLE}"
        f" using (user_id is null or user_id = {UID});",
        f"create policy categories_insert on public.categories for insert to {APP_ROLE}"
        f" with check (user_id = {UID} and not is_default);",
        f"create policy categories_update on public.categories for update to {APP_ROLE}"
        f" using (user_id = {UID}) with check (user_id = {UID});",
        f"create policy categories_delete on public.categories for delete to {APP_ROLE}"
        f" using (user_id = {UID});",
    ]

    # Child tables: ownership comes from the parent row.
    line_item_parent = owned_by("transactions").format(ref="transaction_id")
    list_item_parent = owned_by("shopping_lists").format(ref="shopping_list_id")
    statements += [
        f"grant select, insert, update, delete on public.transaction_line_items to {APP_ROLE};",
        f"create policy transaction_line_items_owner on public.transaction_line_items"
        f" for all to {APP_ROLE} using ({line_item_parent})"
        f" with check ({line_item_parent} and (product_id is null or "
        + product_owned.format(col="product_id")
        + "));",
        f"grant select, insert, update, delete on public.shopping_list_items to {APP_ROLE};",
        f"create policy shopping_list_items_owner on public.shopping_list_items"
        f" for all to {APP_ROLE} using ({list_item_parent})"
        f" with check ({list_item_parent} and (product_id is null or "
        + product_owned.format(col="product_id")
        + "));",
    ]

    # Shared recipe catalog: read-only for the app; admins seed it (AGENTS.md §7.5).
    for t in ("recipes", "recipe_ingredients"):
        statements += [
            f"grant select on public.{t} to {APP_ROLE};",
            f"create policy {t}_read on public.{t} for select to {APP_ROLE} using (true);",
        ]

    return "\n".join(statements)


def upgrade() -> None:
    op.execute(PRELUDE)
    op.execute(TABLES_DDL)
    op.execute(security_sql())
    op.execute(NEW_USER_TRIGGER)
    op.execute(DEFAULT_CATEGORIES)


def downgrade() -> None:
    # Development only: drops every Lunti table and its data. auth.users is untouched.
    # Dropping our trigger function with CASCADE removes the auth.users trigger without
    # needing to own auth.users (DROP TRIGGER would).
    op.execute("drop function if exists lunti_private.handle_new_user() cascade;")
    for t in [
        "shopping_list_items",
        "replenishment_suggestions",
        "purchase_patterns",
        "ingredient_inventory",
        "transaction_line_items",
        "transactions",
        "receipts",
        "budgets",
        "recipe_ingredients",
        "products",
        "recipes",
        "shopping_lists",
        "categories",
        "insights",
        "notifications",
        "device_tokens",
        "feedback",
        "user_preferences",
        "profiles",
    ]:
        op.execute(f"drop table if exists public.{t};")
    op.execute(
        """
        drop function if exists lunti_private.set_updated_at();
        drop function if exists lunti_private.current_user_id();
        revoke all on schema public from lunti_app_user;
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
            revoke usage on schema lunti_private from supabase_auth_admin;
          end if;
        end $$;
        drop schema if exists lunti_private;
        -- Roles are shared by every database on the server: keep it if another database
        -- still uses it (it can't log in and has no privileges left here).
        do $$
        begin
          drop role if exists lunti_app_user;
        exception when dependent_objects_still_exist then
          raise notice 'lunti_app_user is still used by another database; kept';
        end $$;
        """
    )
