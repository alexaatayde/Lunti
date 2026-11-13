"""Step 6: replenishment cycles, notification de-duplication, device-token claiming.

Revision ID: 0002_replenishment_notifications
Revises: 0001_initial_schema
Create Date: 2026-11-13

- replenishment_suggestions.anchor_date: the purchase (or "bought elsewhere") day a suggestion's
  cycle starts from. One answered suggestion per product and cycle (AGENTS.md §7.4).
- replenishment_suggestions.quantity: the quantity the user chose with "Modify".
- notifications.dedupe_key: unique per user, so a scheduled job that runs twice (or on two
  workers) inserts each reminder once.
- lunti_private.claim_device_token(): a phone that signs in to another account moves its push
  token to that account. RLS hides the previous owner's row from the app role, so this runs
  as SECURITY DEFINER and only ever writes the caller's own row.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_replenishment_notifications"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = """
alter table public.replenishment_suggestions
  add column anchor_date date,
  add column quantity numeric(10, 3),
  add constraint ck_replenishment_suggestions_quantity_positive
    check (quantity is null or quantity > 0);

alter table public.notifications add column dedupe_key text;
create unique index uq_notifications_user_id_dedupe_key
  on public.notifications (user_id, dedupe_key);

create or replace function lunti_private.claim_device_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  caller uuid := lunti_private.current_user_id();
begin
  if caller is null then
    raise exception 'no caller' using errcode = '42501';
  end if;
  delete from public.device_tokens where fcm_token = p_token and user_id <> caller;
  insert into public.device_tokens (user_id, fcm_token, platform)
  values (caller, p_token, p_platform)
  on conflict (fcm_token) do update set platform = excluded.platform;
end
$fn$;
revoke execute on function lunti_private.claim_device_token(text, text) from public;
grant execute on function lunti_private.claim_device_token(text, text) to lunti_app_user;
"""

DOWNGRADE = """
drop function if exists lunti_private.claim_device_token(text, text);
drop index if exists public.uq_notifications_user_id_dedupe_key;
alter table public.notifications drop column if exists dedupe_key;
alter table public.replenishment_suggestions
  drop constraint if exists ck_replenishment_suggestions_quantity_positive,
  drop column if exists quantity,
  drop column if exists anchor_date;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
