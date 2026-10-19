truncate t.results;
select t.ok('all workspaces start with automatic triggers disabled',not exists(select 1 from office.automation_settings where triggers_enabled));
insert into t.tok values('tr_exec',office.create_executor('pavutyna','chatgpt','Sandbox trigger executor'));
insert into office.briefs(id,workspace_id,title,objective,status)
select '0000000a-0000-4000-8000-000000000070',v,'Trigger test','Bounded trigger test','active' from t.ids where k='ws_a';
insert into office.runs(id,workspace_id,brief_id,playbook_key,status,budget_usd,idempotency_key)
select '0000000b-0000-4000-8000-000000000070',v,'0000000a-0000-4000-8000-000000000070','owned_media_copy','running',1,'trigger-suite-0070' from t.ids where k='ws_a';
insert into office.steps(id,run_id,workspace_id,step_key,agent_role,status,executor,input)
select '0000000c-0000-4000-8000-000000000070','0000000b-0000-4000-8000-000000000070',v,'build','copywriter','awaiting_agent','chatgpt','{"routing_policy":"capabilities"}' from t.ids where k='ws_a';
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.configure_executor((select id from office.executors where name='Sandbox trigger executor'),'chatgpt_agent_test',array['copywriter'],'{}','triggered');
select t.throws('channel cannot reference an arbitrary server environment secret',
 format($q$select office.configure_trigger_channel(%L,%L,'agtch_test','DATABASE_URL',array['copywriter'],'{}',false)$q$,
 (select v from t.ids where k='ws_a'),(select id from office.executors where name='Sandbox trigger executor')),'23514');
select t.throws('enabled channel requires price evidence',
 format($q$select office.configure_trigger_channel(%L,%L,'agtch_test','OFFICE_AGENT_TEST',array['copywriter'],'{}',true)$q$,
 (select v from t.ids where k='ws_a'),(select id from office.executors where name='Sandbox trigger executor')),'22023');
insert into t.tok select 'tr_channel',office.configure_trigger_channel((select v from t.ids where k='ws_a'),
 (select id from office.executors where name='Sandbox trigger executor'),'agtch_test','OFFICE_AGENT_TEST',array['copywriter'],
 '{"max_runs_per_day":5,"max_concurrent":1,"max_credits_per_month":10,"est_credits_per_run":1,"price_evidence":"isolated test estimate"}',true)::text;
commit;
set role office_app;
select t.ok('channel alone cannot bypass workspace disable switch',office.trigger_next(array['pavutyna']) is null);
reset role;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.set_automation((select v from t.ids where k='ws_a'),true);
commit;
set role office_app;
insert into t.tok select 'tr1',office.trigger_next(array['pavutyna'])::text;
select t.ok('reservation targets awaiting_agent, not unclaimable ready steps',
 (select v::jsonb->>'step_id'='0000000c-0000-4000-8000-000000000070' and length(v::jsonb->>'idempotency_key')=64 and v::jsonb->>'http_attempts'='1' from t.tok where k='tr1'));
select t.ok('another tick cannot reserve the same dispatch lease',office.trigger_next(array['pavutyna']) is null);
select office.trigger_finish((v::jsonb->>'id')::uuid,(v::jsonb->>'dispatch_token')::uuid,500,null,'http_500') from t.tok where k='tr1';
reset role;
update office.trigger_runs set next_retry_at=now()-interval '1 second' where id=(select (v::jsonb->>'id')::uuid from t.tok where k='tr1');
set role office_app;
insert into t.tok select 'tr1_retry',office.trigger_next(array['pavutyna'])::text;
select t.ok('transient retry reuses ID and idempotency key',
 (select a.v::jsonb->>'id'=b.v::jsonb->>'id' and a.v::jsonb->>'idempotency_key'=b.v::jsonb->>'idempotency_key'
 and b.v::jsonb->>'http_attempts'='2' from t.tok a,t.tok b where a.k='tr1' and b.k='tr1_retry'));
select office.trigger_finish((v::jsonb->>'id')::uuid,(v::jsonb->>'dispatch_token')::uuid,202,'apirun_test_70',null) from t.tok where k='tr1_retry';
insert into t.tok select 'tr_claim',office.gateway_claim(t.h('tr_exec'),'0000000c-0000-4000-8000-000000000070')::text;
reset role;
select t.ok('MCP claim links trigger to the exact execution attempt',
 (select attempt_id=(select (v::jsonb->>'attempt_id')::uuid from t.tok where k='tr_claim') from office.trigger_runs where id=(select (v::jsonb->>'id')::uuid from t.tok where k='tr1')));
set role office_app;
select office.trigger_observe((v::jsonb->>'id')::uuid,'completed',200) from t.tok where k='tr1';
reset role;
select t.ok('provider completed without submit fails and frees the lease for interactive fallback',
 (select status='failed' and error_code='no_submit' from office.trigger_runs where id=(select (v::jsonb->>'id')::uuid from t.tok where k='tr1'))
 and (select state='released' from office.execution_attempts where id=(select (v::jsonb->>'attempt_id')::uuid from t.tok where k='tr_claim'))
 and (select status='awaiting_agent' from office.steps where id='0000000c-0000-4000-8000-000000000070'));
set role office_app;
insert into t.tok select 'tr2',office.trigger_next(array['pavutyna'])::text;
reset role;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.set_automation((select v from t.ids where k='ws_a'),false);
commit;
set role office_app;
select t.ok('owner kill switch blocks a previously reserved unsent event',
 (select not office.trigger_can_send((v::jsonb->>'id')::uuid,(v::jsonb->>'dispatch_token')::uuid) from t.tok where k='tr2'));
select office.trigger_finish((v::jsonb->>'id')::uuid,(v::jsonb->>'dispatch_token')::uuid,0,null,'disabled_before_dispatch') from t.tok where k='tr2';
reset role;
select t.ok('kill-switch event is skipped, not retried',
 (select status='skipped' from office.trigger_runs where id=(select (v::jsonb->>'id')::uuid from t.tok where k='tr2')));
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
set local role authenticated;
select office.set_automation((select v from t.ids where k='ws_a'),true);
commit;
set role office_app;
insert into t.tok select 'tr3',office.trigger_next(array['pavutyna'])::text;
select t.ok('reenabling after an unsent skip does not collide with the old key',
 (select v::jsonb->>'id' is not null from t.tok where k='tr3'));
select office.trigger_finish((v::jsonb->>'id')::uuid,(v::jsonb->>'dispatch_token')::uuid,401,null,'http_401') from t.tok where k='tr3';
reset role;
select t.ok('authentication failure disables channel and records reason',
 (select not enabled and paused_reason='http_401' from office.trigger_channels where id=(select v::uuid from t.tok where k='tr_channel')));
select t.ok('estimated credits are reserved once per logical event, not per HTTP retry',
 (select sum(est_credits) filter(where status<>'skipped')=2 from office.trigger_runs where channel_id=(select v::uuid from t.tok where k='tr_channel')));
begin;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444"}',true);
set local role authenticated;
select t.throws('editor cannot turn automation on',format($q$select office.set_automation(%L,true)$q$,(select v from t.ids where k='ws_a')),'42501');
commit;
select t.throws('NaN credit limits cannot bypass the monthly budget',
 $q$update office.trigger_channels set max_credits_per_month='NaN'::numeric$q$,'23514');
select t.throws('infinite estimated credit prices are rejected',
 $q$update office.trigger_channels set est_credits_per_run='Infinity'::numeric$q$,'23514');
-- A disabled office rejects new agent claims, without changing interactive identities.
update office.automation_settings set triggers_enabled=false,kill_switch_at=now() where workspace_id=(select v from t.ids where k='ws_a');
set role office_app;
select t.throws('kill switch rejects new triggered claims',
 $q$select office.gateway_claim(t.h('tr_exec'),'0000000c-0000-4000-8000-000000000070')$q$,'42501');
reset role;
update office.automation_settings set triggers_enabled=true,kill_switch_at=null where workspace_id=(select v from t.ids where k='ws_a');
update office.trigger_channels set enabled=true,max_credits_per_month=1 where id=(select v::uuid from t.tok where k='tr_channel');
set role office_app;
select office.trigger_next(array['pavutyna']);
reset role;
select t.ok('monthly credit ceiling pauses the channel',
 (select not enabled and paused_reason='credit_cap' from office.trigger_channels where id=(select v::uuid from t.tok where k='tr_channel')));
update office.trigger_channels set enabled=true,max_credits_per_month=100 where id=(select v::uuid from t.tok where k='tr_channel');
update office.trigger_runs set status='failed' where channel_id=(select v::uuid from t.tok where k='tr_channel');
insert into office.trigger_runs(channel_id,workspace_id,run_id,step_id,idempotency_key,status)
 select channel_id,workspace_id,run_id,step_id,'circuit-breaker-fixture','failed' from office.trigger_runs where channel_id=(select v::uuid from t.tok where k='tr_channel') limit 1;
set role office_app;
select office.trigger_next(array['pavutyna']);
reset role;
select t.ok('three consecutive logical failures pause the channel',
 (select not enabled and paused_reason='consecutive_failures' from office.trigger_channels where id=(select v::uuid from t.tok where k='tr_channel')));
select id,name,detail from t.results where not ok;
do $$ begin if exists(select 1 from t.results where not ok) then raise exception 'Trigger tests failed';end if;end $$;
