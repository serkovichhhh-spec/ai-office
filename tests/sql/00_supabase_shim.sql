-- Local stand-in for the parts of Supabase that the office migration relies on.
-- Used ONLY for tests on a plain Postgres 16. Never applied to a real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Minimal copy of the live cmo objects the office layer reads (shape only).
create schema if not exists cmo;
create table if not exists cmo.members (
  email text primary key, name text unique, role text, active boolean default true
);
create table if not exists cmo.agent_runs (
  id bigint generated always as identity primary key,
  agent text not null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text default 'running',
  summary text,
  details jsonb default '{}'::jsonb
);

-- Storage bucket catalogue only. Object bytes are exercised through an injected test store.
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
