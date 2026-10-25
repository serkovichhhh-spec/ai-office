-- 0015: CMO Space tasks assigned to «AI Office» become briefs + runs once.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

insert into cmo.tasks (workspace_key, source_id, title, description, assignee_name, lane, label, priority, runtime_payload) values
  ('pavutyna-cmo', 'task-ai-1', 'Банер для акції', 'Потрібен банер на сайт для осінньої акції 3 місяці за 1 грн.', 'AI Office', 'todo', 'Design', 'High', null),
  ('pavutyna-cmo', 'task-ai-2', 'Пости на тиждень', null, 'Борис', 'todo', 'SMM', null,
     '{"assignee":"AI Office","lane":"ready","title":"Пости на тиждень (runtime)","description":"5 постів про швидкість інтернету"}'),
  ('pavutyna-cmo', 'task-human', 'Зустріч з підрядником', 'Обговорити друк', 'Борис', 'todo', 'Print', null, null),
  ('pavutyna-cmo', 'task-done', 'Старий звіт', 'Вже зроблено', 'AI Office', 'done', 'Analytics', null, null);

select office.cmo_import_tick(10);
select t.ok('two AI Office tasks in open lanes imported', (select count(*) = 2 from office.cmo_task_links where status = 'imported'));
select t.ok('runtime fields win over columns', exists (select 1 from office.briefs b join office.cmo_task_links l on l.brief_id = b.id
  where l.cmo_task_id = 'task-ai-2' and b.title = 'Пости на тиждень (runtime)' and b.objective like '5 постів%'));
select t.ok('brief uses CMO diagnosis playbook and keeps the CMO task id', (select bool_and(b.playbook_key = 'cmo_brief_diagnosis'
  and b.fields->>'cmo_task_id' = l.cmo_task_id) from office.briefs b join office.cmo_task_links l on l.brief_id = b.id));
select t.ok('runs started', (select count(*) = 2 from office.runs r join office.cmo_task_links l on l.run_id = r.id where r.status = 'queued' or r.status = 'running'));
select t.ok('priority mapped', exists (select 1 from office.briefs b join office.cmo_task_links l on l.brief_id = b.id
  where l.cmo_task_id = 'task-ai-1' and b.priority = 'high'));
select t.ok('human / done tasks ignored', not exists (select 1 from office.cmo_task_links where cmo_task_id in ('task-human','task-done')));
select t.ok('import logged', (select count(*) = 2 from office.events where kind = 'cmo_import.created'));
select t.ok('caller identity restored after import', coalesce(current_setting('request.jwt.claims', true), '') not like '%11111111%');
select office.cmo_import_tick(10);
select t.ok('no duplicates on the next tick', (select count(*) = 2 from office.cmo_task_links where status = 'imported'));
select t.ok('execution record of an imported run carries the CMO task id',
  (select office.cmo_stream_record_extra(run_id)->>'cmoTaskId' = 'task-ai-1' from office.cmo_task_links where cmo_task_id = 'task-ai-1'));

update office.settings set value = 'false' where workspace_id is null and key = 'cmo_import_enabled';
insert into cmo.tasks (workspace_key, source_id, title, description, assignee_name, lane) values
  ('pavutyna-cmo', 'task-ai-3', 'Ще одна', 'Опис задачі для перевірки вимикача', 'AI Office', 'todo');
select t.ok('kill switch', (office.cmo_import_tick(10)->>'disabled')::boolean
  and not exists (select 1 from office.cmo_task_links where cmo_task_id = 'task-ai-3'));
update office.settings set value = 'true' where workspace_id is null and key = 'cmo_import_enabled';
insert into office.settings (workspace_id, key, value) select v, 'cmo_import_daily_cap', '2' from t.ids where k = 'ws_a';
select office.cmo_import_tick(10);
select t.ok('daily cap respected', not exists (select 1 from office.cmo_task_links where cmo_task_id = 'task-ai-3'));

set role office_app;
select t.ok('worker role can run the import', (office.cmo_import_tick(1)->>'imported') is not null);
reset role;
set role authenticated;
select t.throws('users cannot run the import', $q$select office.cmo_import_tick(1)$q$, '42501');
reset role;

-- 0016: a reviewer step is not moved to the executor that authored work in the same run.
insert into t.tok values ('nsr_claude', office.create_executor('gtu', 'claude_session', 'NSR Claude')),
                         ('nsr_gpt', office.create_executor('gtu', 'chatgpt', 'NSR ChatGPT'));
update office.executors x set allowed_seats = (select array_agg(a.role_key) from office.agents a where a.workspace_id = x.workspace_id),
  verified_at = now() where name in ('NSR Claude', 'NSR ChatGPT');
update office.executors set revoked_at = now() where workspace_id = (select v from t.ids where k = 'ws_b')
  and name not in ('NSR Claude', 'NSR ChatGPT') and revoked_at is null;
insert into office.briefs (id, workspace_id, title, objective, status)
select '0000000a-0000-4000-8000-000000000090', v, 'NSR brief', 'Перевірити незалежність', 'active' from t.ids where k = 'ws_b';
insert into office.runs (id, workspace_id, brief_id, playbook_key, status, budget_usd, idempotency_key)
select '0000000b-0000-4000-8000-000000000090', v, '0000000a-0000-4000-8000-000000000090', 'reels_concepts', 'running', 1, 'nsr-run-0090'
from t.ids where k = 'ws_b';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select ('0000000c-0000-4000-8000-0000000009' || v2.n)::uuid, '0000000b-0000-4000-8000-000000000090', i.v, v2.sk, v2.role, v2.st, v2.ex,
       '{"schemaName":"x","system":"s","user":"u","jsonSchema":{"type":"object"}}'
from t.ids i, (values ('01','build','copywriter','succeeded','claude_session'), ('02','review','reviewer','awaiting_agent','chatgpt'))
  v2(n, sk, role, st, ex) where i.k = 'ws_b';
insert into office.execution_attempts (step_id, run_id, workspace_id, executor_id, lease_token_hash, lease_expires_at, state)
select '0000000c-0000-4000-8000-000000000901', '0000000b-0000-4000-8000-000000000090', v, (select id from office.executors where name = 'NSR Claude'),
       repeat('b', 64), now(), 'validated' from t.ids where k = 'ws_b';
insert into office.provider_limits (workspace_id, provider, limited_until) select v, 'openai', now() + interval '1 hour' from t.ids where k = 'ws_b';
select office.router_tick();
select t.ok('review is not moved to the author of the run (stops instead)',
  (select executor = 'chatgpt' and route_blocked = 'no_verified_executor' from office.steps where id = '0000000c-0000-4000-8000-000000000902'));
delete from office.provider_limits;

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'CMO import SQL tests failed'; end if;
end $$;
