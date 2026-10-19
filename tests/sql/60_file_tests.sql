truncate t.results;
insert into office.briefs(id,workspace_id,title,objective,status)
select '0000000a-0000-4000-8000-000000000060',v,'File lease test','Test attachments','active' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,status,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000060',v,'0000000a-0000-4000-8000-000000000060','owned_media_copy','running',1,'file-suite-0060' from t.ids where k='ws_a';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,executor,input)
select '0000000c-0000-4000-8000-000000000060','0000000b-0000-4000-8000-000000000060',v,'build','copywriter','awaiting_agent','chatgpt','{"routing_policy":"capabilities"}' from t.ids where k='ws_a';
set role office_app;
insert into t.tok select 'f_claim',office.gateway_claim(t.h('i_author'),'0000000c-0000-4000-8000-000000000060')::text;
select t.ok('valid lease authorizes attachment to exact run',
 (select office.gateway_file_lease(t.h('i_author'),'0000000c-0000-4000-8000-000000000060',(v::jsonb->>'attempt_id')::uuid,v::jsonb->>'lease_token')->>'run_id'='0000000b-0000-4000-8000-000000000060' from t.tok where k='f_claim'));
select t.throws('another executor cannot borrow attachment lease',
 $q$select office.gateway_file_lease(t.h('i_other'),'0000000c-0000-4000-8000-000000000060',(select (v::jsonb->>'attempt_id')::uuid from t.tok where k='f_claim'),(select v::jsonb->>'lease_token' from t.tok where k='f_claim'))$q$,'42501');
insert into t.tok select 'f_file',office.gateway_attach_file(t.h('i_author'),'0000000c-0000-4000-8000-000000000060',
 (v::jsonb->>'attempt_id')::uuid,v::jsonb->>'lease_token',
 jsonb_build_object('sha256',repeat('a',64),'mime_type','image/png','byte_size',100,'width',1,'height',1,'original_name','test.png','purpose','Reference','source_file_id','file_test'))::text from t.tok where k='f_claim';
select t.ok('duplicate hash deduplicates within run',
 (select (office.gateway_attach_file(t.h('i_author'),'0000000c-0000-4000-8000-000000000060',(v::jsonb->>'attempt_id')::uuid,v::jsonb->>'lease_token',
 jsonb_build_object('sha256',repeat('a',64),'mime_type','image/png','byte_size',100,'width',1,'height',1,'original_name','duplicate.png','purpose','Repeat'))->>'deduplicated')::boolean from t.tok where k='f_claim'));
select t.ok('envelope exposes same-run file references',
 (select office.gateway_get(t.h('i_author'),'0000000c-0000-4000-8000-000000000060')->'files'->0->>'file_ref'=v::jsonb->>'file_ref' from t.tok where k='f_file'));
select t.throws('other workspace cannot read file',
 $q$select office.gateway_get_file(t.h('gpt_b'),(select v::jsonb->>'file_ref' from t.tok where k='f_file'),null)$q$,'P0002');
select t.throws('same workspace without relevant seat cannot read file',
 $q$select office.gateway_get_file(t.h('i_other'),(select v::jsonb->>'file_ref' from t.tok where k='f_file'),null)$q$,'P0002');
select t.ok('unknown nested file ref rejected and lease kept',
 (select office.gateway_submit(t.h('i_author'),(v::jsonb->>'attempt_id')::uuid,v::jsonb->>'lease_token','{"nested":[{"file_ref":"aio_file_00000000-0000-4000-8000-000000000999"}]}')->>'reason'='unknown_file_ref' from t.tok where k='f_claim'));
reset role;
select t.ok('rejected reference did not consume lease',
 exists(select 1 from office.execution_attempts where id=(select (v::jsonb->>'attempt_id')::uuid from t.tok where k='f_claim') and state='claimed'));
select t.ok('stored file has complete execution provenance and private namespace',
 (select step_id='0000000c-0000-4000-8000-000000000060' and attempt_id is not null and executor_id is not null
 and source='fileparams' and storage_path=workspace_id::text||'/'||run_id::text||'/'||repeat('a',64)||'.png'
 from office.artifact_files where sha256=repeat('a',64)));
select t.ok('bucket is private', (select not public from storage.buckets where id='office-files'));
set role office_app;
select t.ok('same-run file ref accepted in nested output',
 (select (office.gateway_submit(t.h('i_author'),(c.v::jsonb->>'attempt_id')::uuid,c.v::jsonb->>'lease_token',jsonb_build_object('files',jsonb_build_array(f.v::jsonb->>'file_ref')))->>'accepted')::boolean
 from t.tok c,t.tok f where c.k='f_claim' and f.k='f_file'));
select t.throws('submitted lease cannot attach more files',
 $q$select office.gateway_file_lease(t.h('i_author'),'0000000c-0000-4000-8000-000000000060',(select (v::jsonb->>'attempt_id')::uuid from t.tok where k='f_claim'),(select v::jsonb->>'lease_token' from t.tok where k='f_claim'))$q$,'42501');
reset role;
begin;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
set local role authenticated;
select t.ok('file metadata RLS isolates workspaces',(select count(*)=0 from office.artifact_files));
select t.throws('browser cannot insert file metadata directly',
 $q$insert into office.artifact_files(id) values(gen_random_uuid())$q$,'42501');
commit;
select id,name,detail from t.results where not ok;
do $$ begin if exists(select 1 from t.results where not ok) then raise exception 'File tests failed';end if;end $$;
