-- 0013: submit falls back to the caller's own active lease; late adapter failures after a claim do not fail the trigger.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

insert into t.tok values
  ('sf_gpt', office.create_executor('gtu', 'chatgpt', 'Fallback ChatGPT')),
  ('sf_gpt2', office.create_executor('gtu', 'chatgpt', 'Fallback ChatGPT 2'));
update office.executors x set allowed_seats = (select array_agg(a.role_key) from office.agents a where a.workspace_id = x.workspace_id)
where name in ('Fallback ChatGPT', 'Fallback ChatGPT 2');
insert into office.briefs (id, workspace_id, title, objective, status)
select '0000000a-0000-4000-8000-000000000080', v, 'Fallback brief', 'Перевірити здачу', 'active' from t.ids where k = 'ws_b';
insert into office.runs (id, workspace_id, brief_id, playbook_key, status, budget_usd, idempotency_key)
select '0000000b-0000-4000-8000-000000000080', v, '0000000a-0000-4000-8000-000000000080', 'reels_concepts', 'running', 1, 'fallback-run-0080'
from t.ids where k = 'ws_b';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select ('0000000c-0000-4000-8000-0000000008' || n)::uuid, '0000000b-0000-4000-8000-000000000080', v, 'step_' || chr(87 + n), 'strategist',
       'awaiting_agent', 'chatgpt', jsonb_build_object('schemaName', 'strategy', 'system', 's', 'user', 'u' || n, 'jsonSchema', '{"type":"object"}'::jsonb)
from t.ids, generate_series(10, 13) n where k = 'ws_b';
create table t.sf (k text primary key, c jsonb);
grant select, insert on t.sf to public;

set role office_app;
insert into t.sf select 'a', office.gateway_claim(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000810');
insert into t.sf select 'b', office.gateway_claim(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000811');
insert into t.sf select 'c', office.gateway_claim(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000812');
reset role;

set role office_app;
select t.ok('exact attempt + lease is accepted without fallback',
  (office.gateway_submit_step(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000810', (c->>'attempt_id')::uuid, c->>'lease_token', '{"ok":1}')->>'accepted')::boolean)
from t.sf where k = 'a';
select t.ok('altered lease token: own active lease on the task is used',
  (office.gateway_submit_step(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000811', (c->>'attempt_id')::uuid, 'mangled-token-xxxxxxxx', '{"ok":2}')->>'accepted')::boolean)
from t.sf where k = 'b';
select t.ok('missing attempt id and token: still the own active lease',
  (office.gateway_submit_step(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000812', null, null, '{"ok":3}')->>'accepted')::boolean);
select t.throws('another executor cannot submit through the fallback',
  $q$select office.gateway_submit_step(t.h('sf_gpt2'), '0000000c-0000-4000-8000-000000000813', null, null, '{"x":1}')$q$, 'P0002');
select t.throws('no active lease → not_found', $q$select office.gateway_submit_step(t.h('sf_gpt'), '0000000c-0000-4000-8000-000000000813', null, null, '{"x":1}')$q$, 'P0002');
select t.throws('old gateway_submit stays strict', format($q$select office.gateway_submit(t.h('sf_gpt'), %L, 'wrong-token-xxxxxxxxxx', '{"x":1}')$q$,
  (select c->>'attempt_id' from t.sf where k = 'a')), 'P0002');
reset role;
select t.ok('fallbacks journaled (2), exact path not', (select count(*) = 2 from office.events where kind = 'gateway.lease_fallback'
  and run_id = '0000000b-0000-4000-8000-000000000080'));
select t.ok('submitted attempts recorded', (select count(*) = 3 from office.execution_attempts
  where run_id = '0000000b-0000-4000-8000-000000000080' and state = 'submitted'));

-- Late adapter failure after a claim is history, not an outcome.
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select v, 'sf-chatgpt', 'chatgpt_agent', t.ex('Fallback ChatGPT 2'), true, '{"env_prefix":"CHATGPT_AGENT"}' from t.ids where k = 'ws_b';
insert into office.trigger_runs (workspace_id, channel_id, step_id, run_id, request_hash, attempt_no, last_event)
select w.v, c.id, '0000000c-0000-4000-8000-000000000813', '0000000b-0000-4000-8000-000000000080', 'h', 1, 'task_claimed'
from t.ids w, office.trigger_channels c where w.k = 'ws_b' and c.label = 'sf-chatgpt';
select office.trigger_report(t2.id, '{"result":"retryable","status":409}') from office.trigger_runs t2
  where t2.step_id = '0000000c-0000-4000-8000-000000000813';
select t.ok('409 after claim does not fail the trigger run or count for the breaker',
  (select t2.last_event = 'task_claimed' from office.trigger_runs t2 where t2.step_id = '0000000c-0000-4000-8000-000000000813')
  and (select consecutive_failures = 0 from office.trigger_channels where label = 'sf-chatgpt')
  and exists (select 1 from office.trigger_events e join office.trigger_runs t2 on t2.id = e.trigger_run_id
              where t2.step_id = '0000000c-0000-4000-8000-000000000813' and e.data->>'late' = 'true'));

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Submit fallback SQL tests failed'; end if;
end $$;
