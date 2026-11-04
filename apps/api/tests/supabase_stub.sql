-- Minimal stand-in for the parts of a Supabase database that Lunti's migrations rely on,
-- so tests can run on plain PostgreSQL (CI service container or a local server).
-- Run as a superuser in a THROWAWAY database. Never run against Supabase.
--
-- Mirrors Supabase where it matters for security tests:
--   * migrations run as a non-superuser with CREATEROLE (like `postgres` on Supabase);
--   * new tables in `public` are granted to anon/authenticated by default privileges,
--     so the migration's REVOKEs are actually exercised;
--   * users are inserted by `supabase_auth_admin`, like Supabase Auth does.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);

grant usage on schema auth to supabase_auth_admin, lunti_migrator;
grant select, insert, update, delete on auth.users to supabase_auth_admin;
grant select, references, trigger on auth.users to lunti_migrator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role lunti_migrator in schema public
  grant all on tables to anon, authenticated, service_role;
