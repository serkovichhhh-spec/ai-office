-- Full local flow through worker_complete, owner review, audit, and expiry.
\set ON_ERROR_STOP on
\o /dev/null
truncate t.results;
update office.runs set status='running' where id='0000000b-0000-4000-8000-000000000050';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,attempt,locked_by,locked_until,executor)
select '0000000c-0000-4000-8000-000000000051','0000000b-0000-4000-8000-000000000050',v,'research_flow','research_analyst','running',1,'flow-test',now()+interval '10 minutes','chatgpt' from t.ids where k='ws_a';
set role office_app;
select office.worker_complete('0000000c-0000-4000-8000-000000000051','flow-test',1,jsonb_build_object(
 'provider','stub','output','{}'::jsonb,'artifacts',jsonb_build_array(jsonb_build_object('kind','research_flow','title','Research flow',
 'content',jsonb_build_object('schema_version','KnowledgeCandidate.v1','candidates',jsonb_build_array(jsonb_build_object(
 'kind','fact','title','Staged factual claim','claim','A sourced factual statement for owner review.','confidence','reported',
 'sources','[{"url":"https://example.test/verified","title":"Primary source","accessed_at":"2026-10-20"}]'::jsonb,
 'why_it_matters','Affects the campaign decision.','data_class','public')))))));
reset role;
insert into t.ids select 'flow_candidate',id from office.knowledge_candidates where title='Staged factual claim';
select t.ok('worker completion stages research atomically',(select count(*)=1 from office.knowledge_candidates where title='Staged factual claim' and status='candidate' and created_by is null));
select t.ok('unreviewed research never enters Hub',not exists(select 1 from office.knowledge_docs where title='Staged factual claim'));
select t.ok('research step completed',(select status='succeeded' from office.steps where id='0000000c-0000-4000-8000-000000000051'));
select t.ok('retry is rejected without duplicate candidates',office.worker_complete('0000000c-0000-4000-8000-000000000051','flow-test',1,'{}')->>'accepted'='false');
begin;
select set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666"}',true);
set local role authenticated;
select t.throws('editor cannot invoke owner review',$q$select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'approved',current_date+10,'')$q$,'42501');
select t.throws('direct terminal-state updates are forbidden',$q$update office.knowledge_candidates set status='approved' where id=(select v from t.ids where k='flow_candidate')$q$,'42501');
commit;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('approval needs explicit validity date',$q$select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'approved',null,'')$q$,'23514');
select t.throws('stale owner form cannot approve changed content',$q$select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'approved',current_date+10,'','stale-hash')$q$,'55000');
select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'approved',current_date+10,'Джерело перевірено',
 (select md5(to_jsonb(c)::text) from office.knowledge_candidates c where id=(select v from t.ids where k='flow_candidate')));
select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'approved',current_date+10,'Повторний клік');
select t.ok('approved claim has one Hub record',(select count(*)=1 from office.knowledge_docs where title='Staged factual claim' and status='approved'));
select t.ok('decision is audited exactly once',(select count(*)=1 from office.approvals where scope='knowledge_candidate' and target_id=(select v from t.ids where k='flow_candidate')));
select t.throws('conflicting second decision rejected',$q$select office.review_knowledge_candidate((select v from t.ids where k='flow_candidate'),'rejected',null,'Інше рішення')$q$,'55000');
update office.knowledge_docs set valid_until=current_date where title='Staged factual claim';
commit;
select t.ok('valid through today reaches worker',(select exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'knowledge') k where k->>'title'='Staged factual claim')));
update office.steps set agent_request=jsonb_build_object('governance',jsonb_build_object('data_class','public','knowledge_refs',jsonb_build_array(jsonb_build_object(
 'record_id',(select approved_doc_id from office.knowledge_candidates where id=(select v from t.ids where k='flow_candidate'))))))
 where id='0000000c-0000-4000-8000-000000000051';
update office.knowledge_docs set valid_until=current_date-1 where title='Staged factual claim';
select t.ok('expired claim omitted from content',not exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'knowledge') k where k->>'title'='Staged factual claim'));
select t.ok('expired claim omitted from governance refs',not exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'governance'->'knowledge_refs') k
 where k->>'record_id'=(select approved_doc_id::text from office.knowledge_candidates where id=(select v from t.ids where k='flow_candidate'))));
select t.ok('expired references block an already prepared task',not exists(select 1 from office.executors e,office.steps s where s.id='0000000c-0000-4000-8000-000000000051' and office.gateway_policy_ok(e,s)));
select t.ok('no expiry leaves legacy records available',exists(select 1 from jsonb_array_elements(office.worker_context('0000000c-0000-4000-8000-000000000051')->'knowledge') k where k->>'title'='Покриття'));
-- A task leased while knowledge was current must not accept an answer after expiry.
insert into t.tok select 'expiry_token',office.create_executor('pavutyna','chatgpt','Expiry test');
update office.executors set allowed_seats=array['strategist'] where name='Expiry test';
update office.knowledge_docs set valid_until=current_date+1 where title='Staged factual claim';
insert into office.steps(id,workspace_id,run_id,step_key,agent_role,status,executor,agent_request)
select '0000000c-0000-4000-8000-000000000052',workspace_id,run_id,'expiry_lease','strategist','awaiting_agent','chatgpt',agent_request
 from office.steps where id='0000000c-0000-4000-8000-000000000051';
set role office_app;
insert into t.tok select 'expiry_claim',office.gateway_claim(t.h('expiry_token'),'0000000c-0000-4000-8000-000000000052')::text;
reset role;
select t.ok('fresh knowledge can be leased',(select v::jsonb->>'claimed'='true' from t.tok where k='expiry_claim'));
update office.knowledge_docs set valid_until=current_date-1 where title='Staged factual claim';
set role office_app;
select t.ok('GET withholds context for a leased task after expiry',
 (select r->>'claimable'='false' and not (r ? 'instructions') from (select office.gateway_get(t.h('expiry_token'),'0000000c-0000-4000-8000-000000000052') r) q));
select t.ok('expired answer saved as proposal instead of accepted',
 (select office.gateway_submit(t.h('expiry_token'),(v::jsonb->>'attempt_id')::uuid,v::jsonb->>'lease_token','{}')->>'reason'='knowledge_expired_or_disallowed' from t.tok where k='expiry_claim'));
reset role;
select t.ok('expired answer does not make the step runnable',(select status='awaiting_agent' from office.steps where id='0000000c-0000-4000-8000-000000000052'));
-- Legacy payload: usable source becomes reported; unusable source remains assumption.
insert into office.artifacts(workspace_id,run_id,step_id,kind,title,version,content,content_hash,provider)
select v,'0000000b-0000-4000-8000-000000000050','0000000c-0000-4000-8000-000000000051','legacy_research','Legacy research',1,
 '{"research_candidates":[{"url":"https://example.test/legacy","retrieved_at":"2026-10-20T10:00:00Z","excerpt":"Source excerpt.","proposed_fact":"Legacy finding with a source.","needs_owner_approval":true},{"url":"invalid","retrieved_at":"unknown","excerpt":"No valid source.","proposed_fact":"An unverified legacy finding.","needs_owner_approval":true}]}',
 'legacy-test','stub' from t.ids where k='ws_a';
select t.ok('legacy research imports both rows',(select count(*)=2 from office.knowledge_candidates where research_artifact_id in(select id from office.artifacts where kind='legacy_research')));
select t.ok('unusable source cannot become a verified fact',exists(select 1 from office.knowledge_candidates where claim='An unverified legacy finding.' and confidence='assumption' and sources='[]' and status='candidate'));
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('owner cannot approve assumption',$q$select office.review_knowledge_candidate((select id from office.knowledge_candidates where claim='An unverified legacy finding.'),'approved',current_date+10,'')$q$,'23514');
select t.throws('rejection requires explanation',$q$select office.review_knowledge_candidate((select id from office.knowledge_candidates where claim='An unverified legacy finding.'),'rejected',null,'')$q$,'22023');
select office.review_knowledge_candidate((select id from office.knowledge_candidates where claim='An unverified legacy finding.'),'rejected',null,'Немає першоджерела');
select t.ok('rejected research never publishes',not exists(select 1 from office.knowledge_docs where body='An unverified legacy finding.'));
commit;
\o
select id,case when ok then 'PASS' else 'FAIL' end as result,name from t.results;
select count(*) filter(where ok) as passed,count(*) filter(where not ok) as failed from t.results;
do $$ begin if exists(select 1 from t.results where not ok) then
 raise exception 'Research flow failed: %',(select string_agg(name || ': ' || coalesce(detail,''),'; ') from t.results where not ok);
end if; end $$;
