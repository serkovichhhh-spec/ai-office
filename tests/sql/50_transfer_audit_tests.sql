-- 0009 regression: audit deduplication includes the operation, through real gateways.
\set ON_ERROR_STOP on
\o /dev/null
truncate t.results;

insert into office.briefs(id, workspace_id, title, objective)
select '0000000a-0000-4000-8000-000000000060', v, 'Transfer audit test', 'Separate GET and CLAIM audit' from t.ids where k='ws_a';
insert into office.runs(id, workspace_id, brief_id, playbook_key, budget_usd, idempotency_key, status)
select '0000000b-0000-4000-8000-000000000060', v, '0000000a-0000-4000-8000-000000000060', 'research_brief', 0, 'transfer-audit-0060', 'running'
from t.ids where k='ws_a';
insert into office.steps(id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select '0000000c-0000-4000-8000-000000000060', '0000000b-0000-4000-8000-000000000060', v,
 'transfer_audit', 'copywriter', 'awaiting_agent', 'claude_session',
 '{"schemaName":"copy","system":"Test role","user":"Synthetic fixture","jsonSchema":{"type":"object"},"governance":{"data_class":"internal","knowledge_refs":[],"excluded_count":0}}'
from t.ids where k='ws_a';
insert into t.tok select 'transfer_audit', office.create_executor('pavutyna', 'claude_session', 'Transfer audit regression');
update office.executors set allowed_seats=array['copywriter'] where name='Transfer audit regression';

set role office_app;
insert into t.tok select 'transfer_get_1', office.gateway_get(t.h('transfer_audit'), '0000000c-0000-4000-8000-000000000060')::text;
insert into t.tok select 'transfer_get_2', office.gateway_get(t.h('transfer_audit'), '0000000c-0000-4000-8000-000000000060')::text;
reset role;
select t.ok('two GETs return the same task envelope',
 (select v::jsonb->>'task_id'='0000000c-0000-4000-8000-000000000060' and v::jsonb->>'claimable'='true' from t.tok where k='transfer_get_1')
 and (select v::jsonb=(select v::jsonb from t.tok where k='transfer_get_1') from t.tok where k='transfer_get_2'));
select t.ok('two GETs within 10 minutes create exactly one GET transfer',
 (select count(*)=1 and bool_and(op='get') from office.external_transfers where step_id='0000000c-0000-4000-8000-000000000060'));

set role office_app;
insert into t.tok select 'transfer_claim', office.gateway_claim(t.h('transfer_audit'), '0000000c-0000-4000-8000-000000000060')::text;
reset role;
select t.ok('CLAIM after GET succeeds for the same task',
 (select v::jsonb->>'claimed'='true' and v::jsonb->'envelope'->>'task_id'='0000000c-0000-4000-8000-000000000060' from t.tok where k='transfer_claim'));
select t.ok('GET then CLAIM keep separate audit rows for the same executor and envelope',
 (select count(*)=2 and count(*) filter(where op='get')=1 and count(*) filter(where op='claim')=1
   and count(distinct executor_id)=1 and count(distinct envelope_sha256)=1
   and bool_and(provider='anthropic' and data_class='internal' and at > now()-interval '10 minutes')
  from office.external_transfers where step_id='0000000c-0000-4000-8000-000000000060'));

\o
select id, case when ok then 'PASS' else 'FAIL' end as result, name from t.results;
select count(*) filter(where ok) as passed, count(*) filter(where not ok) as failed from t.results;
do $$ begin if exists(select 1 from t.results where not ok) then
 raise exception 'Transfer audit regression failed';
end if; end $$;
