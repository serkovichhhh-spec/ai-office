truncate t.results;
-- Finish unrelated fixtures so this suite exercises only its own ready child steps.
update office.runs set status='cancelled' where workspace_id=(select v from t.ids where k='ws_a') and status in ('queued','running','needs_input','needs_approval');
create table t.program_plans(k text primary key,p jsonb);grant select on t.program_plans to public;
insert into t.program_plans values('valid','{"diagnosis":{"real_task":"Prepare address communications","audience_tension":"Unknown availability","what_we_know":[],"what_we_dont_know":[],"questions_to_owner":[],"recommended_depth":"light"},"depth":"light","workstreams":[{"id":"ws1","playbook":"owned_media_copy@2","purpose":"Prepare message","inputs":{"title":"Address availability copy","objective":"Explain the address check clearly","audience":"Local residents","channel":"email","deliverable_count":1,"deadline":"2026-10-30","acceptance_criteria":["Use approved product facts"],"references":[],"copy_kind":"email","message_knowledge_ids":["KNOWN"],"delivery_spec_knowledge_id":"KNOWN"},"depends_on":[]},{"id":"ws2","playbook":"owned_media_copy@2","purpose":"Adapt approved message","inputs":{"title":"Address availability copy","objective":"Explain the address check clearly","audience":"Local residents","channel":"email","deliverable_count":1,"deadline":"2026-10-30","acceptance_criteria":["Use approved product facts"],"references":[],"copy_kind":"email","message_knowledge_ids":["KNOWN"],"delivery_spec_knowledge_id":"KNOWN"},"depends_on":["ws1"]}],"owner_gates":[{"after":"ws1","question":"Approve direction before adaptation?"}],"success_criteria":["Messages contain approved facts"],"open_questions":[]}');
update t.program_plans set p=replace(p::text,'KNOWN',(select id::text from office.knowledge_docs where title='Покриття' and status='approved' limit 1))::jsonb;
select t.ok('database validates the full registered brief contracts and DAG',office.program_plan_valid((select v from t.ids where k='ws_a'),(select p from t.program_plans where k='valid')));
select t.ok('empty or incomplete plans fail closed',not office.program_plan_valid((select v from t.ids where k='ws_a'),'{}'));
select t.ok('unregistered child playbook rejected',not office.program_plan_valid((select v from t.ids where k='ws_a'),
 jsonb_set((select p from t.program_plans where k='valid'),'{workstreams,0,playbook}','"not_registered@1"')));
select t.ok('wrong or extra inputs rejected at database boundary',not office.program_plan_valid((select v from t.ids where k='ws_a'),
 jsonb_set((select p from t.program_plans where k='valid'),'{workstreams,0,inputs,unexpected}','true')));
select t.ok('cyclic dependencies rejected by database',not office.program_plan_valid((select v from t.ids where k='ws_a'),
 jsonb_set((select p from t.program_plans where k='valid'),'{workstreams,0,depends_on}','["ws2"]')));
select t.ok('foreign or missing knowledge cannot enter child briefs',not office.program_plan_valid((select v from t.ids where k='ws_a'),
 jsonb_set((select p from t.program_plans where k='valid'),'{workstreams,0,inputs,message_knowledge_ids}','["00000000-0000-4000-8000-000000000999"]')));
insert into office.briefs(id,workspace_id,title,objective,status,playbook_key)
select '0000000a-0000-4000-8000-000000000080',v,'Program approval','Test governed execution','active','program' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,status,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000080',v,'0000000a-0000-4000-8000-000000000080','program','needs_approval',1,'program-suite-0080' from t.ids where k='ws_a';
insert into office.artifacts(id,workspace_id,run_id,kind,title,version,content,content_hash,provider)
select '0000000d-0000-4000-8000-000000000080',i.v,'0000000b-0000-4000-8000-000000000080','work_plan','WorkPlan',1,p.p,office.json_hash(p.p),'session'
 from t.ids i,t.program_plans p where i.k='ws_a' and p.k='valid';
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('program engine is disabled until owner explicitly enables it',
 $q$select office.start_program('0000000d-0000-4000-8000-000000000080',1,3)$q$,'55000');
select office.set_program_engine((select v from t.ids where k='ws_a'),true);
select t.throws('NaN program budget fails closed',
 $q$select office.start_program('0000000d-0000-4000-8000-000000000080','NaN'::numeric,3)$q$,'22023');
insert into t.ids select 'program80',office.start_program('0000000d-0000-4000-8000-000000000080',1,3);
select t.ok('repeated plan approval returns the existing program',
 office.start_program('0000000d-0000-4000-8000-000000000080',1,3)=(select v from t.ids where k='program80'));
commit;
insert into t.ids select 'child80a',run_id from office.program_items where program_id=(select v from t.ids where k='program80') and item_key='ws1';
insert into t.ids select 'child80b',run_id from office.program_items where program_id=(select v from t.ids where k='program80') and item_key='ws2';
select t.ok('one atomic program creates exactly two pinned child runs',
 (select count(*)=2 and bool_and(r.playbook_version=2 and r.playbook_key='owned_media_copy') from office.runs r where program_id=(select v from t.ids where k='program80')));
select t.ok('child budgets are positive and sum within the program budget',
 (select sum(budget_usd)<=1 and bool_and(budget_usd>0) from office.runs where program_id=(select v from t.ids where k='program80')));
select t.ok('dependent run is not ready before the first result is approved',not office.program_ready((select v from t.ids where k='child80b')));
set role office_app;
insert into t.ids select 'first_program_step',id from office.worker_claim('program80',10,120) where run_id=(select v from t.ids where k='child80a');
reset role;
select t.ok('worker leaves dependency intake unclaimed',
 (select status='ready' from office.steps where run_id=(select v from t.ids where k='child80b') and step_key='intake'));
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('owner gate cannot pass before the predecessor result',format($q$select office.approve_program_gate(%L,'ws1','Yes')$q$,(select v from t.ids where k='program80')),'55000');
commit;
-- Simulate an owner-approved first package. The worker context must carry its exact version.
insert into office.artifacts(workspace_id,run_id,kind,title,version,content,content_hash,provider)
select workspace_id,id,'deliverable','Approved first output',1,'{"message":"Approved direction"}','parent-v1','session' from office.runs where id=(select v from t.ids where k='child80a');
update office.steps set status='succeeded' where id=(select v from t.ids where k='first_program_step');
update office.runs set status='needs_approval' where id=(select v from t.ids where k='child80a');
update office.runs set status='approved' where id=(select v from t.ids where k='child80a');
update office.runs set status='handoff_queued' where id=(select v from t.ids where k='child80a');
select t.ok('explicit owner gate still holds the dependent run',not office.program_ready((select v from t.ids where k='child80b')));
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.approve_program_gate((select v from t.ids where k='program80'),'ws1','Proceed with this direction');
commit;
select t.ok('dependency and gate approval release the second run',office.program_ready((select v from t.ids where k='child80b')));
select t.ok('approved upstream artifact enters context with its source and version',
 (select office.worker_context(id)->'upstream_artifacts'->0->>'version'='1' from office.steps where run_id=(select v from t.ids where k='child80b') and step_key='intake'));
select t.ok('upstream output hash is part of the child lease inputs',
 exists(select 1 from jsonb_array_elements(office.run_input_hashes((select v from t.ids where k='child80b'))) x where x->>'kind'='upstream:ws1:deliverable' and x->>'hash'='parent-v1'));
update office.runs set cost_usd=0.6 where program_id=(select v from t.ids where k='program80');
update office.runs set status='running' where id=(select v from t.ids where k='child80b');
select office.program_refresh();
select t.ok('aggregate program budget blocks further work',
 (select status='blocked' and blocked_reason='program_budget_exceeded' from office.programs where id=(select v from t.ids where k='program80'))
 and not office.program_ready((select v from t.ids where k='child80b')));
begin;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444"}',true);
set local role authenticated;
select t.throws('editor cannot cancel entire program',format($q$select office.cancel_program(%L)$q$,(select v from t.ids where k='program80')),'42501');
commit;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.cancel_run('0000000b-0000-4000-8000-000000000080');
commit;
select t.ok('cancelling the root cancels all child runs and queued steps',
 (select status='cancelled' from office.programs where id=(select v from t.ids where k='program80'))
 and (select bool_and(status='cancelled') from office.runs where program_id=(select v from t.ids where k='program80'))
 and not exists(select 1 from office.steps s join office.runs r on r.id=s.run_id where r.program_id=(select v from t.ids where k='program80') and s.status in ('ready','running','awaiting_agent')));
select t.ok('program cancellation is audited',exists(select 1 from office.events where kind='program.cancelled'));
select id,name,detail from t.results where not ok;
do $$ begin if exists(select 1 from t.results where not ok) then raise exception 'Program tests failed';end if;end $$;
