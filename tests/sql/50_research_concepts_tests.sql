-- DRAFT 0009 tests: loaded only in the disposable local database.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;
insert into auth.users(id) values ('66666666-6666-4666-8666-666666666666');
insert into office.workspace_members(workspace_id,user_id,role)
select v,'66666666-6666-4666-8666-666666666666','editor' from t.ids where k='ws_a';
insert into office.briefs(id,workspace_id,title,objective)
select '0000000a-0000-4000-8000-000000000050',v,'Research test','Candidate approval' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000050',v,'0000000a-0000-4000-8000-000000000050','research_brief',0,'draft-research-0050' from t.ids where k='ws_a';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role)
select '0000000c-0000-4000-8000-000000000050','0000000b-0000-4000-8000-000000000050',v,'research','research_analyst' from t.ids where k='ws_a';
insert into office.artifacts(id,workspace_id,run_id,step_id,kind,title,version,content,content_hash,provider)
select '0000000d-0000-4000-8000-000000000050',v,'0000000b-0000-4000-8000-000000000050','0000000c-0000-4000-8000-000000000050','research','Research evidence',1,'{}','test-hash','stub' from t.ids where k='ws_a';
begin;
select set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666"}',true);
set local role authenticated;
insert into office.knowledge_candidates(id,workspace_id,research_artifact_id,kind,title,claim,confidence,sources,why_it_matters,valid_until)
select '0000000e-0000-4000-8000-000000000050',v,'0000000d-0000-4000-8000-000000000050','market','Research finding','A sourced research statement.','reported',
 '[{"url":"https://example.test/source","title":"Test source","accessed_at":"2026-10-19"}]','Affects the proposed strategy.',current_date+30 from t.ids where k='ws_a';
select t.ok('editor creates candidate with server-owned actor',(select status='candidate' and created_by=auth.uid() and approved_doc_id is null from office.knowledge_candidates));
select t.ok('candidate is not published knowledge',not exists(select 1 from office.knowledge_docs where title='Research finding'));
select t.throws('editor cannot approve', $q$update office.knowledge_candidates set status='approved'$q$,'42501');
select t.throws('editor cannot reject', $q$update office.knowledge_candidates set status='rejected'$q$,'42501');
select t.throws('candidate provenance cannot be changed',$q$update office.knowledge_candidates set research_artifact_id=gen_random_uuid()$q$,'42501');
select t.throws('personal research is rejected',$q$update office.knowledge_candidates set data_class='personal'$q$,'23514');
select t.throws('malformed sources are rejected',$q$update office.knowledge_candidates set sources='[{"url":"javascript:bad","title":"bad","accessed_at":"2026-10-19"}]'$q$,'23514');
select t.throws('cannot insert pre-approved candidate',$q$insert into office.knowledge_candidates(workspace_id,research_artifact_id,kind,title,claim,confidence,why_it_matters,owner_question,status)
 select v,'0000000d-0000-4000-8000-000000000050','fact','Bad approval','Unconfirmed statement.','assumption','Needs owner review.','Can you confirm this?','approved' from t.ids where k='ws_a'$q$,'42501');
select t.throws('research artifact cannot cross workspaces',$q$insert into office.knowledge_candidates(workspace_id,research_artifact_id,kind,title,claim,confidence,why_it_matters,owner_question)
 select v,'0000000d-0000-4000-8000-000000000050','fact','Foreign finding','Unconfirmed statement.','assumption','Needs owner review.','Can you confirm this?' from t.ids where k='ws_b'$q$,'23514');
insert into office.concepts(id,workspace_id,run_id,artifact_id,concept_key,title,content)
select '0000000f-0000-4000-8000-000000000050',v,'0000000b-0000-4000-8000-000000000050','0000000d-0000-4000-8000-000000000050','A1','Concept one','{}' from t.ids where k='ws_a';
select t.ok('editor can draft concept',(select concept_status='draft' from office.concepts));
select t.throws('editor cannot select concept',$q$update office.concepts set concept_status='selected'$q$,'42501');
select t.throws('concept cannot reference foreign run',$q$insert into office.concepts(workspace_id,run_id,artifact_id,concept_key,title,content)
 select v,gen_random_uuid(),'0000000d-0000-4000-8000-000000000050','B1','Foreign concept','{}' from t.ids where k='ws_a'$q$,'23514');
commit;
begin;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
set local role authenticated;
select t.ok('viewer can read candidates',(select count(*)=1 from office.knowledge_candidates));
with changed as (update office.knowledge_candidates set status='approved' returning id) select t.ok('viewer cannot approve',count(*)=0) from changed;
with changed as (update office.concepts set concept_status='selected' returning id) select t.ok('viewer cannot select concepts',count(*)=0) from changed;
commit;
begin;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
set local role authenticated;
select t.ok('foreign owner cannot read candidates',(select count(*)=0 from office.knowledge_candidates));
select t.ok('foreign owner cannot read concepts',(select count(*)=0 from office.concepts));
with changed as (update office.knowledge_candidates set status='approved' returning id) select t.ok('foreign owner cannot approve',count(*)=0) from changed;
commit;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
update office.knowledge_candidates set valid_until=current_date-1;
select t.throws('owner cannot approve expired research',$q$update office.knowledge_candidates set status='approved'$q$,'23514');
update office.knowledge_candidates set valid_until=current_date+30,status='approved';
select t.ok('owner approval atomically publishes and records reviewer',(select c.reviewed_by=auth.uid() and c.reviewed_at is not null and k.status='approved' and k.valid_until=current_date+30 and k.data_class=c.data_class
 from office.knowledge_candidates c join office.knowledge_docs k on k.id=c.approved_doc_id));
select t.throws('approved candidate is immutable',$q$update office.knowledge_candidates set claim='A rewritten statement.'$q$,'42501');
update office.concepts set concept_status='selected';
select t.ok('owner selects concept',(select concept_status='selected' from office.concepts));
commit;
-- Existing approvals have no public INSERT grant. Exercise the new integrity trigger
-- as local admin with owner identity; office.decide remains the public writer.
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
insert into office.approvals(workspace_id,run_id,artifact_id,artifact_hash,decision,approver_id,scope,target_id)
select v,'0000000b-0000-4000-8000-000000000050','0000000d-0000-4000-8000-000000000050','test-hash','approved',auth.uid(),'concept','0000000f-0000-4000-8000-000000000050' from t.ids where k='ws_a';
select t.ok('scoped approval references concept',exists(select 1 from office.approvals where scope='concept'));
select t.throws('approval refuses foreign workspace',$q$insert into office.approvals(workspace_id,run_id,artifact_id,artifact_hash,decision,approver_id,scope,target_id)
 select v,'0000000b-0000-4000-8000-000000000050','0000000d-0000-4000-8000-000000000050','test-hash','approved',auth.uid(),'concept','0000000f-0000-4000-8000-000000000050' from t.ids where k='ws_b'$q$,'42501');
select t.throws('approval refuses unknown target',$q$insert into office.approvals(workspace_id,run_id,artifact_id,artifact_hash,decision,approver_id,scope,target_id)
 select v,'0000000b-0000-4000-8000-000000000050','0000000d-0000-4000-8000-000000000050','test-hash','approved',auth.uid(),'concept',gen_random_uuid() from t.ids where k='ws_a'$q$,'23514');
select t.ok('legacy approvals preserve null scope and target',exists(select 1 from office.approvals where scope is null and target_id is null));
commit;
select t.ok('anonymous role cannot read new tables',not has_table_privilege('anon','office.knowledge_candidates','select') and not has_table_privilege('anon','office.concepts','select'));
select t.ok('no stored production/release statuses',not exists(select 1 from information_schema.columns where table_schema='office' and table_name='concepts' and column_name in ('production_status','release_status')));
\o
\set QUIET off
select id,case when ok then 'PASS' else 'FAIL' end as result,name,detail from t.results order by id;
select count(*) filter(where ok) as passed,count(*) filter(where not ok) as failed from t.results;
do $$ begin
 if exists(select 1 from t.results where not ok) then raise exception 'SQL draft 0009 tests failed'; end if;
end $$;
