-- AI Office v1.0 release (2026-10-24): QA health report + CMO Space integration.
-- Additive only. No CMO Space schema change: writes go through the existing cmo.agent_upsert API.

insert into office.settings (workspace_id, key, value) values
  (null, 'cmo_sync_enabled', 'true'),
  (null, 'app_url', '"https://ai-office-red.vercel.app"')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. CMO Space integration: every approved package becomes a task in CMO Space «Виконання».
--    One record per handoff (stable id), written once; afterwards CMO Space owns it.
--    A failed sync never blocks the owner's approval — it is logged and reported by QA.
-- ---------------------------------------------------------------------------
create or replace function office.cmo_stream_for(p_playbook text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_playbook in ('owned_media_copy') then 'CRO / Website'
    when p_playbook in ('outdoor_print_pack','ooh_concepts') then 'BTL / OOH'
    when p_playbook in ('paid_media_campaign') then 'Performance'
    when p_playbook in ('campaign_analysis','competitor_analysis') then 'Analytics'
    when p_playbook in ('offer_launch','cmo_brief_diagnosis') then 'Product Marketing'
    else 'Brand / Creative' end
$$;

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
                                     'artifact_id', new.payload->'approved_artifact'->>'id'));
    v_res := cmo.agent_upsert('execution', jsonb_build_array(v_rec), 'ai_office');
    perform office.log_event(new.workspace_id, new.run_id, null, 'system', null, null, 'cmo_sync.done', 'delivering',
      jsonb_build_object('handoff_id', new.id, 'cmo_record', 'aio-' || new.id, 'result', v_res));
  exception when others then
    perform office.log_event(new.workspace_id, new.run_id, null, 'system', null, null, 'cmo_sync.failed', 'blocked',
      jsonb_build_object('handoff_id', new.id, 'error', left(sqlerrm, 300), 'sqlstate', sqlstate));
  end;
  return new;
end $$;

create or replace trigger handoffs_cmo_sync after insert on office.handoffs
  for each row execute function office.cmo_sync_handoff();

-- ---------------------------------------------------------------------------
-- 2. QA health report: one call answers «чи все працює». Levels: ok < info < warn < fail.
-- ---------------------------------------------------------------------------
create or replace function office.qa_checks(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := '[]'::jsonb; n int; d jsonb; v_cmo text;

  -- helper semantics inline: add(key, level, count, detail)
begin
  select cmo_workspace_key into v_cmo from office.workspaces where id = p_workspace;

  -- Worker: queued/ready work must be picked up within minutes.
  select count(*) into n from office.steps s join office.runs r on r.id = s.run_id
  where s.workspace_id = p_workspace and s.status = 'ready' and r.status = 'running'
    and coalesce(s.next_attempt_at, s.created_at) < now() - interval '15 minutes';
  c := c || jsonb_build_object('key','worker_backlog','level', case when n > 0 then 'fail' else 'ok' end,'count',n,
         'detail','Кроки в статусі ready довше 15 хв — воркер не обробляє чергу');

  -- Steps waiting for an executor.
  select count(*), coalesce(jsonb_object_agg(k, m), '{}'::jsonb) into n, d from (
    select coalesce(s.executor,'claude_session') k, count(*) m from office.steps s join office.runs r on r.id = s.run_id
    where s.workspace_id = p_workspace and s.status = 'awaiting_agent' and r.status = 'running'
      and greatest(s.created_at, s.next_attempt_at) < now() - interval '24 hours' group by 1) q;
  select coalesce(sum((value)::int), 0) into n from jsonb_each_text(d);
  c := c || jsonb_build_object('key','stuck_agent_steps','level', case when n = 0 then 'ok'
           when exists (select 1 from office.steps s where s.workspace_id = p_workspace and s.status = 'awaiting_agent'
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

  return jsonb_build_object(
    'schema_version', 'QaReport.v1',
    'generated_at', now(),
    'workspace', (select slug from office.workspaces where id = p_workspace),
    'status', (select case max(case x->>'level' when 'fail' then 3 when 'warn' then 2 when 'info' then 1 else 0 end)
                 when 3 then 'fail' when 2 then 'warn' when 1 then 'info' else 'ok' end from jsonb_array_elements(c) x),
    'checks', c);
end $$;

-- Owners read the report in the UI.
create or replace function office.qa_report(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not office.has_role(p_workspace, array['owner']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return office.qa_checks(p_workspace);
end $$;

-- The QA agent (scheduled task, server-side SQL) runs this: report + one journal event.
create or replace function office.qa_run(p_workspace_slug text, p_agent text default 'qa_agent') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v jsonb;
begin
  select id into v_ws from office.workspaces where slug = p_workspace_slug;
  if v_ws is null then raise exception 'workspace % not found', p_workspace_slug using errcode = 'P0002'; end if;
  v := office.qa_checks(v_ws);
  perform office.log_event(v_ws, null, null, 'system', null, null, 'qa.report',
    case v->>'status' when 'fail' then 'blocked' else 'idle' end,
    jsonb_build_object('status', v->>'status', 'agent', left(coalesce(p_agent, 'qa_agent'), 40),
      'problems', (select coalesce(jsonb_agg(jsonb_build_object('key', x->>'key', 'level', x->>'level', 'count', x->'count')), '[]'::jsonb)
                   from jsonb_array_elements(v->'checks') x where x->>'level' in ('warn','fail'))));
  return v;
end $$;

revoke all on function office.cmo_stream_for(text), office.cmo_sync_handoff(), office.qa_checks(uuid),
  office.qa_report(uuid), office.qa_run(text, text)
  from public, anon, authenticated, service_role, office_app;
grant execute on function office.qa_report(uuid) to authenticated;
