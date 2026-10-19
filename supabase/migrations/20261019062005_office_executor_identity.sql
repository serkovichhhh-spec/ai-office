-- Stage 0. Additive executor identity. Existing token hashes and leases are preserved.
begin;
alter table office.executors
  add column label text,
  add column capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  add column mode text not null default 'interactive' check (mode in ('interactive','triggered'));
with numbered as (
  select id, kind, row_number() over (partition by workspace_id, kind order by created_at, id) n
  from office.executors
)
update office.executors e set label =
  (case n.kind when 'chatgpt' then 'chatgpt_cmo' when 'claude_session' then 'claude_main' else 'human' end)
  || case when n.n = 1 then '' else '_' || n.n::text end
from numbered n where n.id = e.id;
alter table office.executors alter column label set not null;
alter table office.executors add constraint executor_label_format check (label ~ '^[a-z][a-z0-9_]{1,63}$');
alter table office.executors add constraint executor_label_unique unique (workspace_id, label);
create function office.executor_label_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.label is null then new.label := new.kind || '_' || replace(new.id::text, '-', ''); end if;
  return new;
end $$;
create trigger executor_label_default before insert on office.executors
  for each row execute function office.executor_label_default();
grant select (label, capabilities, mode, allowed_seats) on office.executors to authenticated;

alter table office.steps
  add column independent_of_step uuid references office.steps(id),
  add column requires text[] not null default '{}';
create function office.step_independence_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.independent_of_step is not null and not exists (
    select 1 from office.steps s where s.id = new.independent_of_step
      and s.run_id = new.run_id and s.workspace_id = new.workspace_id and s.id <> new.id
  ) then raise exception 'independent author must be in the same run' using errcode = '22023'; end if;
  return new;
end $$;
create trigger step_independence_scope before insert or update on office.steps
  for each row execute function office.step_independence_scope();

-- Only the owner can attest capabilities and assign seats. Models cannot self-attest.
create function office.configure_executor(p_executor uuid, p_label text, p_seats text[], p_capabilities jsonb, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare e office.executors; k text; v jsonb;
begin
  select * into e from office.executors where id = p_executor for update;
  if not found or not office.has_role(e.workspace_id, array['owner']) then
    raise exception 'only owner can configure executor' using errcode = '42501'; end if;
  if e.revoked_at is not null then raise exception 'executor revoked' using errcode = '55000'; end if;
  if p_label is null or p_label !~ '^[a-z][a-z0-9_]{1,63}$' or p_mode is null or p_mode not in ('interactive','triggered')
    or p_capabilities is null or jsonb_typeof(p_capabilities) <> 'object' then
    raise exception 'invalid executor configuration' using errcode = '22023'; end if;
  if p_seats is not null and (cardinality(p_seats) > 32 or exists (
    select 1 from unnest(p_seats) seat where seat is null or not exists (
      select 1 from office.agents a where a.workspace_id = e.workspace_id and a.role_key = seat
    )
  )) then raise exception 'unknown workspace seat' using errcode = '22023'; end if;
  for k,v in select * from jsonb_each(p_capabilities) loop
    if k !~ '^[a-z][a-z0-9_]{1,63}$' or jsonb_typeof(v) <> 'object' then
      raise exception 'invalid capability' using errcode = '22023'; end if;
    if v->>'verified_at' is not null then
      if (v->>'verified_at')::timestamptz > now() or length(trim(coalesce(v->>'evidence',''))) < 3 then
        raise exception 'capability needs dated evidence' using errcode = '22023'; end if;
    end if;
  end loop;
  update office.executors set label = p_label, allowed_seats = p_seats, capabilities = p_capabilities, mode = p_mode where id = e.id;
  perform office.log_event(e.workspace_id,null,null,'user',auth.uid(),null,'executor.configured','idle',
    jsonb_build_object('executor_id',e.id,'label',p_label,'seats',p_seats,'capabilities',p_capabilities,'mode',p_mode));
end $$;

-- Seven-argument endpoint is explicit. No defaults, so the old 5-arg wrapper is unambiguous.
create function office.oauth_authorize(p_client_id text, p_redirect_uri text, p_code_challenge text,
                                       p_workspace uuid, p_kind text, p_executor uuid, p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare c office.oauth_clients; e office.executors; v_exec uuid; v_code text := office.random_token('aio_code_');
begin
  if not office.has_role(p_workspace, array['owner']) then
    raise exception 'only the workspace owner can connect executors' using errcode = '42501'; end if;
  select * into c from office.oauth_clients where id = p_client_id;
  if not found or p_redirect_uri is null or not (p_redirect_uri = any(c.redirect_uris)) then
    raise exception 'unknown client or redirect_uri' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('claude_session','chatgpt') then
    raise exception 'invalid executor kind' using errcode = '22023'; end if;
  if p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'PKCE S256 code_challenge required' using errcode = '22023'; end if;
  if p_executor is null then
    if p_label is null or p_label !~ '^[a-z][a-z0-9_]{1,63}$' then
      raise exception 'executor label required' using errcode = '22023'; end if;
    insert into office.executors (workspace_id,kind,name,label,oauth_client_id,lease_minutes)
      values (p_workspace,p_kind,p_label,p_label,c.id,case when p_kind = 'chatgpt' then 240 else 30 end)
      returning id into v_exec;
  else
    select * into e from office.executors where id = p_executor for update;
    if not found or e.workspace_id <> p_workspace or e.kind <> p_kind or e.revoked_at is not null then
      raise exception 'executor not available for reconnect' using errcode = '42501'; end if;
    v_exec := e.id;
  end if;
  insert into office.oauth_codes (code_hash,client_id,executor_id,redirect_uri,code_challenge,expires_at)
    values (office.sha256_hex(v_code),c.id,v_exec,p_redirect_uri,p_code_challenge,now() + interval '5 minutes');
  perform office.log_event(p_workspace,null,null,'user',auth.uid(),null,'executor.authorized','idle',
    jsonb_build_object('executor_id',v_exec,'kind',p_kind,'client',c.name,'reconnect',p_executor is not null));
  return v_code;
end $$;
create or replace function office.oauth_authorize(p_client_id text,p_redirect_uri text,p_code_challenge text,p_workspace uuid,p_kind text)
returns text language sql security definer set search_path = '' as $$
  select office.oauth_authorize(p_client_id,p_redirect_uri,p_code_challenge,p_workspace,p_kind,null,
    coalesce(p_kind,'executor') || '_' || replace(gen_random_uuid()::text,'-',''))
$$;

-- Check every current source artifact, not only the nominated build step. Old review
-- cycles do not poison the next owner's revision. A known concrete identity wins over kind.
create function office.executor_independent(e office.executors, s office.steps) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.independent_of_step is null or not exists (
    select 1 from office.steps author
    where author.run_id = s.run_id and (
      author.id = s.independent_of_step or author.id in (
        select a.step_id from office.artifacts a
        where a.run_id = s.run_id and a.kind in ('prepare','build','concepts','scripts','design_specs')
          and author.agent_role in ('creative','creative_director','copywriter','graphic_designer','print_designer','scriptwriter','content_maker','smm')
          and a.version = (select max(a2.version) from office.artifacts a2 where a2.run_id=a.run_id and a2.kind=a.kind)
      )
    ) and author.created_at >= coalesce((select max(x.created_at) from office.steps x
      where x.run_id=s.run_id and x.step_key='revision_intake' and x.created_at <= s.created_at), '-infinity'::timestamptz)
    and (
      exists (select 1 from office.execution_attempts a where a.step_id=author.id
        and a.state in ('submitted','validated') and a.executor_id=e.id)
      or (not exists (select 1 from office.execution_attempts a where a.step_id=author.id and a.state in ('submitted','validated'))
        and coalesce(author.executor,'claude_session')=e.kind)
    )
  )
$$;
create or replace function office.gateway_eligible(e office.executors,s office.steps) returns boolean
language sql stable set search_path = '' as $$
  select s.status = 'awaiting_agent' and s.workspace_id=e.workspace_id
    and (coalesce(s.input->>'routing_policy'='capabilities',false) or coalesce(s.executor,'claude_session')=e.kind)
    and (e.allowed_seats is null or s.agent_role=any(e.allowed_seats))
    and not exists (select 1 from unnest(s.requires) c where
      nullif(e.capabilities->c->>'verified_at','') is null or nullif(trim(e.capabilities->c->>'evidence'),'') is null)
    and office.executor_independent(e,s)
$$;

create or replace function office.gateway_claim(p_token_hash text, p_step uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; s office.steps; v_token text; v_attempt uuid; v_expires timestamptz;
begin
  e := office.gateway_executor(p_token_hash, 'claim');
  perform office.gateway_expire();
  if p_step is null then
    select st.* into s from office.steps st join office.runs r on r.id = st.run_id and r.status = 'running'
    where office.gateway_eligible(e, st)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
    order by st.created_at for update of st skip locked limit 1;
    if not found then return jsonb_build_object('claimed', false, 'reason', 'no_tasks'); end if;
  else
    select * into s from office.steps where id = p_step for update;
    if not found or s.workspace_id <> e.workspace_id then raise exception 'task not found' using errcode = 'P0002'; end if;
    if not office.executor_independent(e,s) then raise exception 'not_independent' using errcode='42501'; end if;
    if office.gateway_eligible(e, s) is not true then
      return jsonb_build_object('claimed', false, 'reason', 'not_assigned_to_you_or_not_waiting');
    end if;
    if exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed') then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
  end if;

  if not exists (select 1 from office.runs r join office.workspaces w on w.id=r.workspace_id
    where r.id=s.run_id and r.status='running' and w.status='active') then
    return jsonb_build_object('claimed',false,'reason','run_not_active'); end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(mins => e.lease_minutes);
  insert into office.execution_attempts (step_id, run_id, workspace_id, executor_id, lease_token_hash, lease_expires_at, input_hashes)
  values (s.id, s.run_id, s.workspace_id, e.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires,
          office.run_input_hashes(s.run_id))
  returning id into v_attempt;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.claimed',
    office.activity_for_role(s.agent_role),
    jsonb_build_object('step', s.step_key, 'attempt_id', v_attempt, 'executor', e.kind, 'executor_name', e.name, 'lease_expires_at', v_expires));
  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt, 'lease_token', v_token, 'lease_expires_at', v_expires,
                            'envelope', office.gateway_envelope(s.id));
end $$;

create or replace function office.gateway_status(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors;
begin
  e := office.gateway_executor(p_token_hash, 'status');
  perform office.gateway_expire();
  return jsonb_build_object(
    'you', jsonb_build_object('executor_id',e.id,'label',e.label,'mode',e.mode,'capabilities',e.capabilities,'name', e.name, 'kind', e.kind, 'lease_minutes', e.lease_minutes),
    'workspace', (select name from office.workspaces where id = e.workspace_id),
    'waiting_for_you', (select count(*) from office.steps s where office.gateway_eligible(e, s)
                          and exists (select 1 from office.runs r where r.id = s.run_id and r.status = 'running')),
    'waiting_by_executor', coalesce((select jsonb_object_agg(k, n) from (
        select coalesce(s.executor, 'claude_session') k, count(*) n from office.steps s
        join office.runs r on r.id = s.run_id and r.status = 'running'
        where s.workspace_id = e.workspace_id and s.status = 'awaiting_agent' group by 1) q), '{}'::jsonb),
    'your_active_attempts', (select count(*) from office.execution_attempts x where x.executor_id = e.id and x.state = 'claimed'),
    'runs_waiting_for_owner', (select count(*) from office.runs r where r.workspace_id = e.workspace_id and r.status = 'needs_approval'));
end $$;
create or replace function office.gateway_whoami(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors;
begin
  select * into e from office.executors x
  where x.revoked_at is null and (x.token_hash = p_token_hash or x.id = (
      select t.executor_id from office.oauth_tokens t
      where t.token_hash = p_token_hash and t.kind = 'access' and t.revoked_at is null and t.expires_at > now()));
  if not found then raise exception 'invalid executor token' using errcode = '28000'; end if;
  update office.executors set last_seen_at = now() where id = e.id;
  return jsonb_build_object('workspace_slug',(select slug from office.workspaces where id=e.workspace_id),'executor_id', e.id, 'label',e.label,'mode',e.mode,'capabilities',e.capabilities, 'kind', e.kind, 'name', e.name, 'ops', to_jsonb(e.allowed_ops));
end $$;

create or replace function office.worker_complete(p_step uuid, p_worker text, p_attempt int, p_result jsonb)
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
    insert into office.steps (run_id, workspace_id, step_key, agent_role, cycle, depends_on, input, executor, independent_of_step, requires)
    values (r.id, r.workspace_id, ns->>'step_key', ns->>'agent_role',
      (select coalesce(max(cycle), 0) + 1 from office.steps where run_id = r.id and step_key = ns->>'step_key'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ns->'depends_on','[]'::jsonb)) x), '{}'),
      coalesce(ns->'input', '{}'::jsonb),
      case when ns->>'executor' in ('claude_session','chatgpt','human') then ns->>'executor' end,
      nullif(ns->>'independent_of_step','')::uuid,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ns->'requires','[]'::jsonb)) x),'{}'));
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

revoke all on function office.executor_label_default(),office.step_independence_scope(),
  office.executor_independent(office.executors,office.steps),
  office.configure_executor(uuid,text,text[],jsonb,text),
  office.oauth_authorize(text,text,text,uuid,text,uuid,text)
  from public,anon,authenticated,service_role,office_app;
grant execute on function office.configure_executor(uuid,text,text[],jsonb,text),
  office.oauth_authorize(text,text,text,uuid,text,uuid,text) to authenticated;
-- gateway_eligible is invoker inside the protected gateway; keep helper private to office_app.
grant execute on function office.executor_independent(office.executors,office.steps) to office_app;
commit;
