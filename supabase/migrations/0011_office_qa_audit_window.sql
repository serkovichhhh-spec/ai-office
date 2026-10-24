-- AI Office 1.0.1: QA false positive — attempts claimed before the transfer audit (0008) are not gaps.
-- Same signature; body identical to 0010 except the transfer_audit_gap filter.

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
    -- Only attempts made after the transfer audit existed (0008); older ones were never audited.
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

  return jsonb_build_object(
    'schema_version', 'QaReport.v1',
    'generated_at', now(),
    'workspace', (select slug from office.workspaces where id = p_workspace),
    'status', (select case max(case x->>'level' when 'fail' then 3 when 'warn' then 2 when 'info' then 1 else 0 end)
                 when 3 then 'fail' when 2 then 'warn' when 1 then 'info' else 'ok' end from jsonb_array_elements(c) x),
    'checks', c);
end $$;
