-- AI Office 1.2.0
-- 1) Agents no longer lose a task they already hold: claim of the executor's own active task resumes it with a fresh
--    lease token; the task list shows the executor's own active tasks (yours=true, attempt_id).
-- 2) CMO Space → AI Office: a CMO Space task assigned to «AI Office» (open lane) becomes a brief and a run
--    (cmo_brief_diagnosis@1 by default) once; the link is kept in office.cmo_task_links. CMO Space schema unchanged:
--    tasks are only READ; results still go back through cmo.agent_upsert ('execution') with the CMO task id.
-- Additive. Kill switch: settings cmo_import_enabled.

create or replace function office.gateway_claim(p_token_hash text, p_step uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; s office.steps; a office.execution_attempts; v_token text; v_attempt uuid; v_expires timestamptz; v_env jsonb;
begin
  e := office.gateway_executor(p_token_hash, 'claim');
  perform office.gateway_expire();
  if p_step is null then
    select st.* into s from office.steps st join office.runs r on r.id = st.run_id and r.status = 'running'
    where office.gateway_eligible(e, st) and office.gateway_policy_ok(e, st)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
    order by st.created_at for update of st skip locked limit 1;
    if not found then
      if exists(select 1 from office.steps st join office.runs r on r.id=st.run_id and r.status='running'
        where office.gateway_eligible(e,st) and office.knowledge_refs_expired(st)) then
        return jsonb_build_object('claimed',false,'reason','knowledge_expired');
      end if;
      return jsonb_build_object('claimed',false,'reason','no_tasks');
    end if;
  else
    select * into s from office.steps where id = p_step for update;
    if not found or s.workspace_id <> e.workspace_id then raise exception 'task not found' using errcode = 'P0002'; end if;
    if not office.gateway_independent(e, s) then
      return jsonb_build_object('claimed', false, 'reason', 'not_independent');
    end if;
    if not office.gateway_eligible(e, s) then
      return jsonb_build_object('claimed', false, 'reason', 'not_assigned_to_you_or_not_waiting');
    end if;
    if not office.gateway_policy_ok(e, s) then
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'governance.blocked', 'idle',
        jsonb_build_object('executor_label', e.label, 'provider', e.provider, 'op', 'claim'));
      return jsonb_build_object('claimed', false, 'reason', office.gateway_policy_reason(e,s));
    end if;
    -- 0015: the executor's OWN active lease → resume it with a fresh lease token (agents lose long tokens).
    select * into a from office.execution_attempts x
    where x.step_id = s.id and x.executor_id = e.id and x.state = 'claimed' and x.lease_expires_at > now()
    for update;
    if found then
      v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
      v_expires := now() + make_interval(mins => e.lease_minutes);
      update office.execution_attempts set lease_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
        lease_expires_at = v_expires where id = a.id;
      v_env := office.gateway_envelope(s.id);
      perform office.record_transfer(e, s, 'claim', v_env);
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.resumed', 'idle',
        jsonb_build_object('step', s.step_key, 'attempt_id', a.id, 'executor_label', e.label, 'lease_expires_at', v_expires));
      return jsonb_build_object('claimed', true, 'resumed', true, 'attempt_id', a.id, 'lease_token', v_token,
                                'lease_expires_at', v_expires, 'envelope', v_env);
    end if;
    if exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed') then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(mins => e.lease_minutes);
  insert into office.execution_attempts (step_id, run_id, workspace_id, executor_id, lease_token_hash, lease_expires_at, input_hashes)
  values (s.id, s.run_id, s.workspace_id, e.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires,
          office.run_input_hashes(s.run_id))
  returning id into v_attempt;
  v_env := office.gateway_envelope(s.id);
  perform office.record_transfer(e, s, 'claim', v_env);
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.claimed',
    office.activity_for_role(s.agent_role),
    jsonb_build_object('step', s.step_key, 'attempt_id', v_attempt, 'executor', e.kind, 'executor_name', e.name,
                       'executor_id', e.id, 'executor_label', e.label, 'lease_expires_at', v_expires));
  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt, 'lease_token', v_token, 'lease_expires_at', v_expires,
                            'envelope', v_env);
end $$;

create or replace function office.gateway_list(p_token_hash text, p_limit int default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors;
begin
  e := office.gateway_executor(p_token_hash, 'list');
  perform office.gateway_expire();
  return coalesce((
    select jsonb_agg(t order by (t->>'yours')::boolean desc, t->>'waiting_since') from (
      -- own active tasks first (resume them with office_claim_task + task_id)
      select jsonb_build_object('step_id', s.id, 'seat', s.agent_role, 'step', s.step_key,
        'brief_title', b.title, 'workspace', w.name, 'waiting_since', s.created_at,
        'schema', s.agent_request->>'schemaName', 'retry_note', s.agent_request->>'note',
        'yours', true, 'attempt_id', x.id, 'lease_expires_at', x.lease_expires_at) as t
      from office.execution_attempts x
      join office.steps s on s.id = x.step_id and s.status = 'awaiting_agent'
      join office.runs r on r.id = s.run_id and r.status = 'running'
      join office.briefs b on b.id = r.brief_id
      join office.workspaces w on w.id = s.workspace_id and w.status = 'active'
      where x.executor_id = e.id and x.state = 'claimed' and x.lease_expires_at > now()
      union all
      (select jsonb_build_object('step_id', s.id, 'seat', s.agent_role, 'step', s.step_key,
        'brief_title', b.title, 'workspace', w.name, 'waiting_since', s.created_at,
        'schema', s.agent_request->>'schemaName', 'retry_note', s.agent_request->>'note', 'yours', false) as t
      from office.steps s
      join office.runs r on r.id = s.run_id and r.status = 'running'
      join office.briefs b on b.id = r.brief_id
      join office.workspaces w on w.id = s.workspace_id and w.status = 'active'
      where office.gateway_eligible(e, s) and office.gateway_policy_ok(e, s)
        and not exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed')
      order by s.created_at
      limit least(greatest(p_limit, 1), 20))) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- CMO Space → AI Office import
-- ---------------------------------------------------------------------------
create table if not exists office.cmo_task_links (
  workspace_id uuid not null references office.workspaces(id) on delete cascade,
  cmo_task_id text not null,
  brief_id uuid references office.briefs(id) on delete set null,
  run_id uuid references office.runs(id) on delete set null,
  imported_version int,
  imported_at timestamptz not null default now(),
  status text not null default 'imported' check (status in ('imported','skipped','failed')),
  note text,
  primary key (workspace_id, cmo_task_id)
);
alter table office.cmo_task_links enable row level security;
revoke all on office.cmo_task_links from public, anon, authenticated, service_role, office_app;
grant select on office.cmo_task_links to authenticated;
create policy cmo_task_links_read on office.cmo_task_links for select to authenticated using (office.is_member(workspace_id));

insert into office.settings (workspace_id, key, value) values
  (null, 'cmo_import_enabled', 'true'),
  (null, 'cmo_import_assignee', '"AI Office"'),
  (null, 'cmo_import_playbook', '"cmo_brief_diagnosis"'),
  (null, 'cmo_import_daily_cap', '10')
on conflict do nothing;

-- Tasks that existed before this release are never imported retroactively («починаємо з нуля»).
insert into office.cmo_task_links (workspace_id, cmo_task_id, imported_version, status, note)
select w.id, t.source_id, t.version, 'skipped', 'existed before 0015'
from office.workspaces w join cmo.tasks t on t.workspace_key = w.cmo_workspace_key
where w.cmo_workspace_key is not null
on conflict do nothing;

create or replace function office.cmo_import_tick(p_limit int default 3) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w record; t record; v_owner uuid; v_brief uuid; v_run uuid; v_assignee text; v_playbook text; v_desc text;
        v_claims text; n int := 0; v_today int; v_cap int;
begin
  if not coalesce((office.setting(null, 'cmo_import_enabled'))::boolean, false) then
    return jsonb_build_object('disabled', true);
  end if;
  v_claims := current_setting('request.jwt.claims', true);
  for w in select * from office.workspaces where status = 'active' and cmo_workspace_key is not null loop
    v_assignee := coalesce(office.setting(w.id, 'cmo_import_assignee')->>0, 'AI Office');
    v_playbook := coalesce(office.setting(w.id, 'cmo_import_playbook')->>0, 'cmo_brief_diagnosis');
    v_cap := coalesce((office.setting(w.id, 'cmo_import_daily_cap'))::int, 10);
    select count(*) into v_today from office.cmo_task_links l where l.workspace_id = w.id and l.status = 'imported'
      and l.imported_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv');
    select m.user_id into v_owner from office.workspace_members m where m.workspace_id = w.id and m.role = 'owner'
      order by m.user_id limit 1;
    continue when v_owner is null;
    for t in
      select ct.* from cmo.tasks ct
      where ct.workspace_key = w.cmo_workspace_key
        and coalesce(ct.runtime_payload->>'assignee', ct.assignee_name) = v_assignee
        and coalesce(ct.runtime_payload->>'lane', ct.lane) in ('backlog','todo','ready','progress')
        and not exists (select 1 from office.cmo_task_links l where l.workspace_id = w.id and l.cmo_task_id = ct.source_id)
      order by coalesce(ct.source_created_at, ct.imported_at)
      limit greatest(p_limit, 1)
    loop
      exit when v_today >= v_cap or n >= greatest(p_limit, 1);
      v_desc := nullif(btrim(coalesce(t.runtime_payload->>'description', t.description, '')), '');
      begin
        -- Act as the workspace owner for the standard, validated brief → run path.
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
        v_brief := office.create_brief(w.id, jsonb_build_object(
          'title', left(coalesce(t.runtime_payload->>'title', t.title), 200),
          'objective', left(coalesce(v_desc, coalesce(t.runtime_payload->>'title', t.title)) ||
                            E'\n\n(Задача з CMO Space, ' || t.source_id || ')', 4000),
          'deliverable_count', 1,
          'priority', case lower(coalesce(t.runtime_payload->>'priority', t.priority, '')) when 'high' then 'high' when 'low' then 'low' else 'medium' end,
          'channel', coalesce(t.runtime_payload->>'label', t.label, ''),
          'playbook_key', v_playbook, 'playbook_version', 1,
          'fields', jsonb_build_object('cmo_task_id', t.source_id, 'cmo_label', coalesce(t.runtime_payload->>'label', t.label),
                                       'cmo_due', coalesce(t.runtime_payload->>'due', t.due_text))));
        v_run := office.submit_brief(v_brief, 'cmo-task-' || t.source_id);
        insert into office.cmo_task_links (workspace_id, cmo_task_id, brief_id, run_id, imported_version, status)
        values (w.id, t.source_id, v_brief, v_run, t.version, 'imported');
        perform office.log_event(w.id, v_run, null, 'system', null, null, 'cmo_import.created', 'planning',
          jsonb_build_object('cmo_task_id', t.source_id, 'title', coalesce(t.runtime_payload->>'title', t.title), 'playbook', v_playbook));
        n := n + 1; v_today := v_today + 1;
      exception when others then
        insert into office.cmo_task_links (workspace_id, cmo_task_id, imported_version, status, note)
        values (w.id, t.source_id, t.version, 'failed', left(sqlerrm, 300))
        on conflict (workspace_id, cmo_task_id) do update set status = 'failed', note = excluded.note, imported_at = now();
        perform office.log_event(w.id, null, null, 'system', null, null, 'cmo_import.failed', 'blocked',
          jsonb_build_object('cmo_task_id', t.source_id, 'error', left(sqlerrm, 300)));
      end;
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    end loop;
  end loop;
  return jsonb_build_object('imported', n);
end $$;

-- The CMO Space «Виконання» record of an imported task carries its CMO task id.
create or replace function office.cmo_stream_record_extra(p_run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('cmoTaskId', l.cmo_task_id) from office.cmo_task_links l where l.run_id = p_run limit 1), '{}'::jsonb)
$$;

-- 0010 sync, plus cmoTaskId for imported tasks.
create or replace function office.cmo_sync_handoff() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text; v_slug text; v_pkg jsonb; v_rec jsonb; v_res jsonb; v_url text; v_playbook text;
begin
  if not coalesce((office.setting(new.workspace_id, 'cmo_sync_enabled'))::boolean, false) then return new; end if;
  select w.cmo_workspace_key, w.slug into v_key, v_slug from office.workspaces w where w.id = new.workspace_id;
  if v_key is distinct from 'pavutyna-cmo' then return new; end if;
  begin
    v_pkg := new.payload->'approved_artifact'->'content';
    v_playbook := coalesce(v_pkg->>'playbook', (select r.playbook_key from office.runs r where r.id = new.run_id));
    v_url := coalesce(office.setting(new.workspace_id, 'app_url')#>>'{}', '') || '/w/' || v_slug || '/runs/' || new.run_id;
    v_rec := jsonb_build_object(
      'id', 'aio-' || new.id,
      'title', left('AI Office: ' || coalesce(new.payload->'brief'->>'title', 'затверджений пакет'), 200),
      'brand', 'PAVUTYNA',
      'owner', 'Діма',
      'status', 'Not started',
      'stream', office.cmo_stream_for(v_playbook),
      'priority', 'P2',
      'deadline', coalesce(left(new.payload->'brief'->>'deadline', 10), ''),
      'deliverable', left('Затверджений пакет «' || coalesce(v_pkg->>'playbook', v_playbook, '') || '»: '
                          || coalesce(new.payload->'brief'->>'objective', ''), 500),
      'acceptance', left(coalesce((select string_agg(x, '; ') from jsonb_array_elements_text(
                                    coalesce(new.payload->'brief'->'acceptance_criteria', '[]'::jsonb)) x), ''), 500),
      'url', v_url,
      'decision', 'Погоджено в AI Office',
      'sourceNote', 'Створено AI Office після затвердження власником. Пакет і докази — за посиланням.',
      'aiOffice', jsonb_build_object('run_id', new.run_id, 'handoff_id', new.id, 'playbook', v_playbook,
                                     'artifact_id', new.payload->'approved_artifact'->>'id'))
             || office.cmo_stream_record_extra(new.run_id);
    v_res := cmo.agent_upsert('execution', jsonb_build_array(v_rec), 'ai_office');
    perform office.log_event(new.workspace_id, new.run_id, null, 'system', null, null, 'cmo_sync.done', 'delivering',
      jsonb_build_object('handoff_id', new.id, 'cmo_record', 'aio-' || new.id, 'result', v_res));
  exception when others then
    perform office.log_event(new.workspace_id, new.run_id, null, 'system', null, null, 'cmo_sync.failed', 'blocked',
      jsonb_build_object('handoff_id', new.id, 'error', left(sqlerrm, 300), 'sqlstate', sqlstate));
  end;
  return new;
end $$;

revoke all on function office.gateway_list(text, int), office.gateway_claim(text, uuid), office.cmo_import_tick(int),
  office.cmo_stream_record_extra(uuid), office.cmo_sync_handoff() from public, anon, authenticated, service_role, office_app;
grant execute on function office.gateway_list(text, int), office.gateway_claim(text, uuid), office.cmo_import_tick(int) to office_app;
