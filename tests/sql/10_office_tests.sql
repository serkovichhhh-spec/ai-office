-- AI Office SQL acceptance tests (run on a throwaway local database).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- ---------- test helpers ----------
create schema t;
grant usage on schema t to public;
create table t.results (id serial, name text, ok boolean, detail text);
grant insert, select on t.results to public;
grant usage on sequence t.results_id_seq to public;

create function t.ok(p_name text, p_cond boolean, p_detail text default null) returns void
language plpgsql as $$ begin
  insert into t.results(name, ok, detail) values (p_name, coalesce(p_cond, false), p_detail);
end $$;

-- Executes p_sql as the CURRENT role and records whether it failed with the expected SQLSTATE.
create function t.throws(p_name text, p_sql text, p_errcode text) returns void
language plpgsql as $$ begin
  execute p_sql;
  insert into t.results(name, ok, detail) values (p_name, false, 'no error raised');
exception when others then
  insert into t.results(name, ok, detail)
  values (p_name, sqlstate = p_errcode, sqlstate || ': ' || sqlerrm);
end $$;
grant execute on all functions in schema t to public;

create table t.ids (k text primary key, v uuid);
grant select, insert on t.ids to public;

-- ---------- fixtures (as superuser) ----------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner.a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner.b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'viewer.a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'outsider@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'approver.a@example.test');

-- Seed migration ran before members existed in this test DB, so add them now the same way.
insert into office.workspace_members (workspace_id, user_id, role)
select id, '11111111-1111-4111-8111-111111111111', 'owner' from office.workspaces where slug = 'pavutyna';
insert into office.workspace_members (workspace_id, user_id, role)
select id, '33333333-3333-4333-8333-333333333333', 'viewer' from office.workspaces where slug = 'pavutyna';
insert into office.workspace_members (workspace_id, user_id, role)
select id, '55555555-5555-4555-8555-555555555555', 'approver' from office.workspaces where slug = 'pavutyna';

insert into office.workspaces (slug, name) values ('gtu', 'GTU');
select office.seed_default_agents(id) from office.workspaces where slug = 'gtu';
insert into office.workspace_members (workspace_id, user_id, role)
select id, '22222222-2222-4222-8222-222222222222', 'owner' from office.workspaces where slug = 'gtu';

insert into t.ids select 'ws_a', id from office.workspaces where slug = 'pavutyna';
insert into t.ids select 'ws_b', id from office.workspaces where slug = 'gtu';

insert into office.knowledge_docs (workspace_id, kind, title, body, status)
select v, 'fact', 'Покриття', 'Pavutyna — інтернет-провайдер.', 'approved' from t.ids where k = 'ws_a';
insert into office.knowledge_docs (workspace_id, kind, title, body, status)
select v, 'fact', 'Секрет B', 'Конфіденційні дані GTU', 'approved' from t.ids where k = 'ws_b';

insert into cmo.agent_runs (agent, status, started_at, summary) values
  ('chief', 'ok', now() - interval '1 day', 'Підсумок тижня'),
  ('analyst', 'running', now() - interval '20 hours', 'Підключення Google Ads');

-- ===================== 1. Workspace isolation =====================
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.ok('A sees exactly its workspace', (select array_agg(slug) from office.workspaces) = array['pavutyna']);
select t.ok('A sees only own knowledge', (select count(*) from office.knowledge_docs where title = 'Секрет B') = 0);
select t.ok('A sees agents of own ws only', (select count(distinct workspace_id) from office.agents) = 1);
select t.throws('A cannot create brief in B', format($q$select office.create_brief(%L, '{"title":"x","objective":"y"}')$q$,
  (select v from t.ids where k = 'ws_b')), '42501');
select t.throws('A cannot insert run directly', format($q$insert into office.runs(workspace_id, brief_id, playbook_key, budget_usd, idempotency_key)
  values (%L, gen_random_uuid(), 'x', 1, 'direct-insert-key')$q$, (select v from t.ids where k = 'ws_a')), '42501');
select t.throws('A cannot call worker_claim', $q$select * from office.worker_claim('evil', 1, 60)$q$, '42501');
select t.throws('A cannot read worker context', $q$select office.worker_context(gen_random_uuid())$q$, '42501');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
set local role authenticated;
select t.ok('outsider sees no workspaces', (select count(*) from office.workspaces) = 0);
select t.ok('outsider sees no knowledge', (select count(*) from office.knowledge_docs) = 0);
commit;

begin;
set local role anon;
select t.throws('anon cannot read office', 'select count(*) from office.workspaces', '42501');
commit;

-- ===================== 2. Brief submission + idempotency =====================
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
insert into t.ids select 'brief_a', office.create_brief((select v from t.ids where k = 'ws_a'),
  '{"title":"3 рілси про швидкість","objective":"Показати швидкість інтернету","deliverable_count":3,"acceptance_criteria":["хук до 2 с"]}');
insert into t.ids select 'run_a', office.submit_brief((select v from t.ids where k = 'brief_a'), 'idem-key-run-a-0001');
select t.ok('resubmit with same key returns same run',
  office.submit_brief((select v from t.ids where k = 'brief_a'), 'idem-key-run-a-0001') = (select v from t.ids where k = 'run_a'));
select t.throws('second active run for brief blocked',
  format($q$select office.submit_brief(%L, 'idem-key-run-a-0002')$q$, (select v from t.ids where k = 'brief_a')), '55000');
select t.ok('run is queued with intake step',
  (select status from office.runs where id = (select v from t.ids where k = 'run_a')) = 'queued'
  and (select count(*) from office.steps where run_id = (select v from t.ids where k = 'run_a') and step_key = 'intake') = 1);
select t.throws('A cannot update run status directly',
  format($q$update office.runs set status = 'needs_approval' where id = %L$q$, (select v from t.ids where k = 'run_a')), '42501');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
set local role authenticated;
select t.ok('viewer can read the run', (select count(*) from office.runs) = 1);
select t.throws('viewer cannot submit', format($q$select office.submit_brief(%L, 'idem-key-viewer-001')$q$,
  (select v from t.ids where k = 'brief_a')), '42501');
select t.throws('viewer cannot create brief', format($q$select office.create_brief(%L, '{"title":"x","objective":"y"}')$q$,
  (select v from t.ids where k = 'ws_a')), '42501');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
set local role authenticated;
select t.ok('B cannot see A runs', (select count(*) from office.runs) = 0);
select t.ok('B cannot see A events', (select count(*) from office.events where run_id = (select v from t.ids where k = 'run_a')) = 0);
select t.throws('B cannot reuse A idempotency key',
  format($q$select office.submit_brief(%L, 'idem-key-run-a-0001')$q$, gen_random_uuid()), '23505');
select t.throws('B cannot cancel A run', format($q$select office.cancel_run(%L)$q$, (select v from t.ids where k = 'run_a')), '42501');
commit;

-- ===================== 3. Worker: claim, stale completion, playbook to approval =====================
begin;
set local role office_app;
create temp table claimed on commit drop as select * from office.worker_claim('w1', 5, 120);
select t.ok('worker claims intake', (select count(*) from claimed) = 1 and (select step_key from claimed) = 'intake');
select t.ok('second worker gets nothing (no double claim)', (select count(*) from office.worker_claim('w2', 5, 120)) = 0);
select t.ok('worker context excludes other workspace knowledge',
  (office.worker_context((select id from claimed))->'knowledge')::text not like '%Секрет B%');
select t.ok('foreign worker completion rejected',
  (office.worker_complete((select id from claimed), 'w2', 1, '{}')->>'accepted')::boolean = false);
select t.ok('stale attempt completion rejected',
  (office.worker_complete((select id from claimed), 'w1', 99, '{}')->>'accepted')::boolean = false);
select t.ok('intake completes and enqueues next step',
  (office.worker_complete((select id from claimed), 'w1', 1,
    '{"output":{"ok":true},"provider":"stub","model":"stub","usage":{"cost_usd":0},
      "next_steps":[{"step_key":"package","agent_role":"orchestrator","input":{}}]}')->>'accepted')::boolean);
select t.ok('duplicate completion is ignored',
  (office.worker_complete((select id from claimed), 'w1', 1, '{}')->>'accepted')::boolean = false);
commit;

begin;
set local role office_app;
create temp table c2 on commit drop as select * from office.worker_claim('w1', 5, 120);
select t.ok('next step claimed', (select step_key from c2) = 'package');
reset role;
select t.ok('run moved to running', (select status from office.runs where id = (select v from t.ids where k = 'run_a')) = 'running');
set local role office_app;
select t.ok('package completes with deliverable -> needs_approval',
  (office.worker_complete((select id from c2), 'w1', 1,
    '{"output":{},"provider":"stub","model":"stub","usage":{"cost_usd":0.0123,"tokens_in":10,"tokens_out":20},
      "artifacts":[{"kind":"deliverable","title":"Пакет рілсів","content":{"concepts":[1,2,3]}}],
      "run_status":"needs_approval"}')->>'accepted')::boolean);
commit;

select t.ok('run waits for approval with cost tracked',
  (select status = 'needs_approval' and cost_usd = 0.0123 and tokens_out = 20 from office.runs where id = (select v from t.ids where k = 'run_a')));
insert into t.ids select 'art_a', id from office.artifacts where run_id = (select v from t.ids where k = 'run_a') and kind = 'deliverable';

-- ===================== 4. Approval rules =====================
begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
set local role authenticated;
select t.throws('viewer cannot approve', format($q$select office.decide(%L, 'approved', '')$q$, (select v from t.ids where k = 'art_a')), '42501');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
set local role authenticated;
select t.throws('other workspace owner cannot approve', format($q$select office.decide(%L, 'approved', '')$q$, (select v from t.ids where k = 'art_a')), '42501');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('cannot insert approval directly', format($q$insert into office.approvals(workspace_id, run_id, artifact_id, artifact_hash, decision, approver_id)
  values (%L, %L, %L, 'x', 'approved', auth.uid())$q$, (select v from t.ids where k = 'ws_a'), (select v from t.ids where k = 'run_a'),
  (select v from t.ids where k = 'art_a')), '42501');
select t.throws('cannot insert handoff directly', format($q$insert into office.handoffs(workspace_id, run_id, approval_id, payload, idempotency_key)
  values (%L, %L, gen_random_uuid(), '{}', 'x')$q$, (select v from t.ids where k = 'ws_a'), (select v from t.ids where k = 'run_a')), '42501');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', true);
set local role authenticated;
select t.ok('approver approves -> handoff queued',
  (office.decide((select v from t.ids where k = 'art_a'), 'approved', 'Ок, беремо')->>'handoff_id') is not null);
select t.ok('run is handoff_queued', (select status from office.runs where id = (select v from t.ids where k = 'run_a')) = 'handoff_queued');
select t.ok('handoff payload carries approval proof',
  (select payload->'approval'->>'approver_id' = '55555555-5555-4555-8555-555555555555'
          and payload->>'schema_version' = 'handoff.v1'
          and payload->'approved_artifact'->>'hash' = (select content_hash from office.artifacts where id = (select v from t.ids where k = 'art_a'))
   from office.handoffs where run_id = (select v from t.ids where k = 'run_a')));
select t.throws('approving twice is blocked', format($q$select office.decide(%L, 'approved', '')$q$, (select v from t.ids where k = 'art_a')), '55000');
commit;

select t.ok('exactly one handoff', (select count(*) from office.handoffs where run_id = (select v from t.ids where k = 'run_a')) = 1);
select t.throws('artifacts immutable (even for superuser)', format($q$update office.artifacts set title = 'x' where id = %L$q$, (select v from t.ids where k = 'art_a')), '42501');
select t.throws('approvals immutable', 'delete from office.approvals', '42501');
select t.throws('events immutable', 'update office.events set kind = kind', '42501');
select t.throws('illegal run transition blocked', format($q$update office.runs set status = 'running' where id = %L$q$, (select v from t.ids where k = 'run_a')), '23514');

-- ===================== 5. Revision loop =====================
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
insert into t.ids select 'brief_r', office.create_brief((select v from t.ids where k = 'ws_a'), '{"title":"Ревізія","objective":"Тест"}');
insert into t.ids select 'run_r', office.submit_brief((select v from t.ids where k = 'brief_r'), 'idem-key-run-r-0001');
commit;
begin;
set local role office_app;
create temp table c3 on commit drop as select * from office.worker_claim('w1', 5, 120);
select office.worker_complete((select id from c3), 'w1', 1,
  '{"provider":"stub","artifacts":[{"kind":"deliverable","title":"v1","content":{"v":1}}],"run_status":"needs_approval"}');
commit;
insert into t.ids select 'art_r1', id from office.artifacts where run_id = (select v from t.ids where k = 'run_r');
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('revision without comment rejected', format($q$select office.decide(%L, 'revision_requested', '  ')$q$, (select v from t.ids where k = 'art_r1')), '22023');
select office.decide((select v from t.ids where k = 'art_r1'), 'revision_requested', 'Більше гумору');
select t.ok('revision restarts run', (select status = 'running' and revision = 2 from office.runs where id = (select v from t.ids where k = 'run_r')));
select t.ok('revision_intake step queued with feedback',
  (select input->>'owner_feedback' from office.steps where run_id = (select v from t.ids where k = 'run_r') and step_key = 'revision_intake') = 'Більше гумору');
commit;
begin;
set local role office_app;
create temp table c4 on commit drop as select * from office.worker_claim('w1', 5, 120);
select office.worker_complete((select id from c4), 'w1', 1,
  '{"provider":"stub","artifacts":[{"kind":"deliverable","title":"v2","content":{"v":2}}],"run_status":"needs_approval"}');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('old version cannot be approved', format($q$select office.decide(%L, 'approved', '')$q$, (select v from t.ids where k = 'art_r1')), '55000');
select t.ok('new version is v2', (select max(version) from office.artifacts where run_id = (select v from t.ids where k = 'run_r') and kind = 'deliverable') = 2);
commit;

-- ===================== 6. Lease expiry, retries, dead letter =====================
begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
set local role authenticated;
insert into t.ids select 'brief_b', office.create_brief((select v from t.ids where k = 'ws_b'), '{"title":"GTU","objective":"Тест збою"}');
insert into t.ids select 'run_b', office.submit_brief((select v from t.ids where k = 'brief_b'), 'idem-key-run-b-0001');
commit;

update office.steps set max_attempts = 2 where run_id = (select v from t.ids where k = 'run_b');
begin; set local role office_app; select count(*) from office.worker_claim('crashy', 5, 120); commit;
update office.steps set locked_until = now() - interval '1 second' where run_id = (select v from t.ids where k = 'run_b');
begin; set local role office_app; select office.worker_reap(); commit;
select t.ok('expired lease returns step to queue',
  (select status = 'ready' and attempt = 1 and next_attempt_at > now() from office.steps where run_id = (select v from t.ids where k = 'run_b')));
update office.steps set next_attempt_at = now() - interval '1 second' where run_id = (select v from t.ids where k = 'run_b');
begin; set local role office_app;
create temp table c5 on commit drop as select * from office.worker_claim('w1', 5, 120);
select t.ok('failure on last attempt goes to dead letter',
  (office.worker_fail((select id from c5), 'w1', 2, 'provider timeout', true)->>'retry')::boolean = false);
commit;
select t.ok('run failed with dead-lettered step',
  (select status = 'failed' and error_code = 'step_failed' from office.runs where id = (select v from t.ids where k = 'run_b'))
  and exists (select 1 from office.events where run_id = (select v from t.ids where k = 'run_b') and kind = 'step.dead_lettered'));

-- ===================== 7. Legacy CMO agents (read-only view) =====================
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.ok('owner sees legacy CMO agent runs', (select count(*) from office.legacy_agent_runs((select v from t.ids where k = 'ws_a'))) = 2);
select t.ok('stuck legacy run flagged stale', (select stale from office.legacy_agent_runs((select v from t.ids where k = 'ws_a')) where agent = 'analyst'));
select t.throws('owner A cannot read cmo directly', 'select count(*) from cmo.agent_runs', '42501');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
set local role authenticated;
select t.throws('owner B cannot read PAVUTYNA legacy runs',
  format($q$select * from office.legacy_agent_runs(%L)$q$, (select v from t.ids where k = 'ws_a')), '42501');
select t.ok('GTU has no legacy runs', (select count(*) from office.legacy_agent_runs((select v from t.ids where k = 'ws_b'))) = 0);
commit;

-- ===================== report =====================
\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'SQL acceptance tests failed'; end if;
end $$;
