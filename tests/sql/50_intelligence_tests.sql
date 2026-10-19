truncate t.results;
-- Dedicated run, independent of the legacy regression fixtures.
insert into office.briefs(id,workspace_id,title,objective,status,playbook_key)
select '0000000a-0000-4000-8000-000000000050',v,'Research candidates','Test candidate governance','active','research_brief' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,status,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000050',v,'0000000a-0000-4000-8000-000000000050','research_brief','running',1,'intelligence-suite-0050' from t.ids where k='ws_a';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,locked_by,attempt)
select '0000000c-0000-4000-8000-000000000050','0000000b-0000-4000-8000-000000000050',v,'intake','orchestrator','running','i50',1 from t.ids where k='ws_a';
set role office_app;
select office.worker_complete('0000000c-0000-4000-8000-000000000050','i50',1,
 '{"output":{},"provider":"code","skill_pins":{"research-method":{"version":1,"sha256":"pin"}},"next_steps":[],"artifacts":[]}');
reset role;
select t.ok('run stores immutable intake skill pins',
 (select skill_pins->'research-method'->>'version'='1' from office.runs where id='0000000b-0000-4000-8000-000000000050'));
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,locked_by,attempt)
select '0000000c-0000-4000-8000-000000000051','0000000b-0000-4000-8000-000000000050',v,'candidates','orchestrator','running','i50',1 from t.ids where k='ws_a';
set role office_app;
select office.worker_complete('0000000c-0000-4000-8000-000000000051','i50',1,
 '{"output":{},"provider":"code","next_steps":[],"artifacts":[{"kind":"knowledge_candidates","title":"Candidates","content":{"candidates":[
 {"kind":"fact","title":"Verified candidate","claim":"A bounded product fact","confidence":"verified","sources":[{"url":"https://example.org/fact","title":"Product source","accessed_at":"2026-10-19"}],"valid_until":null,"why_it_matters":"Decision input","owner_question":""},
 {"kind":"insight","title":"Assumption candidate","claim":"Audience hypothesis","confidence":"assumption","sources":[],"valid_until":null,"why_it_matters":"Requires validation","owner_question":"Which evidence confirms this?"}
 ]}}]}');
reset role;
select t.ok('worker creates drafts, never autoapproves candidates',
 (select count(*)=2 and bool_and(status='draft') from office.knowledge_docs where origin_run_id='0000000b-0000-4000-8000-000000000050'));
select t.ok('volatile fact gets 90-day expiry and source provenance',
 (select expires_at=current_date+90 and sources->0->>'url'='https://example.org/fact' from office.knowledge_docs where title='Verified candidate'));
select t.ok('draft candidates excluded from worker knowledge',
 not exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'knowledge') x where x->>'title'='Verified candidate'));
insert into office.workspace_members(workspace_id,user_id,role)
select v,'44444444-4444-4444-8444-444444444444','editor' from t.ids where k='ws_a' on conflict do nothing;
begin;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444"}',true);
set local role authenticated;
select t.throws('editor cannot approve candidate',
 $q$update office.knowledge_docs set status='approved' where title='Verified candidate'$q$,'42501');
select t.throws('browser cannot forge candidate provenance',
 $q$insert into office.knowledge_docs(workspace_id,kind,title,body,origin_run_id) select v,'fact','Forge','x','0000000b-0000-4000-8000-000000000050' from t.ids where k='ws_a'$q$,'42501');
commit;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
update office.knowledge_docs set status='approved' where title='Verified candidate';
commit;
select t.ok('owner approval makes candidate available with record ID and version',
 exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'knowledge') x
 where x->>'title'='Verified candidate' and x->>'id' is not null and x->>'version' is not null));
update office.knowledge_docs set expires_at=current_date-1,status='draft' where title='Verified candidate';
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('expired candidate cannot be approved',
 $q$update office.knowledge_docs set status='approved' where title='Verified candidate'$q$,'22023');
commit;
-- Conditional concept: the standard approval path is blocked at the database boundary.
update office.runs set status='needs_approval' where id='0000000b-0000-4000-8000-000000000050';
insert into office.artifacts(id,workspace_id,run_id,kind,title,version,content,content_hash,provider)
select '0000000d-0000-4000-8000-000000000050',v,'0000000b-0000-4000-8000-000000000050','deliverable','Conditional concept',1,'{"outcome":"conditional"}','conditional-hash','session' from t.ids where k='ws_a';
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('conditional package cannot enter production',
 $q$select office.decide('0000000d-0000-4000-8000-000000000050','approved','Go')$q$,'55000');
select office.approve_concept('0000000d-0000-4000-8000-000000000050','Keep idea, verify facts');
select office.approve_concept('0000000d-0000-4000-8000-000000000050','Duplicate request');
commit;
select t.ok('concept approval keeps needs_approval and creates no handoff',
 (select status='needs_approval' from office.runs where id='0000000b-0000-4000-8000-000000000050')
 and not exists(select 1 from office.handoffs where run_id='0000000b-0000-4000-8000-000000000050'));
select t.ok('concept approval is idempotent and auditable',
 (select count(*)=1 from office.approvals where artifact_id='0000000d-0000-4000-8000-000000000050' and decision='concept_approved')
 and exists(select 1 from office.events where kind='concept.approved'));
select id,name,detail from t.results where not ok;
do $$ begin if exists(select 1 from t.results where not ok) then raise exception 'Intelligence tests failed'; end if; end $$;
