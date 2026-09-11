-- TEST-ONLY emulation of the Supabase platform surface.
--
-- This file is NEVER applied to a real Supabase project: there, `auth` and
-- `storage` are provided by the platform. It exists so the migrations and every
-- row-level-security policy can be executed and asserted against a plain
-- PostgreSQL 16 instance, locally and in CI, without a paid project or any
-- credentials.
--
-- What it faithfully reproduces:
--   * auth.uid() reading the `request.jwt.claims` GUC, which is exactly how
--     Supabase resolves the current user;
--   * the `anon`, `authenticated` and `service_role` database roles;
--   * auth.users, storage.buckets, storage.objects and storage.foldername().
--
-- What it does NOT prove: Supabase's own API gateway, GoTrue signup/OTP
-- behaviour, storage upload handling, or realtime. Those need a real project.

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

-- A Supabase project ships with these default privileges, so EVERY table and
-- function created in `public` arrives with full access already granted to the
-- client roles. Reproducing that is not decoration: without it this database
-- would be stricter than the real platform, and the suite would keep proving a
-- least-privilege property the hosted project does not actually have. They are
-- the reason 202609110003_client_role_privileges.sql exists.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Supabase resolves the caller from the verified JWT claims it sets per
-- request. Reproducing that mechanism means a test can act as a specific user
-- simply by setting the same GUC, and RLS behaves as it would in production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'anon'
  )
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Splits an object path into its segments, as Supabase does.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
