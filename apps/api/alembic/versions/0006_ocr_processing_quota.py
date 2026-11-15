"""Phase 8D.4a: OCR outside database transactions, daily OCR limits, raw-text retention.

Revision ID: 0006_ocr_processing_quota
Revises: 0005_recipe_details
Create Date: 2026-11-15

Additive only: three nullable columns on receipts, one new table and two functions. Existing
rows are not rewritten (the new columns start NULL, which every new check accepts).

- receipts.ocr_attempt_id / ocr_lease_expires_at: the upload request that is currently
  reading a `processing` receipt, and until when it may (a lease). The upload commits the row
  first, then calls OCR without holding a database connection, and writes the result only if
  it still holds the lease. A retry after a crash takes over once the lease has expired.
- receipts.ocr_text_purged_at: when the recognised text of a confirmed receipt was removed
  under the raw-text retention policy (the transaction and its items are kept).
- ocr_usage_daily: per-day counters for the OCR limits (per user, and app-wide for billed
  OCR). Not granted to the app role at all; the API reaches it only through
  lunti_private.reserve_ocr_quota / record_ocr_outcome, which act on the caller's own row
  and the app-wide row. RLS is enabled with no policies, like a closed table.

The previous API release keeps working on this schema: it never reads the new columns, its
receipts never use a lease, and it does not know the new table.

Rollback: `alembic downgrade 0005_recipe_details` drops the functions, the table and the
three columns (usage counters and purge timestamps only; no receipt or transaction rows).
Only the previous API release may run after that.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006_ocr_processing_quota"
down_revision: str | None = "0005_recipe_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = """
alter table public.receipts
  add column ocr_attempt_id uuid,
  add column ocr_lease_expires_at timestamptz,
  add column ocr_text_purged_at timestamptz,
  add constraint ck_receipts_ocr_lease
    check ((ocr_attempt_id is null) = (ocr_lease_expires_at is null)),
  add constraint ck_receipts_ocr_lease_status
    check (ocr_attempt_id is null or ocr_status = 'processing'),
  add constraint ck_receipts_ocr_text_purged
    check (ocr_text_purged_at is null or (ocr_status = 'confirmed' and ocr_raw_text is null));

create table public.ocr_usage_daily (
  id uuid not null default gen_random_uuid(),
  usage_date date not null,
  counter text not null,
  user_id uuid,
  used integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pk_ocr_usage_daily primary key (id),
  constraint fk_ocr_usage_daily_user_id_users foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint ck_ocr_usage_daily_counter check (counter in ('user_scans', 'external_ocr')),
  constraint ck_ocr_usage_daily_owner check ((counter = 'user_scans') = (user_id is not null)),
  constraint ck_ocr_usage_daily_counts check (
    used >= 0 and succeeded >= 0 and failed >= 0 and succeeded + failed <= used
  )
);
create unique index uq_ocr_usage_daily_usage_date_counter
  on public.ocr_usage_daily (usage_date, counter) where user_id is null;
create unique index uq_ocr_usage_daily_usage_date_counter_user_id
  on public.ocr_usage_daily (usage_date, counter, user_id) where user_id is not null;
create index ix_ocr_usage_daily_user_id on public.ocr_usage_daily (user_id);

revoke all on public.ocr_usage_daily from public, anon, authenticated;
alter table public.ocr_usage_daily enable row level security;
create trigger set_updated_at before update on public.ocr_usage_daily
  for each row execute function lunti_private.set_updated_at();

-- One OCR attempt for the caller: 'user_limit' / 'global_limit' when refused (nothing
-- changes), NULL when reserved. Both counters move together or not at all; the row locks
-- taken by the upserts (always user row first, then the app-wide row) queue concurrent
-- callers, so a limit is never overshot.
create function lunti_private.reserve_ocr_quota(
  p_day date, p_user_limit integer, p_global_limit integer, p_external boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := lunti_private.current_user_id();
  v_used integer;
begin
  if v_user is null then
    raise exception 'reserve_ocr_quota needs a signed-in caller' using errcode = '42501';
  end if;
  if p_day is null or p_user_limit is null or p_global_limit is null or p_external is null then
    raise exception 'reserve_ocr_quota arguments must not be null' using errcode = '22004';
  end if;
  if p_user_limit < 1 then
    return 'user_limit';
  end if;
  begin
    insert into public.ocr_usage_daily as u (usage_date, counter, user_id, used)
      values (p_day, 'user_scans', v_user, 1)
      on conflict (usage_date, counter, user_id) where user_id is not null
      do update set used = u.used + 1 where u.used < p_user_limit
      returning u.used into v_used;
    if v_used is null then
      return 'user_limit';
    end if;
    if p_external then
      v_used := null;
      if p_global_limit >= 1 then
        insert into public.ocr_usage_daily as u (usage_date, counter, user_id, used)
          values (p_day, 'external_ocr', null, 1)
          on conflict (usage_date, counter) where user_id is null
          do update set used = u.used + 1 where u.used < p_global_limit
          returning u.used into v_used;
      end if;
      if v_used is null then
        -- Leaves the block, which undoes the user increment above.
        raise exception 'lunti:global_limit' using errcode = 'P0001';
      end if;
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'lunti:global_limit' then
        return 'global_limit';
      end if;
      raise;
  end;
  return null;
end
$fn$;
revoke execute on function lunti_private.reserve_ocr_quota(date, integer, integer, boolean)
  from public;
grant execute on function lunti_private.reserve_ocr_quota(date, integer, integer, boolean)
  to lunti_app_user;

-- Metrics: how a reserved external OCR request ended. Never changes what is allowed.
create function lunti_private.record_ocr_outcome(p_day date, p_failed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if lunti_private.current_user_id() is null then
    raise exception 'record_ocr_outcome needs a signed-in caller' using errcode = '42501';
  end if;
  update public.ocr_usage_daily
     set succeeded = succeeded + (case when p_failed then 0 else 1 end),
         failed = failed + (case when p_failed then 1 else 0 end)
   where usage_date = p_day and counter = 'external_ocr' and user_id is null
     and succeeded + failed < used;
end
$fn$;
revoke execute on function lunti_private.record_ocr_outcome(date, boolean) from public;
grant execute on function lunti_private.record_ocr_outcome(date, boolean) to lunti_app_user;
"""

DOWNGRADE = """
drop function if exists lunti_private.record_ocr_outcome(date, boolean);
drop function if exists lunti_private.reserve_ocr_quota(date, integer, integer, boolean);
drop table if exists public.ocr_usage_daily;
alter table public.receipts
  drop constraint if exists ck_receipts_ocr_text_purged,
  drop constraint if exists ck_receipts_ocr_lease_status,
  drop constraint if exists ck_receipts_ocr_lease,
  drop column if exists ocr_text_purged_at,
  drop column if exists ocr_lease_expires_at,
  drop column if exists ocr_attempt_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
