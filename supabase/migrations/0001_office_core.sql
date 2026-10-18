-- AI Office — core schema (phase 1)
-- Additive only: creates schema `office` and role `office_app`.
-- Does NOT alter, drop or grant anything in schemas cmo, pvlinks or public.

create schema if not exists office;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'office_app') then
    create role office_app nologin noinherit;
  end if;
end $$;
-- office_app may act as `authenticated` (SET LOCAL ROLE) so that RLS applies to user requests.
grant authenticated to office_app;

revoke all on schema office from public;
grant usage on schema office to authenticated, office_app;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table office.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (length(name) between 1 and 80),
  status text not null default 'active' check (status in ('active','paused','archived')),
  cmo_workspace_key text,
  run_budget_usd numeric(10,4) not null default 1.00 check (run_budget_usd >= 0),
  daily_budget_usd numeric(10,4) not null default 10.00 check (daily_budget_usd >= 0),
  max_steps_per_run int not null default 20 check (max_steps_per_run between 1 and 100),
  created_at timestamptz not null default now()
);

create table office.workspace_members (
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','approver','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table office.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  role_key text not null check (role_key in
    ('orchestrator','strategist','research_analyst','performance_analyst','creative_director','copywriter','reviewer')),
  display_name text not null,
  model_tier text not null default 'balanced' check (model_tier in ('fast','balanced','strong')),
  system_prompt text not null default '',
  provenance text not null default 'placeholder',
  allowed_tools text[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (workspace_id, role_key)
);

create table office.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  kind text not null default 'fact' check (kind in ('brand','fact','audience','offer','decision','other')),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) <= 20000),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  source_url text,
  freshness_date date,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table office.briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  objective text not null check (length(objective) between 1 and 4000),
  audience text not null default '' check (length(audience) <= 2000),
  channel text not null default '' check (length(channel) <= 200),
  deliverable_count int not null default 3 check (deliverable_count between 1 and 10),
  deliverables jsonb not null default '[]'::jsonb check (jsonb_typeof(deliverables) = 'array'),
  "references" jsonb not null default '[]'::jsonb check (jsonb_typeof("references") = 'array'),
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  deadline date,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  playbook_key text not null default 'reels_concepts' check (playbook_key ~ '^[a-z_]{3,40}$'),
  status text not null default 'draft' check (status in ('draft','active','done','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table office.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  brief_id uuid not null references office.briefs(id) on delete cascade,
  playbook_key text not null,
  status text not null default 'queued' check (status in
    ('queued','running','needs_input','needs_approval','approved','handoff_queued','failed','cancelled')),
  provider text,
  revision int not null default 1,
  budget_usd numeric(10,4) not null,
  cost_usd numeric(12,6) not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  steps_executed int not null default 0,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  error_code text,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table office.steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references office.runs(id) on delete cascade,
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  step_key text not null check (step_key ~ '^[a-z_]{2,40}$'),
  agent_role text not null,
  cycle int not null default 1,
  depends_on text[] not null default '{}',
  status text not null default 'ready' check (status in ('ready','running','succeeded','failed','cancelled')),
  attempt int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  locked_by text,
  locked_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  provider text,
  model text,
  cost_usd numeric(12,6) not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, step_key, cycle)
);
create index steps_ready_idx on office.steps (next_attempt_at) where status = 'ready';
create index steps_running_idx on office.steps (locked_until) where status = 'running';

create table office.events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  run_id uuid references office.runs(id) on delete cascade,
  step_id uuid references office.steps(id) on delete set null,
  actor_type text not null check (actor_type in ('user','agent','system')),
  actor_id uuid,
  agent_role text,
  kind text not null,
  activity text check (activity in
    ('idle','planning','researching','drafting','reviewing','collaborating','waiting_approval','blocked','delivering')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_ws_idx on office.events (workspace_id, id desc);
create index events_run_idx on office.events (run_id, id);

create table office.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  run_id uuid not null references office.runs(id) on delete cascade,
  step_id uuid references office.steps(id) on delete set null,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  title text not null,
  version int not null,
  content jsonb not null,
  content_hash text not null,
  provider text not null,
  model text,
  created_at timestamptz not null default now(),
  unique (run_id, kind, version)
);

create table office.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  run_id uuid not null references office.runs(id) on delete cascade,
  artifact_id uuid not null references office.artifacts(id),
  artifact_hash text not null,
  decision text not null check (decision in ('approved','rejected','revision_requested')),
  rationale text not null default '' check (length(rationale) <= 4000),
  approver_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table office.handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  run_id uuid not null references office.runs(id) on delete cascade,
  approval_id uuid not null unique references office.approvals(id),
  schema_version text not null default 'handoff.v1',
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in
    ('queued','claimed','in_production','review','done','failed','cancelled')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
create function office.member_role(p_workspace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from office.workspace_members m
  join office.workspaces w on w.id = m.workspace_id and w.status <> 'archived'
  where m.workspace_id = p_workspace and m.user_id = (select auth.uid())
$$;

create function office.is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select office.member_role(p_workspace) is not null
$$;

create function office.has_role(p_workspace uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(office.member_role(p_workspace) = any(p_roles), false)
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create function office.guard_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'office.%: records are immutable', tg_table_name using errcode = '42501';
end $$;

create trigger artifacts_immutable before update or delete on office.artifacts
  for each row execute function office.guard_immutable();
create trigger approvals_immutable before update or delete on office.approvals
  for each row execute function office.guard_immutable();
create trigger events_immutable before update or delete on office.events
  for each row execute function office.guard_immutable();

create function office.guard_run_transition() returns trigger
language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;
  ok := (old.status, new.status) in (
    ('queued','running'), ('queued','cancelled'), ('queued','failed'),
    ('running','needs_approval'), ('running','needs_input'), ('running','failed'), ('running','cancelled'),
    ('needs_input','running'), ('needs_input','cancelled'),
    ('needs_approval','approved'), ('needs_approval','running'), ('needs_approval','cancelled'),
    ('approved','handoff_queued')
  );
  if not ok then
    raise exception 'office.runs: transition % -> % is not allowed', old.status, new.status using errcode = '23514';
  end if;
  new.updated_at := now();
  if new.status = 'running' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('needs_approval','approved','handoff_queued','failed','cancelled') then new.finished_at := now(); end if;
  return new;
end $$;

create trigger runs_transition before update on office.runs
  for each row execute function office.guard_run_transition();

-- Identity columns of runs/steps never change once created.
create function office.guard_run_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id <> old.workspace_id or new.brief_id <> old.brief_id
     or new.idempotency_key <> old.idempotency_key then
    raise exception 'office.runs: identity columns are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger runs_identity before update on office.runs
  for each row execute function office.guard_run_identity();

-- ---------------------------------------------------------------------------
-- Row level security: members read their workspace; writes go through functions
-- ---------------------------------------------------------------------------
alter table office.workspaces enable row level security;
alter table office.workspace_members enable row level security;
alter table office.agents enable row level security;
alter table office.knowledge_docs enable row level security;
alter table office.briefs enable row level security;
alter table office.runs enable row level security;
alter table office.steps enable row level security;
alter table office.events enable row level security;
alter table office.artifacts enable row level security;
alter table office.approvals enable row level security;
alter table office.handoffs enable row level security;

create policy ws_read on office.workspaces for select to authenticated using (office.is_member(id));
create policy members_read on office.workspace_members for select to authenticated using (office.is_member(workspace_id));
create policy agents_read on office.agents for select to authenticated using (office.is_member(workspace_id));
create policy agents_owner_update on office.agents for update to authenticated
  using (office.has_role(workspace_id, array['owner'])) with check (office.has_role(workspace_id, array['owner']));
create policy knowledge_read on office.knowledge_docs for select to authenticated using (office.is_member(workspace_id));
create policy knowledge_write on office.knowledge_docs for insert to authenticated
  with check (office.has_role(workspace_id, array['owner','editor']));
create policy knowledge_update on office.knowledge_docs for update to authenticated
  using (office.has_role(workspace_id, array['owner','editor']))
  with check (office.has_role(workspace_id, array['owner','editor']));
create policy briefs_read on office.briefs for select to authenticated using (office.is_member(workspace_id));
create policy runs_read on office.runs for select to authenticated using (office.is_member(workspace_id));
create policy steps_read on office.steps for select to authenticated using (office.is_member(workspace_id));
create policy events_read on office.events for select to authenticated using (office.is_member(workspace_id));
create policy artifacts_read on office.artifacts for select to authenticated using (office.is_member(workspace_id));
create policy approvals_read on office.approvals for select to authenticated using (office.is_member(workspace_id));
create policy handoffs_read on office.handoffs for select to authenticated using (office.is_member(workspace_id));

-- Start from zero (defensive against any platform default privileges), then grant the minimum.
revoke all on all tables in schema office from public, anon, authenticated, service_role, office_app;
revoke all on all sequences in schema office from public, anon, authenticated, service_role, office_app;
grant select on all tables in schema office to authenticated;
grant insert, update (kind, title, body, status, source_url, freshness_date, updated_at) on office.knowledge_docs to authenticated;
grant update (display_name, model_tier, system_prompt, allowed_tools, enabled, updated_at) on office.agents to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create function office.activity_for_role(p_role text) returns text
language sql immutable set search_path = '' as $$
  select case p_role
    when 'orchestrator' then 'planning'
    when 'strategist' then 'researching'
    when 'research_analyst' then 'researching'
    when 'performance_analyst' then 'researching'
    when 'creative_director' then 'drafting'
    when 'copywriter' then 'drafting'
    when 'reviewer' then 'reviewing'
    else 'planning' end
$$;

create function office.log_event(
  p_workspace uuid, p_run uuid, p_step uuid, p_actor_type text, p_actor uuid,
  p_role text, p_kind text, p_activity text, p_payload jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into office.events (workspace_id, run_id, step_id, actor_type, actor_id, agent_role, kind, activity, payload)
  values (p_workspace, p_run, p_step, p_actor_type, p_actor, p_role, p_kind, p_activity, coalesce(p_payload, '{}'::jsonb))
$$;

create function office.json_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- User-facing commands (validated server-side)
-- ---------------------------------------------------------------------------
create function office.create_brief(p_workspace uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not office.has_role(p_workspace, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into office.briefs (workspace_id, title, objective, audience, channel, deliverable_count,
    deliverables, "references", acceptance_criteria, deadline, priority, playbook_key, created_by)
  values (p_workspace,
    p->>'title', p->>'objective', coalesce(p->>'audience',''), coalesce(p->>'channel',''),
    coalesce((p->>'deliverable_count')::int, 3),
    coalesce(p->'deliverables','[]'::jsonb), coalesce(p->'references','[]'::jsonb),
    coalesce(p->'acceptance_criteria','[]'::jsonb),
    nullif(p->>'deadline','')::date, coalesce(p->>'priority','medium'),
    coalesce(p->>'playbook_key','reels_concepts'), (select auth.uid()))
  returning id into v_id;
  perform office.log_event(p_workspace, null, null, 'user', (select auth.uid()), null,
    'brief.created', null, jsonb_build_object('brief_id', v_id, 'title', p->>'title'));
  return v_id;
end $$;

create function office.submit_brief(p_brief uuid, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b office.briefs; w office.workspaces; v_run uuid; existing office.runs;
begin
  select * into existing from office.runs where idempotency_key = p_idempotency_key;
  if found then
    if existing.brief_id <> p_brief or not office.is_member(existing.workspace_id) then
      raise exception 'idempotency key reused for another brief' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  select * into b from office.briefs where id = p_brief for update;
  if not found or not office.has_role(b.workspace_id, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into w from office.workspaces where id = b.workspace_id;
  if w.status <> 'active' then raise exception 'workspace is not active' using errcode = '55000'; end if;
  if b.status not in ('draft','active') then raise exception 'brief is %', b.status using errcode = '55000'; end if;
  if exists (select 1 from office.runs r where r.brief_id = b.id
             and r.status in ('queued','running','needs_input','needs_approval')) then
    raise exception 'brief already has an active run' using errcode = '55000';
  end if;

  update office.briefs set status = 'active', updated_at = now() where id = b.id;
  insert into office.runs (workspace_id, brief_id, playbook_key, budget_usd, idempotency_key, created_by)
  values (b.workspace_id, b.id, b.playbook_key, w.run_budget_usd, p_idempotency_key, (select auth.uid()))
  returning id into v_run;
  insert into office.steps (run_id, workspace_id, step_key, agent_role, cycle)
  values (v_run, b.workspace_id, 'intake', 'orchestrator', 1);
  perform office.log_event(b.workspace_id, v_run, null, 'user', (select auth.uid()), null,
    'run.created', null, jsonb_build_object('brief_id', b.id, 'playbook', b.playbook_key));
  return v_run;
end $$;

create function office.cancel_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r office.runs;
begin
  select * into r from office.runs where id = p_run for update;
  if not found or not office.has_role(r.workspace_id, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update office.runs set status = 'cancelled', error_code = 'cancelled_by_user' where id = p_run;
  update office.steps set status = 'cancelled', locked_by = null, locked_until = null
    where run_id = p_run and status in ('ready','running');
  perform office.log_event(r.workspace_id, p_run, null, 'user', (select auth.uid()), null, 'run.cancelled', null, '{}');
end $$;

create function office.decide(p_artifact uuid, p_decision text, p_rationale text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a office.artifacts; r office.runs; b office.briefs; v_approval uuid; v_handoff uuid;
        v_latest int; v_uid uuid := (select auth.uid()); v_next_cycle int;
begin
  if p_decision not in ('approved','rejected','revision_requested') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  select * into a from office.artifacts where id = p_artifact;
  if not found or not office.has_role(a.workspace_id, array['owner','approver']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from office.runs where id = a.run_id for update;
  if r.status <> 'needs_approval' then
    raise exception 'run is not waiting for approval (status: %)', r.status using errcode = '55000';
  end if;
  if a.kind <> 'deliverable' then
    raise exception 'only deliverables can be approved' using errcode = '55000';
  end if;
  select max(version) into v_latest from office.artifacts where run_id = a.run_id and kind = 'deliverable';
  if a.version <> v_latest then
    raise exception 'artifact is not the latest version' using errcode = '55000';
  end if;
  if p_decision = 'revision_requested' and length(coalesce(trim(p_rationale), '')) = 0 then
    raise exception 'revision request needs a comment' using errcode = '22023';
  end if;

  insert into office.approvals (workspace_id, run_id, artifact_id, artifact_hash, decision, rationale, approver_id)
  values (a.workspace_id, a.run_id, a.id, a.content_hash, p_decision, coalesce(p_rationale, ''), v_uid)
  returning id into v_approval;
  perform office.log_event(a.workspace_id, a.run_id, null, 'user', v_uid, null, 'approval.recorded', null,
    jsonb_build_object('approval_id', v_approval, 'decision', p_decision, 'artifact_id', a.id, 'version', a.version));

  if p_decision = 'approved' then
    select * into b from office.briefs where id = r.brief_id;
    update office.runs set status = 'approved' where id = r.id;
    insert into office.handoffs (workspace_id, run_id, approval_id, payload, idempotency_key)
    values (a.workspace_id, a.run_id, v_approval,
      jsonb_build_object(
        'schema_version', 'handoff.v1',
        'workspace_id', a.workspace_id,
        'brief', jsonb_build_object('id', b.id, 'title', b.title, 'objective', b.objective,
                                     'channel', b.channel, 'deadline', b.deadline,
                                     'acceptance_criteria', b.acceptance_criteria),
        'approved_artifact', jsonb_build_object('id', a.id, 'version', a.version, 'hash', a.content_hash,
                                                'provider', a.provider, 'content', a.content),
        'approval', jsonb_build_object('id', v_approval, 'approver_id', v_uid, 'decided_at', now()),
        'idempotency_key', 'handoff:' || v_approval::text),
      'handoff:' || v_approval::text)
    returning id into v_handoff;
    update office.runs set status = 'handoff_queued' where id = r.id;
    update office.briefs set status = 'done', updated_at = now() where id = r.brief_id;
    perform office.log_event(a.workspace_id, a.run_id, null, 'system', null, null, 'handoff.queued', 'delivering',
      jsonb_build_object('handoff_id', v_handoff));
  elsif p_decision = 'rejected' then
    update office.runs set status = 'cancelled', error_code = 'rejected' where id = r.id;
  else
    select coalesce(max(cycle), 0) + 1 into v_next_cycle from office.steps where run_id = r.id and step_key = 'revision_intake';
    update office.runs set status = 'running', revision = revision + 1, finished_at = null where id = r.id;
    insert into office.steps (run_id, workspace_id, step_key, agent_role, cycle, input)
    values (r.id, r.workspace_id, 'revision_intake', 'orchestrator', v_next_cycle,
            jsonb_build_object('owner_feedback', p_rationale, 'from_artifact', a.id, 'revision', r.revision + 1));
  end if;
  return jsonb_build_object('approval_id', v_approval, 'handoff_id', v_handoff, 'decision', p_decision);
end $$;

-- Read-only view of agents that already run for CMO (cmo.agent_runs), owners only.
create function office.legacy_agent_runs(p_workspace uuid, p_limit int default 50)
returns table (id bigint, agent text, status text, started_at timestamptz, finished_at timestamptz,
               summary text, stale boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_key text;
begin
  if not office.has_role(p_workspace, array['owner']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select w.cmo_workspace_key into v_key from office.workspaces w where w.id = p_workspace;
  if v_key is distinct from 'pavutyna-cmo' then return; end if;
  return query
    select ar.id, ar.agent, ar.status, ar.started_at, ar.finished_at, ar.summary,
           (ar.status = 'running' and ar.started_at < now() - interval '2 hours') as stale
    from cmo.agent_runs ar order by ar.id desc limit least(greatest(p_limit, 1), 200);
end $$;

-- ---------------------------------------------------------------------------
-- Worker API (only role office_app; never callable by authenticated users)
-- ---------------------------------------------------------------------------
create function office.worker_reap() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0;
begin
  for s in select * from office.steps where status = 'running' and locked_until < now() for update skip locked loop
    n := n + 1;
    if s.attempt >= s.max_attempts then
      update office.steps set status = 'failed', error = 'lease expired, attempts exhausted',
        locked_by = null, locked_until = null, finished_at = now() where id = s.id;
      update office.runs set status = 'failed', error_code = 'step_dead_lettered',
        error_message = s.step_key || ': lease expired' where id = s.run_id and status = 'running';
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role,
        'step.dead_lettered', 'blocked', jsonb_build_object('reason', 'lease_expired'));
    else
      update office.steps set status = 'ready', locked_by = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => least(300, 15 * power(2, s.attempt)::int)) where id = s.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role,
        'step.lease_expired', 'idle', jsonb_build_object('attempt', s.attempt));
    end if;
  end loop;
  return n;
end $$;

create function office.worker_claim(p_worker text, p_limit int default 3, p_lease_seconds int default 120)
returns setof office.steps
language plpgsql security definer set search_path = '' as $$
declare s office.steps; r office.runs; w office.workspaces; spent numeric;
begin
  perform office.worker_reap();
  for s in
    select st.* from office.steps st join office.runs ru on ru.id = st.run_id
    where st.status = 'ready' and st.next_attempt_at <= now() and ru.status in ('queued','running')
    order by st.created_at
    for update of st skip locked
    limit least(greatest(p_limit, 1), 10)
  loop
    select * into r from office.runs where id = s.run_id for update;
    select * into w from office.workspaces where id = s.workspace_id;
    select coalesce(sum(cost_usd), 0) into spent from office.runs
      where workspace_id = w.id and created_at >= date_trunc('day', now());
    if w.status <> 'active' then
      continue;
    elsif r.cost_usd >= r.budget_usd and r.budget_usd > 0 and r.cost_usd > 0 then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'budget_exceeded',
        error_message = 'run budget reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.budget_exceeded', 'blocked', '{}');
      continue;
    elsif spent >= w.daily_budget_usd and w.daily_budget_usd > 0 and spent > 0 then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'daily_budget_exceeded',
        error_message = 'workspace daily budget reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.budget_exceeded', 'blocked', '{}');
      continue;
    elsif r.steps_executed >= w.max_steps_per_run then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'max_steps_exceeded',
        error_message = 'step limit reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.max_steps', 'blocked', '{}');
      continue;
    end if;

    if r.status = 'queued' then update office.runs set status = 'running' where id = r.id; end if;
    update office.runs set steps_executed = steps_executed + 1 where id = r.id;
    update office.steps set status = 'running', attempt = attempt + 1, locked_by = p_worker,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now())
    where id = s.id returning * into s;
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.started',
      office.activity_for_role(s.agent_role), jsonb_build_object('step', s.step_key, 'attempt', s.attempt, 'cycle', s.cycle));
    return next s;
  end loop;
end $$;

create function office.worker_heartbeat(p_step uuid, p_worker text, p_lease_seconds int default 120)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update office.steps set locked_until = now() + make_interval(secs => p_lease_seconds)
    where id = p_step and status = 'running' and locked_by = p_worker returning 1)
  select exists (select 1 from u)
$$;

-- Atomically: finish a step, store artifacts, account cost, enqueue next steps, move run.
-- p_result: {output, provider, model, usage:{tokens_in,tokens_out,cost_usd},
--            artifacts:[{kind,title,content}], next_steps:[{step_key,agent_role,input,depends_on}],
--            run_status: null|'needs_approval'|'needs_input', activity, message}
create function office.worker_complete(p_step uuid, p_worker text, p_attempt int, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps; r office.runs; art jsonb; ns jsonb; v_version int; v_art uuid; v_arts jsonb := '[]'::jsonb;
        v_cost numeric := coalesce((p_result->'usage'->>'cost_usd')::numeric, 0);
        v_tin bigint := coalesce((p_result->'usage'->>'tokens_in')::bigint, 0);
        v_tout bigint := coalesce((p_result->'usage'->>'tokens_out')::bigint, 0);
        v_status text := p_result->>'run_status';
begin
  select * into s from office.steps where id = p_step for update;
  if not found or s.status <> 'running' or s.locked_by is distinct from p_worker or s.attempt <> p_attempt then
    return jsonb_build_object('accepted', false, 'reason', 'stale_or_foreign_lease');
  end if;
  select * into r from office.runs where id = s.run_id for update;
  if r.status not in ('running') then
    update office.steps set status = 'cancelled', locked_by = null, locked_until = null, finished_at = now() where id = s.id;
    return jsonb_build_object('accepted', false, 'reason', 'run_' || r.status);
  end if;

  update office.steps set status = 'succeeded', output = p_result->'output', provider = p_result->>'provider',
    model = p_result->>'model', cost_usd = v_cost, tokens_in = v_tin, tokens_out = v_tout,
    locked_by = null, locked_until = null, finished_at = now(), error = null
  where id = s.id;
  update office.runs set cost_usd = cost_usd + v_cost, tokens_in = tokens_in + v_tin, tokens_out = tokens_out + v_tout,
    provider = coalesce(provider, nullif(p_result->>'provider', 'code'))
  where id = r.id;

  for art in select value from jsonb_array_elements(coalesce(p_result->'artifacts', '[]'::jsonb)) loop
    select coalesce(max(version), 0) + 1 into v_version from office.artifacts where run_id = r.id and kind = art->>'kind';
    insert into office.artifacts (workspace_id, run_id, step_id, kind, title, version, content, content_hash, provider, model)
    values (r.workspace_id, r.id, s.id, art->>'kind', coalesce(art->>'title', art->>'kind'), v_version,
            art->'content', office.json_hash(art->'content'), coalesce(p_result->>'provider', 'unknown'), p_result->>'model')
    returning id into v_art;
    v_arts := v_arts || jsonb_build_array(jsonb_build_object('id', v_art, 'kind', art->>'kind', 'version', v_version));
    perform office.log_event(r.workspace_id, r.id, s.id, 'agent', null, s.agent_role, 'artifact.created', 'delivering',
      jsonb_build_object('artifact_id', v_art, 'kind', art->>'kind', 'version', v_version));
  end loop;

  for ns in select value from jsonb_array_elements(coalesce(p_result->'next_steps', '[]'::jsonb)) loop
    insert into office.steps (run_id, workspace_id, step_key, agent_role, cycle, depends_on, input)
    values (r.id, r.workspace_id, ns->>'step_key', ns->>'agent_role',
      (select coalesce(max(cycle), 0) + 1 from office.steps where run_id = r.id and step_key = ns->>'step_key'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ns->'depends_on','[]'::jsonb)) x), '{}'),
      coalesce(ns->'input', '{}'::jsonb));
  end loop;

  perform office.log_event(r.workspace_id, r.id, s.id, 'agent', null, s.agent_role, 'step.succeeded',
    coalesce(p_result->>'activity', 'idle'),
    jsonb_build_object('step', s.step_key, 'cycle', s.cycle, 'message', p_result->>'message',
                       'cost_usd', v_cost, 'model', p_result->>'model', 'provider', p_result->>'provider'));

  if v_status in ('needs_approval','needs_input') then
    update office.runs set status = v_status where id = r.id;
    perform office.log_event(r.workspace_id, r.id, null, 'system', null, 'orchestrator',
      'run.' || v_status, 'waiting_approval', '{}');
  elsif v_status is not null then
    raise exception 'unsupported run_status %', v_status;
  end if;

  return jsonb_build_object('accepted', true, 'artifacts', v_arts);
end $$;

create function office.worker_fail(p_step uuid, p_worker text, p_attempt int, p_error text, p_retryable boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps;
begin
  select * into s from office.steps where id = p_step for update;
  if not found or s.status <> 'running' or s.locked_by is distinct from p_worker or s.attempt <> p_attempt then
    return jsonb_build_object('accepted', false, 'reason', 'stale_or_foreign_lease');
  end if;
  if p_retryable and s.attempt < s.max_attempts then
    update office.steps set status = 'ready', error = left(p_error, 2000), locked_by = null, locked_until = null,
      next_attempt_at = now() + make_interval(secs => least(300, 15 * power(2, s.attempt)::int))
    where id = s.id;
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.retry_scheduled',
      'idle', jsonb_build_object('attempt', s.attempt, 'error', left(p_error, 500)));
    return jsonb_build_object('accepted', true, 'retry', true);
  end if;
  update office.steps set status = 'failed', error = left(p_error, 2000), locked_by = null, locked_until = null,
    finished_at = now() where id = s.id;
  update office.runs set status = 'failed', error_code = 'step_failed',
    error_message = s.step_key || ': ' || left(p_error, 500) where id = s.run_id and status = 'running';
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.dead_lettered',
    'blocked', jsonb_build_object('attempt', s.attempt, 'error', left(p_error, 500)));
  return jsonb_build_object('accepted', true, 'retry', false);
end $$;

-- Context a worker needs for one step (brief, approved knowledge, agent config, prior artifacts).
create function office.worker_context(p_step uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'step', to_jsonb(s),
    'run', to_jsonb(r),
    'brief', to_jsonb(b),
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'agent', (select to_jsonb(a) from office.agents a where a.workspace_id = s.workspace_id and a.role_key = s.agent_role),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('title', k.title, 'kind', k.kind, 'body', k.body,
                                                               'source_url', k.source_url, 'freshness_date', k.freshness_date)
                                            order by k.kind, k.title)
                           from office.knowledge_docs k where k.workspace_id = s.workspace_id and k.status = 'approved'), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'version', x.version, 'content', x.content)
                                            order by x.kind, x.version)
                           from office.artifacts x where x.run_id = s.run_id), '[]'::jsonb)
  )
  from office.steps s join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
  join office.workspaces w on w.id = s.workspace_id
  where s.id = p_step
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on all functions in schema office from public, anon, authenticated, service_role, office_app;
grant execute on function office.member_role(uuid), office.is_member(uuid), office.has_role(uuid, text[]),
  office.create_brief(uuid, jsonb), office.submit_brief(uuid, text), office.cancel_run(uuid),
  office.decide(uuid, text, text), office.legacy_agent_runs(uuid, int)
  to authenticated;
grant execute on function office.worker_reap(), office.worker_claim(text, int, int),
  office.worker_heartbeat(uuid, text, int), office.worker_complete(uuid, text, int, jsonb),
  office.worker_fail(uuid, text, int, text, boolean), office.worker_context(uuid)
  to office_app;
-- trigger/utility functions are executed by the system; keep them private.
alter default privileges in schema office revoke execute on functions from public;

comment on schema office is 'AI Office (phase 1). Writes only through office.* functions. See docs/ARCHITECTURE.md';
