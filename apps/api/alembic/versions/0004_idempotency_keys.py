"""Phase 8B: idempotency keys for manual transaction creation.

Revision ID: 0004_idempotency_keys
Revises: 0003_recipe_catalog
Create Date: 2026-11-14

Additive only: one new table, no change to existing tables or rows.

- idempotency_keys: one row per (user, scope, client key). The unique index makes concurrent
  requests with the same key wait for the first one, then see its committed row, so a retry
  after a timeout never records the expense twice.
- transaction_id is SET NULL when the transaction is deleted: a late retry then gets a 409
  instead of re-creating a deleted expense.
- Row Level Security like every other user table: the app role sees only the caller's keys,
  and may only link a key to the caller's own transaction.

Rollback: `alembic downgrade 0003_recipe_catalog` drops the table (keys only; transactions are
untouched). The API then has to be the previous release, which never reads the table.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004_idempotency_keys"
down_revision: str | None = "0003_recipe_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "(select lunti_private.current_user_id())"

UPGRADE = f"""
create table public.idempotency_keys (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  key text not null,
  request_hash text not null,
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pk_idempotency_keys primary key (id),
  constraint fk_idempotency_keys_user_id_users foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint fk_idempotency_keys_transaction_id_transactions foreign key (transaction_id)
    references public.transactions (id) on delete set null,
  constraint ck_idempotency_keys_scope check (scope in ('transactions.create')),
  constraint ck_idempotency_keys_key_format check (key ~ '^[A-Za-z0-9_-]{{8,128}}$'),
  constraint ck_idempotency_keys_request_hash_format check (request_hash ~ '^[0-9a-f]{{64}}$')
);
create unique index uq_idempotency_keys_user_id_scope_key
  on public.idempotency_keys (user_id, scope, key);
create index ix_idempotency_keys_created_at on public.idempotency_keys (created_at);
create index ix_idempotency_keys_transaction_id on public.idempotency_keys (transaction_id);

revoke all on public.idempotency_keys from public, anon, authenticated;
alter table public.idempotency_keys enable row level security;
create trigger set_updated_at before update on public.idempotency_keys
  for each row execute function lunti_private.set_updated_at();

grant select, insert, update, delete on public.idempotency_keys to lunti_app_user;
create policy idempotency_keys_owner on public.idempotency_keys for all to lunti_app_user
  using (user_id = {UID})
  with check (
    user_id = {UID}
    and (transaction_id is null or exists (
      select 1 from public.transactions o where o.id = transaction_id and o.user_id = {UID}
    ))
  );
"""

DOWNGRADE = "drop table if exists public.idempotency_keys;"


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
