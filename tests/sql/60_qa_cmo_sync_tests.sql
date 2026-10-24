-- 0010: CMO Space sync of approved packages + QA health report.
-- Runs after all earlier tests (reuses schema t: ws_a = pavutyna with cmo_workspace_key, run_a approved in 10_).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

-- ---------- CMO Space sync ----------
select t.ok('approved package from 10_ landed in CMO Space «execution» once',
  (select count(*) = 1 from cmo.space_documents d, jsonb_array_elements(d.payload) e
   where d.key = 'execution' and e->>'id' = 'aio-' || (select id from office.handoffs where run_id = (select v from t.ids where k = 'run_a'))));
select t.ok('CMO record links back to the run, carries stream, owner and agent stamp',
  (select e->>'url' like 'https://ai-office-red.vercel.app/w/pavutyna/runs/%' and e->>'owner' = 'Діма' and e->>'status' = 'Not started'
          and e->>'agent' = 'ai_office' and e->'aiOffice'->>'run_id' = (select v::text from t.ids where k = 'run_a')
   from cmo.space_documents d, jsonb_array_elements(d.payload) e where d.key = 'execution' and e->>'id' like 'aio-%' limit 1));
select t.ok('sync logged as cmo_sync.done', exists (select 1 from office.events where kind = 'cmo_sync.done'));

-- A workspace without CMO link is never synced.
insert into t.ids select 'ws_nocmo', id from office.workspaces where slug = 'gtu';
select t.ok('gtu has no CMO link', (select cmo_workspace_key is null from office.workspaces where slug = 'gtu'));

-- Failure in CMO Space must not block the owner's approval.
alter function cmo.agent_upsert(text, jsonb, text) rename to agent_upsert_real;
create function cmo.agent_upsert(p_key text, p_records jsonb, p_agent text) returns jsonb
language plpgsql as $$ begin raise exception 'cmo is down'; end $$;
insert into office.approvals (id, workspace_id, run_id, artifact_id, artifact_hash, decision, approver_id)
select '0000000d-0000-4000-8000-000000000060', w.v, a.run_id, a.id, a.content_hash, 'approved', '11111111-1111-4111-8111-111111111111'
from t.ids w, office.artifacts a where w.k = 'ws_a' and a.id = (select v from t.ids where k = 'art_a');
insert into office.handoffs (workspace_id, run_id, approval_id, payload, idempotency_key)
select w.v, (select v from t.ids where k = 'run_a'), '0000000d-0000-4000-8000-000000000060',
       '{"brief":{"title":"Збій CMO"},"approved_artifact":{"content":{"playbook":"owned_media_copy"}}}', 'handoff:test-60'
from t.ids w where w.k = 'ws_a';
select t.ok('handoff saved although CMO Space failed', exists (select 1 from office.handoffs where idempotency_key = 'handoff:test-60'));
select t.ok('failure logged as cmo_sync.failed with the error',
  exists (select 1 from office.events where kind = 'cmo_sync.failed' and payload->>'error' like '%cmo is down%'));
drop function cmo.agent_upsert(text, jsonb, text);
alter function cmo.agent_upsert_real(text, jsonb, text) rename to agent_upsert;

-- Flag off → no sync, no event.
update office.settings set value = 'false' where workspace_id is null and key = 'cmo_sync_enabled';
insert into office.approvals (id, workspace_id, run_id, artifact_id, artifact_hash, decision, approver_id)
select '0000000d-0000-4000-8000-000000000061', w.v, a.run_id, a.id, a.content_hash, 'approved', '11111111-1111-4111-8111-111111111111'
from t.ids w, office.artifacts a where w.k = 'ws_a' and a.id = (select v from t.ids where k = 'art_a');
insert into office.handoffs (workspace_id, run_id, approval_id, payload, idempotency_key)
select w.v, (select v from t.ids where k = 'run_a'), '0000000d-0000-4000-8000-000000000061', '{}', 'handoff:test-61' from t.ids w where w.k = 'ws_a';
select t.ok('flag off: nothing written to CMO Space',
  not exists (select 1 from cmo.space_documents d, jsonb_array_elements(d.payload) e
              where d.key = 'execution' and e->>'id' = 'aio-' || (select id from office.handoffs where idempotency_key = 'handoff:test-61')));
update office.settings set value = 'true' where workspace_id is null and key = 'cmo_sync_enabled';

select t.ok('stream mapping', office.cmo_stream_for('paid_media_campaign') = 'Performance'
  and office.cmo_stream_for('outdoor_print_pack') = 'BTL / OOH' and office.cmo_stream_for('reels_concepts') = 'Brand / Creative');

-- ---------- QA report ----------
select t.ok('qa_run returns QaReport.v1 with an overall status and named checks',
  (select r->>'schema_version' = 'QaReport.v1' and r->>'status' in ('ok','info','warn','fail')
          and jsonb_array_length(r->'checks') >= 15
          and (select bool_and(x ? 'key' and x ? 'level' and x ? 'detail') from jsonb_array_elements(r->'checks') x)
   from office.qa_run('pavutyna') r));
select t.ok('qa_run journals one qa.report event', (select count(*) = 1 from office.events where kind = 'qa.report'));
select t.ok('cmo_sync failure from above is reported as fail',
  (select x->>'level' = 'fail' from jsonb_array_elements(office.qa_checks((select v from t.ids where k = 'ws_a'))->'checks') x
   where x->>'key' = 'cmo_sync_failed_7d'));
select t.ok('overall status is the worst level', office.qa_checks((select v from t.ids where k = 'ws_a'))->>'status' = 'fail');
select t.ok('CMO agent checks present for the linked workspace',
  (select count(*) = 2 from jsonb_array_elements(office.qa_checks((select v from t.ids where k = 'ws_a'))->'checks') x
   where x->>'key' like 'cmo_agents_%'));
select t.ok('no CMO checks for an unlinked workspace',
  not exists (select 1 from jsonb_array_elements(office.qa_checks((select v from t.ids where k = 'ws_nocmo'))->'checks') x
              where x->>'key' like 'cmo_%' and x->>'key' <> 'cmo_sync_failed_7d'));

-- Stale ready step is detected as a worker problem.
update office.steps set status = 'ready', next_attempt_at = now() - interval '1 hour'
where id = (select id from office.steps where workspace_id = (select v from t.ids where k = 'ws_a')
            and run_id in (select id from office.runs where status = 'running') order by created_at limit 1);
select t.ok('worker backlog detected',
  (select (x->>'count')::int >= 1 and x->>'level' = 'fail' from jsonb_array_elements(office.qa_checks((select v from t.ids where k = 'ws_a'))->'checks') x
   where x->>'key' = 'worker_backlog'));

select t.throws('unknown workspace', $q$select office.qa_run('nope')$q$, 'P0002');

begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.ok('owner reads the QA report', (office.qa_report((select v from t.ids where k = 'ws_a'))->>'schema_version') = 'QaReport.v1');
select t.throws('owner cannot call internal qa_checks', format($q$select office.qa_checks(%L)$q$, (select v from t.ids where k = 'ws_a')), '42501');
select t.throws('owner cannot call qa_run', $q$select office.qa_run('pavutyna')$q$, '42501');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
set local role authenticated;
select t.throws('viewer cannot read the QA report', format($q$select office.qa_report(%L)$q$, (select v from t.ids where k = 'ws_a')), '42501');
commit;
set role office_app;
select t.throws('application role cannot run QA', $q$select office.qa_run('pavutyna')$q$, '42501');
reset role;

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'QA / CMO sync SQL tests failed'; end if;
end $$;
