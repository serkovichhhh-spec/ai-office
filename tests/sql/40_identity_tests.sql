-- Identity/capability/independence regression suite. Reuses the isolated acceptance fixtures.
truncate t.results;
insert into t.tok values
  ('i_author',office.create_executor('pavutyna','chatgpt','Author identity')),
  ('i_other',office.create_executor('pavutyna','chatgpt','Reviewer identity'));
select t.ok('existing static executor still authenticates after migration',
  office.gateway_whoami(t.h('gpt'))->>'executor_id' is not null);
select t.ok('whoami exposes separate IDs, labels, mode and capabilities',
  office.gateway_whoami(t.h('i_author'))->>'executor_id' <> office.gateway_whoami(t.h('i_other'))->>'executor_id'
  and office.gateway_whoami(t.h('i_author'))->>'mode' = 'interactive'
  and office.gateway_whoami(t.h('i_author'))->'capabilities' = '{}');

insert into t.ids select 'i_foreign_executor',id from office.executors where name='ChatGPT GTU';

begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
insert into t.tok select 'i_code1',office.oauth_authorize((select v from t.tok where k='client'),
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k='ws_a'),'chatgpt',null,'chatgpt_creative');
insert into t.tok select 'i_code2',office.oauth_authorize((select v from t.tok where k='client'),
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k='ws_a'),'chatgpt',null,'chatgpt_review');
select t.throws('explicit new connection requires label',format($q$select office.oauth_authorize(%L,
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',%L,'chatgpt',null,null)$q$,
  (select v from t.tok where k='client'),(select v from t.ids where k='ws_a')),'22023');
select t.throws('cannot reconnect a different workspace',format($q$select office.oauth_authorize(%L,
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',%L,'chatgpt',%L,null)$q$,
  (select v from t.tok where k='client'),(select v from t.ids where k='ws_a'),
  (select v from t.ids where k='i_foreign_executor')),'42501');
select t.throws('label uniqueness enforced in workspace',format($q$select office.oauth_authorize(%L,
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',%L,'chatgpt',null,'chatgpt_review')$q$,
  (select v from t.tok where k='client'),(select v from t.ids where k='ws_a')),'23505');
insert into t.tok select 'i_code3',office.oauth_authorize((select v from t.tok where k='client'),
  'https://chatgpt.com/connector_platform_oauth_redirect','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k='ws_a'),'chatgpt',(select id from office.executors where label='chatgpt_creative'),null);
commit;
select t.ok('same OAuth client gets two independent identities',
  (select executor_id from office.oauth_codes where code_hash=office.sha256_hex((select v from t.tok where k='i_code1')))
  <> (select executor_id from office.oauth_codes where code_hash=office.sha256_hex((select v from t.tok where k='i_code2'))));
select t.ok('explicit reconnect preserves identity',
  (select executor_id from office.oauth_codes where code_hash=office.sha256_hex((select v from t.tok where k='i_code1')))
  = (select executor_id from office.oauth_codes where code_hash=office.sha256_hex((select v from t.tok where k='i_code3'))));

insert into office.briefs(id,workspace_id,title,objective,status)
select '0000000a-0000-4000-8000-000000000008',v,'Identity isolation','Test','active' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,status,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000008',v,'0000000a-0000-4000-8000-000000000008','creative_ideation','running',1,'identity-suite-0008' from t.ids where k='ws_a';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,executor,requires)
select '0000000c-0000-4000-8000-000000000008','0000000b-0000-4000-8000-000000000008',v,'build','creative','succeeded','chatgpt','{}' from t.ids where k='ws_a';
insert into office.execution_attempts(step_id,run_id,workspace_id,executor_id,state,lease_token_hash,lease_expires_at,result)
select '0000000c-0000-4000-8000-000000000008','0000000b-0000-4000-8000-000000000008',workspace_id,id,'validated','test',now(),'{}' from office.executors where name='Author identity';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,executor,independent_of_step,requires)
select '0000000c-0000-4000-8000-000000000009','0000000b-0000-4000-8000-000000000008',v,'challenge','reviewer','awaiting_agent','chatgpt','0000000c-0000-4000-8000-000000000008',array['web_research'] from t.ids where k='ws_a';
set role office_app;
select t.throws('same concrete author cannot claim review',
  $q$select office.gateway_claim(t.h('i_author'),'0000000c-0000-4000-8000-000000000009')$q$,'42501');
select t.ok('unverified required capability hides task',
  not exists(select 1 from jsonb_array_elements(office.gateway_list(t.h('i_other'))) x where x->>'step'='challenge'));
select t.throws('executor cannot attest its own capability',
  $q$select office.configure_executor(null,'x',null,'{}','interactive')$q$,'42501');
reset role;
begin;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
set local role authenticated;
select t.throws('viewer cannot configure executor',format($q$select office.configure_executor(%L,'test_review',array['reviewer'],'{}','interactive')$q$,
  (select id from office.executors where name='Reviewer identity')),'42501');
commit;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select t.throws('owner cannot verify without evidence',format($q$select office.configure_executor(%L,'test_review',array['reviewer'],
  '{"web_research":{"verified_at":"2026-01-01"}}','interactive')$q$,(select id from office.executors where name='Reviewer identity')),'22023');
select office.configure_executor((select id from office.executors where name='Reviewer identity'),'test_review',array['reviewer'],
  '{"web_research":{"verified_at":"2026-01-01","evidence":"sandbox research acceptance"}}','interactive');
commit;
set role office_app;
select t.ok('verified second ChatGPT can review first ChatGPT',
  (office.gateway_claim(t.h('i_other'),'0000000c-0000-4000-8000-000000000009')->>'claimed')::boolean);
reset role;
select t.ok('labels unique without changing original tokens',
  (select count(*)=count(distinct (workspace_id,label)) from office.executors)
  and office.gateway_whoami(t.h('gpt'))->>'kind'='chatgpt');
select id,name,ok,detail from t.results where not ok;
do $$ begin if exists(select 1 from t.results where not ok) then raise exception 'Identity tests failed'; end if; end $$;
