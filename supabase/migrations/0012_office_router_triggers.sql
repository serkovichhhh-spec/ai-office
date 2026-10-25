-- AI Office 1.1 (P2): Capability Router with verified-only fallback + provider-neutral Trigger Gateway.
-- Architecture Review Round 2, §5, §7, §13, §17.1 and the owner's decision 19.10:
--   * fallback only to VERIFIED executors, Grok is never an automatic fallback for text/code;
--   * when no verified executor can take a step, it stops (route_blocked = no_verified_executor) and the owner is told;
--   * no paid channel exists here at all.
-- Additive only: new tables/columns/functions; gateway_eligible keeps its result for every existing step
-- (reserved_for is null for them). Kill switches: settings routing_enabled / triggers_enabled, env TRIGGERS_DISABLED,
-- trigger_channels.enabled, executor revoke.

-- ---------------------------------------------------------------------------
-- 1. Verified executors (acceptance-tested; only they may receive fallback work)
-- ---------------------------------------------------------------------------
alter table office.executors add column if not exists verified_at timestamptz;
alter table office.executors add column if not exists verified_note text;

-- Executors with at least 3 contract-validated results before this release passed real work already.
update office.executors e set verified_at = now(),
  verified_note = 'auto: ' || (select count(*) from office.execution_attempts x where x.executor_id = e.id and x.state = 'validated')
                  || ' validated results before 0012'
where e.revoked_at is null and e.verified_at is null and e.kind <> 'grok'
  and (select count(*) from office.execution_attempts x where x.executor_id = e.id and x.state = 'validated') >= 3;

-- ---------------------------------------------------------------------------
-- 2. Steps: routing + reservation
-- ---------------------------------------------------------------------------
alter table office.steps add column if not exists routed_from text;      -- original executor kind when rerouted
alter table office.steps add column if not exists route_blocked text;    -- 'no_verified_executor' while stopped
alter table office.steps add column if not exists reserved_for uuid references office.executors(id) on delete set null;
alter table office.steps add column if not exists reserved_until timestamptz;
alter table office.steps drop constraint if exists steps_routed_from_check;
alter table office.steps add constraint steps_routed_from_check
  check (routed_from is null or routed_from in ('claude_session','chatgpt','grok','human'));

-- Same rule as before plus: a step dispatched to one executor is reserved for it for up to 10 minutes.
create or replace function office.gateway_eligible(e office.executors, s office.steps) returns boolean
language sql stable set search_path = '' as $$
  select s.status = 'awaiting_agent'
     and s.workspace_id = e.workspace_id
     and coalesce(s.executor, 'claude_session') = e.kind
     and (e.allowed_seats is null or s.agent_role = any(e.allowed_seats))
     and office.gateway_independent(e, s)
     and (s.reserved_for is null or s.reserved_for = e.id or s.reserved_until is null or s.reserved_until < now())
$$;

-- ---------------------------------------------------------------------------
-- 3. Provider limits (exhausted until a time; null = until the owner clears it)
-- ---------------------------------------------------------------------------
create table if not exists office.provider_limits (
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  provider text not null check (provider in ('anthropic','openai','xai','other')),
  limited_until timestamptz,
  reason text not null default 'usage_limit' check (length(reason) between 1 and 200),
  source text not null default 'owner' check (source in ('owner','trigger','system')),
  set_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);
alter table office.provider_limits enable row level security;
revoke all on office.provider_limits from public, anon, authenticated, service_role, office_app;
grant select on office.provider_limits to authenticated;
create policy provider_limits_read on office.provider_limits for select to authenticated using (office.is_member(workspace_id));

create or replace function office.provider_available(p_workspace uuid, p_provider text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from office.provider_limits l where l.workspace_id = p_workspace and l.provider = p_provider
                     and (l.limited_until is null or l.limited_until > now()))
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger channels, runs and events
-- ---------------------------------------------------------------------------
create table if not exists office.trigger_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  label text not null check (label ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  adapter text not null check (adapter in ('claude_routine','chatgpt_agent','manual_notify')),
  executor_id uuid references office.executors(id) on delete cascade,
  enabled boolean not null default false,
  -- Non-secret settings only: env_prefix (names of server env vars holding URL/token), daily_cap,
  -- quiet_hours {days[1..7 ISO], from 'HH:MM', to 'HH:MM', tz}, wait_minutes (manual_notify).
  config jsonb not null default '{}'::jsonb,
  paused_until timestamptz,
  paused_manual boolean not null default false,
  paused_reason text,
  consecutive_failures int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, label),
  constraint trigger_channels_executor_pair check ((adapter = 'manual_notify') = (executor_id is null))
);
alter table office.trigger_channels enable row level security;
revoke all on office.trigger_channels from public, anon, authenticated, service_role, office_app;
grant select on office.trigger_channels to authenticated;
create policy trigger_channels_read on office.trigger_channels for select to authenticated using (office.is_member(workspace_id));

create table if not exists office.trigger_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  channel_id uuid not null references office.trigger_channels(id) on delete cascade,
  step_id uuid not null references office.steps(id) on delete cascade,
  run_id uuid not null references office.runs(id) on delete cascade,
  request_hash text not null,                 -- one "parking" of the step (a re-park after rejection is a new cycle)
  attempt_no int not null check (attempt_no between 1 and 10),
  last_event text not null default 'trigger_requested',
  provider_run_id text,
  session_url text,
  claimed_attempt_id uuid references office.execution_attempts(id) on delete set null,
  claimed_step_id uuid references office.steps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, step_id, request_hash, attempt_no)
);
create index if not exists trigger_runs_open_idx on office.trigger_runs (channel_id, created_at desc);
create index if not exists trigger_runs_step_idx on office.trigger_runs (step_id, request_hash);
alter table office.trigger_runs enable row level security;
revoke all on office.trigger_runs from public, anon, authenticated, service_role, office_app;
grant select on office.trigger_runs to authenticated;
create policy trigger_runs_read on office.trigger_runs for select to authenticated using (office.is_member(workspace_id));

create table if not exists office.trigger_events (
  id bigserial primary key,
  trigger_run_id uuid not null references office.trigger_runs(id) on delete cascade,
  type text not null check (type in ('trigger_requested','trigger_accepted','executor_started','task_claimed',
    'artifact_submitted','contract_validated','task_completed','trigger_failed','trigger_expired','trigger_skipped',
    'owner_notified')),
  at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists trigger_events_run_idx on office.trigger_events (trigger_run_id, at);
alter table office.trigger_events enable row level security;
revoke all on office.trigger_events from public, anon, authenticated, service_role, office_app;
grant select on office.trigger_events to authenticated;
create policy trigger_events_read on office.trigger_events for select to authenticated
  using (exists (select 1 from office.trigger_runs t where t.id = trigger_run_id and office.is_member(t.workspace_id)));

create or replace function office.trigger_terminal(p_type text) returns boolean
language sql immutable set search_path = '' as $$
  select p_type in ('task_completed','trigger_failed','trigger_expired','trigger_skipped','owner_notified')
$$;

create or replace function office.channel_paused(c office.trigger_channels) returns boolean
language sql stable set search_path = '' as $$
  select c.paused_manual or (c.paused_until is not null and c.paused_until > now())
$$;

create or replace function office.channel_quiet(c office.trigger_channels) returns boolean
language plpgsql stable set search_path = '' as $$
declare q jsonb := c.config->'quiet_hours'; v_local timestamp; v_t time;
begin
  if q is null or jsonb_typeof(q) <> 'object' then return false; end if;
  v_local := now() at time zone coalesce(q->>'tz', 'Europe/Kyiv');
  if q ? 'days' and not (extract(isodow from v_local)::int in (select (d)::int from jsonb_array_elements_text(q->'days') d)) then
    return false;
  end if;
  v_t := v_local::time;
  return v_t >= (q->>'from')::time and v_t < (q->>'to')::time;
exception when others then
  return false;
end $$;

create or replace function office.channel_today(p_channel uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from office.trigger_runs t where t.channel_id = p_channel
    and t.created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv')
$$;

-- An executor whose enabled channel is paused (breaker, rate limit, auth) is unavailable for routing.
create or replace function office.executor_tripped(p_executor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from office.trigger_channels c where c.executor_id = p_executor and c.enabled
                 and office.channel_paused(c))
$$;

-- ---------------------------------------------------------------------------
-- 5. Capability Router (eligibility is hard; fallback goes only to verified executors)
-- ---------------------------------------------------------------------------
insert into office.settings (workspace_id, key, value) values
  (null, 'routing_enabled', 'true'),
  (null, 'triggers_enabled', 'true'),     -- global kill switch; each workspace also needs its own 'true'
  -- Text: Claude → ChatGPT → stop. ChatGPT → Claude only where Claude holds the seat and stays independent.
  -- Grok is deliberately absent (owner decision 19.10) and would also need verified_at.
  (null, 'fallback_chains', '{"claude_session":["chatgpt"],"chatgpt":["claude_session"]}')
on conflict do nothing;

create or replace function office.route_candidate(s office.steps, p_kind text, p_require_verified boolean) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from office.executors e
  where e.workspace_id = s.workspace_id and e.kind = p_kind and e.revoked_at is null
    and (not p_require_verified or e.verified_at is not null)
    and (e.allowed_seats is null or s.agent_role = any(e.allowed_seats))
    and office.gateway_independent(e, s)
    and office.gateway_policy_ok(e, s)
    and office.provider_available(s.workspace_id, e.provider)
    and not office.executor_tripped(e.id)
  order by e.verified_at nulls last, e.created_at
  limit 1
$$;

create or replace function office.route_unusable_reason(s office.steps, p_kind text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare ids uuid[];
begin
  -- Narrow the executors of this kind that hold the seat step by step; the first empty set names the reason.
  select coalesce(array_agg(e.id), '{}') into ids from office.executors e
  where e.workspace_id = s.workspace_id and e.kind = p_kind and e.revoked_at is null
    and (e.allowed_seats is null or s.agent_role = any(e.allowed_seats));
  if cardinality(ids) = 0 then return 'no_executor_for_seat'; end if;
  select coalesce(array_agg(e.id), '{}') into ids from office.executors e
  where e.id = any(ids) and office.provider_available(s.workspace_id, e.provider);
  if cardinality(ids) = 0 then return 'provider_limit'; end if;
  select coalesce(array_agg(e.id), '{}') into ids from office.executors e where e.id = any(ids) and not office.executor_tripped(e.id);
  if cardinality(ids) = 0 then return 'channel_paused'; end if;
  select coalesce(array_agg(e.id), '{}') into ids from office.executors e where e.id = any(ids) and office.gateway_independent(e, s);
  if cardinality(ids) = 0 then return 'not_independent'; end if;
  return 'data_policy';
end $$;

create or replace function office.router_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps; v_cur text; v_orig text; v_reason text; v_k text; v_to text; v_chain text[];
        n_routed int := 0; n_blocked int := 0; n_unblocked int := 0;
begin
  if not coalesce((office.setting(null, 'routing_enabled'))::boolean, true) then
    return jsonb_build_object('disabled', true);
  end if;
  update office.steps set reserved_for = null, reserved_until = null
  where reserved_for is not null and reserved_until < now();

  for s in
    select st.* from office.steps st
    join office.runs r on r.id = st.run_id and r.status = 'running'
    join office.workspaces w on w.id = st.workspace_id and w.status = 'active'
    where st.status = 'awaiting_agent'
      and coalesce((office.setting(st.workspace_id, 'routing_enabled'))::boolean, true)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
    order by st.created_at
    for update of st skip locked
  loop
    v_cur := coalesce(s.executor, 'claude_session');
    v_orig := coalesce(s.routed_from, v_cur);
    -- The original assignment needs no verification (that is today's behaviour); a fallback target does.
    if office.route_candidate(s, v_cur, v_cur <> v_orig) is not null then
      if s.route_blocked is not null then
        update office.steps set route_blocked = null where id = s.id;
        perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'route.unblocked', 'idle',
          jsonb_build_object('step', s.step_key, 'executor', v_cur));
        n_unblocked := n_unblocked + 1;
      end if;
      continue;
    end if;

    v_reason := office.route_unusable_reason(s, v_cur);
    select coalesce(array_agg(x), '{}') into v_chain
    from jsonb_array_elements_text(coalesce(office.setting(s.workspace_id, 'fallback_chains')->v_orig, '[]'::jsonb)) x;
    v_to := null;
    -- Capacity (limit, paused channel) and data policy move work along the chain; a missing seat or
    -- independence conflict is a configuration problem: stop and tell the owner instead of moving silently.
    if v_cur = v_orig and v_reason not in ('provider_limit', 'channel_paused', 'data_policy') then
      v_chain := '{}';
    end if;
    foreach v_k in array (array[v_orig] || v_chain) loop
      continue when v_k = v_cur or v_k = 'grok';
      if office.route_candidate(s, v_k, v_k <> v_orig) is not null then v_to := v_k; exit; end if;
    end loop;

    if v_to is not null then
      update office.steps set executor = v_to, routed_from = case when v_to = v_orig then null else v_orig end,
        route_blocked = null, reserved_for = null, reserved_until = null
      where id = s.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role,
        case when v_to = v_orig then 'route.restored' else 'route.fallback' end, 'planning',
        jsonb_build_object('step', s.step_key, 'from', v_cur, 'to', v_to, 'reason', v_reason));
      n_routed := n_routed + 1;
    elsif s.route_blocked is null then
      update office.steps set route_blocked = 'no_verified_executor' where id = s.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'route.blocked', 'blocked',
        jsonb_build_object('step', s.step_key, 'executor', v_cur, 'reason', v_reason, 'code', 'no_verified_executor'));
      n_blocked := n_blocked + 1;
    end if;
  end loop;
  return jsonb_build_object('rerouted', n_routed, 'blocked', n_blocked, 'unblocked', n_unblocked);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Trigger Gateway (state machine in SQL; HTTP adapters live in the app)
-- ---------------------------------------------------------------------------
create or replace function office.trigger_mark(p_run uuid, p_type text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t office.trigger_runs; c office.trigger_channels; v_trips int; v_was_terminal boolean;
begin
  select * into t from office.trigger_runs where id = p_run for update;
  if not found then return; end if;
  v_was_terminal := office.trigger_terminal(t.last_event);
  insert into office.trigger_events (trigger_run_id, type, data) values (t.id, p_type, coalesce(p_data, '{}'::jsonb));
  if v_was_terminal then return; end if;     -- late signals are kept in history but do not change the outcome
  update office.trigger_runs set last_event = p_type, updated_at = now() where id = t.id;

  if office.trigger_terminal(p_type) then
    select * into c from office.trigger_channels where id = t.channel_id for update;
    update office.steps set reserved_for = null, reserved_until = null
    where id = t.step_id and reserved_for is not distinct from c.executor_id;

    if p_type = 'task_completed' then
      update office.trigger_channels set consecutive_failures = 0, updated_at = now() where id = c.id;
      perform office.log_event(t.workspace_id, t.run_id, coalesce(t.claimed_step_id, t.step_id), 'system', null, null,
        'trigger.completed', 'idle', jsonb_build_object('channel', c.label, 'trigger_run_id', t.id));
    elsif p_type in ('trigger_failed','trigger_expired') then
      perform office.log_event(t.workspace_id, t.run_id, t.step_id, 'system', null, null,
        replace(p_type, '_', '.'), 'idle', jsonb_build_object('channel', c.label, 'trigger_run_id', t.id) || coalesce(p_data, '{}'::jsonb));
      if coalesce((p_data->>'count_failure')::boolean, true) then
        update office.trigger_channels set consecutive_failures = consecutive_failures + 1, updated_at = now()
        where id = c.id returning * into c;
        -- Circuit breaker: 3 failed launches in a row → pause 1 h; the second trip within 24 h → until the owner resumes.
        if c.consecutive_failures >= 3 then
          select count(*) into v_trips from office.events
          where workspace_id = c.workspace_id and kind = 'channel.paused' and payload->>'channel_id' = c.id::text
            and payload->>'reason' = 'circuit_breaker' and created_at > now() - interval '24 hours';
          update office.trigger_channels set consecutive_failures = 0, paused_reason = 'circuit_breaker',
            paused_manual = (v_trips >= 1), paused_until = case when v_trips >= 1 then null else now() + interval '1 hour' end,
            updated_at = now()
          where id = c.id;
          perform office.log_event(c.workspace_id, null, null, 'system', null, null, 'channel.paused', 'blocked',
            jsonb_build_object('channel_id', c.id, 'channel', c.label, 'reason', 'circuit_breaker',
                               'until', case when v_trips >= 1 then null else now() + interval '1 hour' end,
                               'manual_resume', v_trips >= 1));
        end if;
      end if;
    end if;
  elsif p_type = 'trigger_accepted' then
    perform office.log_event(t.workspace_id, t.run_id, t.step_id, 'system', null, null, 'trigger.accepted', 'idle',
      jsonb_build_object('trigger_run_id', t.id, 'channel', (select label from office.trigger_channels where id = t.channel_id),
                         'session_url', p_data->>'session_url'));
  end if;
end $$;

-- Picks steps that need a nudge and reserves them; the app fires the adapters and reports back.
create or replace function office.trigger_dispatch(p_limit int default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps; c office.trigger_channels; out jsonb := '[]'::jsonb; v_hash text; v_tr uuid; v_n int; v_since timestamptz;
        v_title text; v_slug text;
begin
  if not coalesce((office.setting(null, 'triggers_enabled'))::boolean, false) then return out; end if;
  perform office.gateway_expire();

  for s in
    select st.* from office.steps st
    join office.runs r on r.id = st.run_id and r.status = 'running'
    join office.workspaces w on w.id = st.workspace_id and w.status = 'active'
    where st.status = 'awaiting_agent'
      and coalesce((select value from office.settings x where x.workspace_id = st.workspace_id and x.key = 'triggers_enabled')::boolean, false)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
      and not exists (select 1 from office.trigger_runs t where t.step_id = st.id and not office.trigger_terminal(t.last_event))
    order by st.created_at
    limit 200
    for update of st skip locked
  loop
    exit when jsonb_array_length(out) >= least(greatest(p_limit, 1), 20);
    v_hash := office.json_hash(coalesce(s.agent_request, '{}'::jsonb));

    -- 1) An executor channel that can take this step right now.
    c := null;
    if s.route_blocked is null then
      select ch.* into c from office.trigger_channels ch join office.executors e on e.id = ch.executor_id
      where ch.workspace_id = s.workspace_id and ch.adapter <> 'manual_notify' and ch.enabled
        and not office.channel_paused(ch) and not office.channel_quiet(ch)
        and e.revoked_at is null
        and office.gateway_eligible(e, s) and office.gateway_policy_ok(e, s)
        and office.provider_available(s.workspace_id, e.provider)
        and not exists (select 1 from office.trigger_runs t where t.channel_id = ch.id and not office.trigger_terminal(t.last_event))
        and office.channel_today(ch.id) < coalesce((ch.config->>'daily_cap')::int, 5)
        and (select count(*) from office.trigger_runs t where t.channel_id = ch.id and t.step_id = s.id and t.request_hash = v_hash) < 2
        and (select count(*) from office.trigger_runs t join office.trigger_channels x on x.id = t.channel_id
             where t.step_id = s.id and t.request_hash = v_hash and x.adapter <> 'manual_notify') < 3
        -- backoff after a failed launch: 30 s, then 2 min
        and not exists (select 1 from office.trigger_runs t where t.channel_id = ch.id and t.step_id = s.id and t.request_hash = v_hash
                        and t.updated_at > now() - case when t.attempt_no = 1 then interval '30 seconds' else interval '2 minutes' end)
      order by ch.created_at
      limit 1;
    end if;

    if c.id is not null then
      select count(*) + 1 into v_n from office.trigger_runs t where t.channel_id = c.id and t.step_id = s.id and t.request_hash = v_hash;
      insert into office.trigger_runs (workspace_id, channel_id, step_id, run_id, request_hash, attempt_no)
      values (s.workspace_id, c.id, s.id, s.run_id, v_hash, v_n) returning id into v_tr;
      insert into office.trigger_events (trigger_run_id, type, data)
      values (v_tr, 'trigger_requested', jsonb_build_object('step_id', s.id, 'attempt_no', v_n));
      update office.steps set reserved_for = c.executor_id, reserved_until = now() + interval '10 minutes' where id = s.id;
      out := out || jsonb_build_array(jsonb_build_object('trigger_run_id', v_tr, 'channel_id', c.id, 'channel', c.label,
        'adapter', c.adapter, 'config', c.config, 'step_id', s.id,
        -- The payload carries only the task id: the executor reads everything else through the gateway.
        'text', 'task_id=' || s.id));
      continue;
    end if;

    -- 2) Nobody can be woken up (no usable executor channel, or its launches for this step are used up):
    --    tell the owner once per parking of the step, after a wait. A channel that is only in backoff,
    --    quiet hours or busy with another step still counts as able to wake someone.
    if s.route_blocked is null and exists (
        select 1 from office.trigger_channels ch join office.executors e on e.id = ch.executor_id
        where ch.workspace_id = s.workspace_id and ch.adapter <> 'manual_notify' and ch.enabled
          and not office.channel_paused(ch) and e.revoked_at is null
          and office.gateway_eligible(e, s) and office.gateway_policy_ok(e, s)
          and office.provider_available(s.workspace_id, e.provider)
          and office.channel_today(ch.id) < coalesce((ch.config->>'daily_cap')::int, 5)
          and (select count(*) from office.trigger_runs t where t.channel_id = ch.id and t.step_id = s.id and t.request_hash = v_hash) < 2) then
      continue;
    end if;
    select coalesce(max(ev.created_at), s.created_at) into v_since from office.events ev
    where ev.step_id = s.id and ev.kind in ('step.awaiting_agent', 'route.blocked', 'route.fallback');
    select ch.* into c from office.trigger_channels ch
    where ch.workspace_id = s.workspace_id and ch.adapter = 'manual_notify' and ch.enabled and not office.channel_paused(ch)
      and v_since <= now() - make_interval(mins => coalesce((ch.config->>'wait_minutes')::int, 30))
      and office.channel_today(ch.id) < coalesce((ch.config->>'daily_cap')::int, 10)
      and not exists (select 1 from office.trigger_runs t where t.channel_id = ch.id and t.step_id = s.id and t.request_hash = v_hash)
    order by ch.created_at limit 1;
    if c.id is not null then
      select b.title, w.slug into v_title, v_slug from office.runs r join office.briefs b on b.id = r.brief_id
        join office.workspaces w on w.id = r.workspace_id where r.id = s.run_id;
      insert into office.trigger_runs (workspace_id, channel_id, step_id, run_id, request_hash, attempt_no)
      values (s.workspace_id, c.id, s.id, s.run_id, v_hash, 1) returning id into v_tr;
      insert into office.trigger_events (trigger_run_id, type, data) values (v_tr, 'trigger_requested', jsonb_build_object('step_id', s.id));
      out := out || jsonb_build_array(jsonb_build_object('trigger_run_id', v_tr, 'channel_id', c.id, 'channel', c.label,
        'adapter', c.adapter, 'config', c.config, 'step_id', s.id,
        'text', format('AI Office: крок «%s» (%s) у брифі «%s» чекає на %s%s.', s.step_key, s.agent_role, v_title,
                       coalesce(s.executor, 'claude_session'),
                       case when s.route_blocked is not null then ' — немає перевіреного виконавця' else '' end),
        'url', coalesce(office.setting(null, 'app_url')->>0, '') || '/w/' || v_slug || '/runs/' || s.run_id));
    end if;
  end loop;
  return out;
end $$;

-- Outcome of one adapter call. result: accepted | notified | not_configured | rate_limited | auth | fatal | retryable.
create or replace function office.trigger_report(p_run uuid, p_outcome jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t office.trigger_runs; v_res text := p_outcome->>'result'; v_retry int;
begin
  select * into t from office.trigger_runs where id = p_run;
  if not found or office.trigger_terminal(t.last_event) then return; end if;
  if v_res = 'accepted' then
    update office.trigger_runs set provider_run_id = left(p_outcome->>'provider_run_id', 200),
      session_url = case when p_outcome->>'session_url' ~ '^https://' then left(p_outcome->>'session_url', 500) end
    where id = t.id;
    -- A claim may already have happened during the HTTP call; then the run is already past 'accepted'.
    if t.last_event = 'trigger_requested' then
      perform office.trigger_mark(t.id, 'trigger_accepted', jsonb_build_object('session_url', p_outcome->>'session_url'));
    else
      insert into office.trigger_events (trigger_run_id, type, data) values (t.id, 'trigger_accepted', '{}'::jsonb);
    end if;
  elsif v_res = 'notified' then
    perform office.trigger_mark(t.id, 'owner_notified', '{}'::jsonb);
    perform office.log_event(t.workspace_id, t.run_id, t.step_id, 'system', null, null, 'owner.attention', 'blocked',
      jsonb_build_object('trigger_run_id', t.id, 'delivered', coalesce(p_outcome->>'delivered', 'in_app')));
  elsif v_res = 'not_configured' then
    perform office.trigger_mark(t.id, 'trigger_skipped', jsonb_build_object('code', 'not_configured'));
  elsif v_res = 'rate_limited' then
    v_retry := least(greatest(coalesce((p_outcome->>'retry_after_s')::int, 3600), 60), 86400);
    update office.trigger_channels set paused_until = now() + make_interval(secs => v_retry), paused_reason = 'rate_limited',
      updated_at = now() where id = t.channel_id;
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', 'rate_limited', 'status', p_outcome->'status',
      'count_failure', false));
    perform office.log_event(t.workspace_id, null, null, 'system', null, null, 'channel.paused', 'blocked',
      jsonb_build_object('channel_id', t.channel_id, 'reason', 'rate_limited', 'until', now() + make_interval(secs => v_retry)));
  elsif v_res in ('auth', 'fatal') then
    update office.trigger_channels set paused_manual = true, paused_reason = v_res, updated_at = now() where id = t.channel_id;
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', v_res, 'status', p_outcome->'status',
      'message', left(p_outcome->>'message', 300), 'count_failure', false));
    perform office.log_event(t.workspace_id, null, null, 'system', null, null, 'channel.paused', 'blocked',
      jsonb_build_object('channel_id', t.channel_id, 'reason', v_res, 'manual_resume', true));
  else
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', coalesce(v_res, 'unknown'),
      'status', p_outcome->'status', 'message', left(p_outcome->>'message', 300)));
  end if;
end $$;

-- Timeouts: accepted but nobody claimed in 10 min → expired (no_claim); never reported → failed; step closed → skipped.
create or replace function office.trigger_expire() returns int
language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0;
begin
  for t in select tr.id, tr.last_event, tr.created_at, st.status as step_status, r.status as run_status
           from office.trigger_runs tr join office.steps st on st.id = tr.step_id join office.runs r on r.id = tr.run_id
           where not office.trigger_terminal(tr.last_event) loop
    if t.last_event in ('trigger_requested','trigger_accepted','executor_started')
       and (t.run_status <> 'running' or t.step_status in ('succeeded','failed','cancelled')) then
      perform office.trigger_mark(t.id, 'trigger_skipped', jsonb_build_object('code', 'step_closed'));
    elsif t.last_event in ('trigger_accepted','executor_started') and t.created_at < now() - interval '10 minutes' then
      perform office.trigger_mark(t.id, 'trigger_expired', jsonb_build_object('code', 'no_claim'));
    elsif t.last_event = 'trigger_requested' and t.created_at < now() - interval '5 minutes' then
      perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', 'no_report'));
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Attempt lifecycle → trigger events (claim by the channel's executor, submit, validation, rejection, expiry).
create or replace function office.trigger_attempt_hook() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_run uuid;
begin
  if tg_op = 'INSERT' then
    select t.id into v_run from office.trigger_runs t join office.trigger_channels c on c.id = t.channel_id
    where c.executor_id = new.executor_id and t.claimed_attempt_id is null
      and t.last_event in ('trigger_requested','trigger_accepted','executor_started')
      and t.created_at > now() - interval '30 minutes'
    order by (t.step_id = new.step_id) desc, t.created_at
    limit 1 for update of t skip locked;
    if v_run is not null then
      update office.trigger_runs set claimed_attempt_id = new.id, claimed_step_id = new.step_id where id = v_run;
      perform office.trigger_mark(v_run, 'task_claimed', jsonb_build_object('step_id', new.step_id, 'attempt_id', new.id));
    end if;
    return new;
  end if;
  if new.state is not distinct from old.state then return new; end if;
  select id into v_run from office.trigger_runs where claimed_attempt_id = new.id;
  if v_run is null then return new; end if;
  if new.state = 'submitted' then
    perform office.trigger_mark(v_run, 'artifact_submitted', jsonb_build_object('attempt_id', new.id));
  elsif new.state = 'validated' then
    perform office.trigger_mark(v_run, 'contract_validated', jsonb_build_object('attempt_id', new.id));
    perform office.trigger_mark(v_run, 'task_completed', jsonb_build_object('attempt_id', new.id));
  elsif new.state in ('rejected','expired','released') then
    perform office.trigger_mark(v_run, 'trigger_failed', jsonb_build_object('code',
      case new.state when 'rejected' then 'contract_invalid' when 'expired' then 'lease_expired' else 'released' end,
      'reason', new.rejection_reason));
  end if;
  return new;
end $$;
drop trigger if exists attempts_trigger_events on office.execution_attempts;
create trigger attempts_trigger_events after insert or update of state on office.execution_attempts
  for each row execute function office.trigger_attempt_hook();

-- ---------------------------------------------------------------------------
-- 7. Owner controls (UI) and owner-only state read
-- ---------------------------------------------------------------------------
create or replace function office.set_provider_limit(p_workspace uuid, p_provider text, p_until timestamptz, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not office.has_role(p_workspace, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_until is not null and p_until <= now() then raise exception 'limit must end in the future' using errcode = '22023'; end if;
  insert into office.provider_limits (workspace_id, provider, limited_until, reason, source)
  values (p_workspace, p_provider, p_until, coalesce(nullif(p_reason, ''), 'usage_limit'), 'owner')
  on conflict (workspace_id, provider) do update set limited_until = excluded.limited_until, reason = excluded.reason,
    source = 'owner', set_at = now();
  perform office.log_event(p_workspace, null, null, 'user', auth.uid(), null, 'provider.limited', 'idle',
    jsonb_build_object('provider', p_provider, 'until', p_until, 'reason', coalesce(nullif(p_reason, ''), 'usage_limit')));
end $$;

create or replace function office.clear_provider_limit(p_workspace uuid, p_provider text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not office.has_role(p_workspace, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from office.provider_limits where workspace_id = p_workspace and provider = p_provider;
  perform office.log_event(p_workspace, null, null, 'user', auth.uid(), null, 'provider.restored', 'idle',
    jsonb_build_object('provider', p_provider));
end $$;

create or replace function office.set_channel_enabled(p_channel uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c office.trigger_channels;
begin
  select * into c from office.trigger_channels where id = p_channel;
  if not found or not office.has_role(c.workspace_id, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  update office.trigger_channels set enabled = p_enabled, updated_at = now() where id = c.id;
  perform office.log_event(c.workspace_id, null, null, 'user', auth.uid(), null, 'channel.toggled', 'idle',
    jsonb_build_object('channel_id', c.id, 'channel', c.label, 'enabled', p_enabled));
end $$;

create or replace function office.resume_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c office.trigger_channels;
begin
  select * into c from office.trigger_channels where id = p_channel;
  if not found or not office.has_role(c.workspace_id, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  update office.trigger_channels set paused_until = null, paused_manual = false, paused_reason = null,
    consecutive_failures = 0, updated_at = now() where id = c.id;
  perform office.log_event(c.workspace_id, null, null, 'user', auth.uid(), null, 'channel.resumed', 'idle',
    jsonb_build_object('channel_id', c.id, 'channel', c.label));
end $$;

create or replace function office.set_executor_verified(p_executor uuid, p_verified boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e office.executors;
begin
  select * into e from office.executors where id = p_executor and revoked_at is null;
  if not found or not office.has_role(e.workspace_id, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  update office.executors set verified_at = case when p_verified then coalesce(verified_at, now()) end,
    verified_note = case when p_verified then coalesce(nullif(p_note, ''), verified_note, 'owner') end
  where id = e.id;
  perform office.log_event(e.workspace_id, null, null, 'user', auth.uid(), null, 'executor.verified', 'idle',
    jsonb_build_object('executor_id', e.id, 'label', e.label, 'verified', p_verified));
end $$;

create or replace function office.set_triggers_enabled(p_workspace uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not office.has_role(p_workspace, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into office.settings (workspace_id, key, value) values (p_workspace, 'triggers_enabled', to_jsonb(p_enabled))
  on conflict (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  do update set value = excluded.value, updated_at = now();
  perform office.log_event(p_workspace, null, null, 'user', auth.uid(), null, 'triggers.toggled', 'idle',
    jsonb_build_object('enabled', p_enabled));
end $$;

create or replace function office.routing_state(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not office.has_role(p_workspace, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'triggers_enabled', coalesce((select value from office.settings where workspace_id = p_workspace and key = 'triggers_enabled')::boolean, false)
                        and coalesce((office.setting(null, 'triggers_enabled'))::boolean, false),
    'routing_enabled', coalesce((office.setting(p_workspace, 'routing_enabled'))::boolean, true),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', l.provider, 'limited_until', l.limited_until,
        'reason', l.reason, 'source', l.source, 'set_at', l.set_at) order by l.provider)
      from office.provider_limits l where l.workspace_id = p_workspace and (l.limited_until is null or l.limited_until > now())), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'adapter', c.adapter,
        'executor_label', e.label, 'enabled', c.enabled, 'paused', office.channel_paused(c), 'paused_until', c.paused_until,
        'paused_manual', c.paused_manual, 'paused_reason', c.paused_reason, 'quiet_now', office.channel_quiet(c),
        'consecutive_failures', c.consecutive_failures, 'today', office.channel_today(c.id),
        'daily_cap', coalesce((c.config->>'daily_cap')::int, case when c.adapter = 'manual_notify' then 10 else 5 end),
        'env_prefix', c.config->>'env_prefix',
        'last', (select jsonb_build_object('event', t.last_event, 'at', t.updated_at, 'session_url', t.session_url)
                 from office.trigger_runs t where t.channel_id = c.id order by t.created_at desc limit 1)) order by c.created_at)
      from office.trigger_channels c left join office.executors e on e.id = c.executor_id
      where c.workspace_id = p_workspace), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('step_id', s.id, 'run_id', s.run_id, 'step', s.step_key,
        'seat', s.agent_role, 'executor', coalesce(s.executor, 'claude_session'), 'routed_from', s.routed_from,
        'route_blocked', s.route_blocked, 'brief_title', b.title, 'since', s.created_at) order by s.created_at)
      from office.steps s join office.runs r on r.id = s.run_id and r.status = 'running' join office.briefs b on b.id = r.brief_id
      where s.workspace_id = p_workspace and s.status = 'awaiting_agent'
        and (s.route_blocked is not null or exists (select 1 from office.trigger_runs t join office.trigger_channels c on c.id = t.channel_id
             where t.step_id = s.id and c.adapter = 'manual_notify' and t.request_hash = office.json_hash(coalesce(s.agent_request, '{}'::jsonb))))),
      '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Seed: channels per workspace (executor channels OFF until the owner adds secrets and enables them)
-- ---------------------------------------------------------------------------
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select e.workspace_id, 'claude-routine', 'claude_routine', e.id, false,
  '{"env_prefix":"CLAUDE_ROUTINE","daily_cap":5,"quiet_hours":{"days":[1,2,3,4,5],"from":"08:30","to":"10:30","tz":"Europe/Kyiv"}}'
from office.executors e where e.label = 'claude_main' and e.revoked_at is null
on conflict (workspace_id, label) do nothing;
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select e.workspace_id, 'chatgpt-agent', 'chatgpt_agent', e.id, false, '{"env_prefix":"CHATGPT_AGENT","daily_cap":10}'
from office.executors e where e.label = 'chatgpt_cmo' and e.revoked_at is null
on conflict (workspace_id, label) do nothing;
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select w.id, 'owner-notify', 'manual_notify', null, true, '{"wait_minutes":30,"daily_cap":10}'
from office.workspaces w where w.cmo_workspace_key is not null
on conflict (workspace_id, label) do nothing;
insert into office.settings (workspace_id, key, value)
select w.id, 'triggers_enabled', 'true' from office.workspaces w where w.cmo_workspace_key is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. QA: three more checks (route blocked, paused channels, failed launches)
-- ---------------------------------------------------------------------------
create or replace function office.qa_routing_checks(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := '[]'::jsonb; n int; d jsonb;
begin
  select count(*) into n from office.steps s join office.runs r on r.id = s.run_id and r.status = 'running'
  where s.workspace_id = p_workspace and s.status = 'awaiting_agent' and s.route_blocked is not null;
  c := c || jsonb_build_object('key','route_blocked','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Кроки зупинені: немає перевіреного виконавця, який може їх узяти');
  select count(*), coalesce(jsonb_agg(label), '[]'::jsonb) into n, d from office.trigger_channels c2
  where c2.workspace_id = p_workspace and c2.enabled and office.channel_paused(c2);
  c := c || jsonb_build_object('key','channels_paused','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'channels', d, 'detail','Канали запуску на паузі (запобіжник, ліміт або помилка доступу)');
  select count(*) into n from office.trigger_runs t where t.workspace_id = p_workspace
    and t.last_event in ('trigger_failed','trigger_expired') and t.updated_at > now() - interval '24 hours';
  c := c || jsonb_build_object('key','trigger_failures_24h','level', case when n > 0 then 'info' else 'ok' end,'count',n,
         'detail','Невдалі автоматичні запуски виконавців за добу');
  return c;
end $$;

-- qa_checks = 0011 body + routing checks appended before the summary.
create or replace function office.qa_checks(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := '[]'::jsonb; n int; d jsonb; v_cmo text;
begin
  select cmo_workspace_key into v_cmo from office.workspaces where id = p_workspace;

  select count(*) into n from office.steps s join office.runs r on r.id = s.run_id
  where s.workspace_id = p_workspace and s.status = 'ready' and r.status = 'running'
    and coalesce(s.next_attempt_at, s.created_at) < now() - interval '15 minutes';
  c := c || jsonb_build_object('key','worker_backlog','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Кроки в статусі ready довше 15 хв — воркер не обробляє чергу');

  select count(*), coalesce(jsonb_object_agg(k, m), '{}'::jsonb) into n, d from (
    select coalesce(s.executor,'claude_session') k, count(*) m from office.steps s join office.runs r on r.id = s.run_id
    where s.workspace_id = p_workspace and s.status = 'awaiting_agent' and r.status = 'running'
      and greatest(s.created_at, s.next_attempt_at) < now() - interval '24 hours' group by 1) q;
  select coalesce(sum((value)::int), 0) into n from jsonb_each_text(d);
  c := c || jsonb_build_object('key','stuck_agent_steps','level', case when n = 0 then 'ok'
           when exists (select 1 from office.steps s join office.runs r on r.id = s.run_id and r.status = 'running'
                        where s.workspace_id = p_workspace and s.status = 'awaiting_agent'
                        and greatest(s.created_at, s.next_attempt_at) < now() - interval '72 hours') then 'fail' else 'warn' end,
         'count', n, 'by_executor', d, 'detail','Задачі чекають на виконавця понад 24 год (понад 72 год — fail)');

  select count(*) into n from office.runs where workspace_id = p_workspace and status = 'needs_approval'
    and updated_at < now() - interval '48 hours';
  c := c || jsonb_build_object('key','owner_waiting','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Пакети чекають рішення власника понад 48 год');

  select count(*) into n from office.runs where workspace_id = p_workspace and status = 'failed'
    and updated_at > now() - interval '24 hours';
  c := c || jsonb_build_object('key','failed_runs_24h','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Запуски, що впали за добу');

  select count(*) into n from office.execution_attempts where workspace_id = p_workspace and state = 'claimed'
    and lease_expires_at < now() - interval '10 minutes';
  c := c || jsonb_build_object('key','unreaped_leases','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Прострочені оренди, які ще не звільнені');

  select count(*) into n from office.events where workspace_id = p_workspace and kind = 'gateway.bypass_detected'
    and created_at > now() - interval '7 days';
  c := c || jsonb_build_object('key','gateway_bypass_7d','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Спроби обійти шлюз старим SQL-шляхом за 7 днів');
  select count(*) into n from office.events where workspace_id = p_workspace and kind = 'gateway.legacy_used'
    and created_at > now() - interval '7 days';
  c := c || jsonb_build_object('key','legacy_path_7d','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Використання старого шляху agent_submit за 7 днів (критерій Legacy off — 0)');

  select count(*) into n from office.execution_attempts x
  where x.workspace_id = p_workspace and x.claimed_at > now() - interval '7 days'
    and x.claimed_at > coalesce((select min(st.updated_at) from office.settings st
                                 where st.workspace_id is null and st.key = 'governance_enforced'), now())
    and not exists (select 1 from office.external_transfers t where t.step_id = x.step_id and t.executor_id = x.executor_id
                    and t.op = 'claim' and t.at between x.claimed_at - interval '1 minute' and x.claimed_at + interval '1 minute');
  c := c || jsonb_build_object('key','transfer_audit_gap','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Взяття задач без запису в журналі передач');

  select count(*) into n from office.events where workspace_id = p_workspace and kind = 'governance.blocked'
    and created_at > now() - interval '7 days';
  c := c || jsonb_build_object('key','governance_blocked_7d','level', case when n > 0 then 'info' else 'ok' end,'count',n,
         'detail','Відмови політики даних за 7 днів (очікувана поведінка, але варто знати)');

  select count(*), coalesce(jsonb_agg(provider), '[]'::jsonb) into n, d from office.provider_policies
  where max_data_class is not null and (verified_at is null or verified_at < now() - interval '75 days');
  c := c || jsonb_build_object('key','provider_policy_review','level', case when n = 0 then 'ok'
           when exists (select 1 from office.provider_policies where max_data_class is not null
                        and (verified_at is null or verified_at < now() - interval '90 days')) then 'fail' else 'warn' end,
         'count', n, 'providers', d, 'detail','Політики провайдерів потребують повторної перевірки (90 днів)');

  select count(*) into n from office.knowledge_docs where workspace_id = p_workspace and status = 'approved'
    and valid_until between (now() at time zone 'Europe/Kyiv')::date and (now() at time zone 'Europe/Kyiv')::date + 14;
  c := c || jsonb_build_object('key','knowledge_expiring_14d','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Затверджені знання, що спливають за 14 днів');
  select count(*) into n from office.knowledge_docs where workspace_id = p_workspace and status = 'approved'
    and valid_until < (now() at time zone 'Europe/Kyiv')::date;
  c := c || jsonb_build_object('key','knowledge_expired','level', case when n > 0 then 'info' else 'ok' end,'count',n,
         'detail','Прострочені знання (агентам уже не передаються)');

  select count(*) into n from office.knowledge_candidates where workspace_id = p_workspace and status = 'candidate'
    and created_at < now() - interval '7 days';
  c := c || jsonb_build_object('key','candidates_waiting_7d','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'detail','Кандидати в знання чекають рішення понад 7 днів');

  select count(*), coalesce(jsonb_agg(label), '[]'::jsonb) into n, d from office.executors
  where workspace_id = p_workspace and revoked_at is null and cardinality(allowed_seats) > 0
    and (last_seen_at is null or last_seen_at < now() - interval '7 days');
  c := c || jsonb_build_object('key','executors_silent_7d','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
         'executors', d, 'detail','Виконавці з ролями, що не зверталися 7 днів');

  select count(*) into n from office.events where workspace_id = p_workspace and kind = 'cmo_sync.failed'
    and created_at > now() - interval '7 days';
  c := c || jsonb_build_object('key','cmo_sync_failed_7d','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Затверджені пакети, які не потрапили в CMO Space');

  if v_cmo = 'pavutyna-cmo' then
    select count(*) into n from cmo.agent_runs where status = 'failed' and started_at > now() - interval '24 hours';
    c := c || jsonb_build_object('key','cmo_agents_failed_24h','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
           'detail','Агенти CMO Space, що впали за добу');
    select count(*) into n from cmo.agent_runs where status = 'running' and started_at < now() - interval '2 hours';
    c := c || jsonb_build_object('key','cmo_agents_stale','level', case when n > 0 then 'warn' else 'ok' end,'count',n,
           'detail','Запуски агентів CMO Space, що «висять» понад 2 год');
  end if;

  c := c || office.qa_routing_checks(p_workspace);

  return jsonb_build_object(
    'schema_version', 'QaReport.v1',
    'generated_at', now(),
    'workspace', (select slug from office.workspaces where id = p_workspace),
    'status', (select case max(case x->>'level' when 'fail' then 3 when 'warn' then 2 when 'info' then 1 else 0 end)
                 when 3 then 'fail' when 2 then 'warn' when 1 then 'info' else 'ok' end from jsonb_array_elements(c) x),
    'checks', c);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Privileges
-- ---------------------------------------------------------------------------
revoke all on function office.provider_available(uuid, text), office.trigger_terminal(text),
  office.channel_paused(office.trigger_channels), office.channel_quiet(office.trigger_channels), office.channel_today(uuid),
  office.executor_tripped(uuid), office.route_candidate(office.steps, text, boolean),
  office.route_unusable_reason(office.steps, text), office.router_tick(), office.trigger_mark(uuid, text, jsonb),
  office.trigger_dispatch(int), office.trigger_report(uuid, jsonb), office.trigger_expire(), office.trigger_attempt_hook(),
  office.set_provider_limit(uuid, text, timestamptz, text), office.clear_provider_limit(uuid, text),
  office.set_channel_enabled(uuid, boolean), office.resume_channel(uuid), office.set_executor_verified(uuid, boolean, text),
  office.set_triggers_enabled(uuid, boolean), office.routing_state(uuid), office.qa_routing_checks(uuid),
  office.qa_checks(uuid)
  from public, anon, authenticated, service_role, office_app;
grant execute on function office.router_tick(), office.trigger_dispatch(int), office.trigger_report(uuid, jsonb),
  office.trigger_expire() to office_app;
grant execute on function office.set_provider_limit(uuid, text, timestamptz, text), office.clear_provider_limit(uuid, text),
  office.set_channel_enabled(uuid, boolean), office.resume_channel(uuid), office.set_executor_verified(uuid, boolean, text),
  office.set_triggers_enabled(uuid, boolean), office.routing_state(uuid) to authenticated;
