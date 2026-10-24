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

-- CMO Space documents + the agent write API (copy of the live cmo.agent_upsert, test-only).
create table if not exists cmo.space_documents (
  key text primary key, payload jsonb not null default '[]'::jsonb, revision int not null default 1,
  source text, updated_at timestamptz default now()
);
create table if not exists cmo.space_document_events (
  id bigint generated always as identity primary key, document_key text, actor_id uuid, revision int, payload jsonb,
  created_at timestamptz default now()
);
create or replace function cmo.agent_upsert(p_key text, p_records jsonb, p_agent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d cmo.space_documents; rows jsonb; r jsonb; i int; idx int; added int:=0; updated int:=0; skipped int:=0;
  drafts text[] := array['Чернетка','Немає даних','Новий','Потребує рішення','Ідея','Backlog','Очікує'];
begin
  if p_key not in ('reports','attribution','decisions','insights','content','experiments','execution','report_requests') then
    raise exception 'Агентам недоступний розділ %', p_key; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'Потрібен масив записів'; end if;
  select * into d from cmo.space_documents where key=p_key for update;
  rows := coalesce(d.payload,'[]'::jsonb);
  for r in select value from jsonb_array_elements(p_records) loop
    if coalesce(r->>'id','')='' then raise exception 'Запис без id'; end if;
    r := r || jsonb_build_object('agent', p_agent, 'agentUpdatedAt', now());
    idx := null;
    for i in 0..jsonb_array_length(rows)-1 loop
      if rows->i->>'id' = r->>'id' then idx := i; exit; end if;
    end loop;
    if idx is null then rows := rows || jsonb_build_array(r); added := added+1;
    elsif rows->idx ? 'agent' and coalesce(rows->idx->>'status', rows->idx->>'quality', 'Чернетка') = any(drafts) then
      rows := jsonb_set(rows, array[idx::text], r); updated := updated+1;
    else skipped := skipped+1; end if;
  end loop;
  if added+updated > 0 then
    if d.key is not null then
      update cmo.space_documents set payload=rows, revision=revision+1, updated_at=now() where key=p_key returning * into d;
    else
      insert into cmo.space_documents(key,payload,source) values(p_key,rows,'claude-agents') returning * into d;
    end if;
    insert into cmo.space_document_events(document_key, actor_id, revision, payload)
      values (p_key, '00000000-0000-4000-a000-00000000c1a0', d.revision, rows);
  end if;
  return jsonb_build_object('added',added,'updated',updated,'skipped_human_owned',skipped,'revision',d.revision);
end $$;
