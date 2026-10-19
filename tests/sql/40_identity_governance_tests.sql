-- 0008: executor identity (W1 in SQL), reviewer independence, data governance, legacy flag.
-- Runs after 30_playbook_tests.sql (reuses schema t, fixtures ws_a/ws_b, t.tok, t.h).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

select t.ok('every executor has a label and provider',
  not exists (select 1 from office.executors where label is null or provider is null));
select t.ok('label is unique per workspace among active executors',
  (select count(*) = count(distinct (workspace_id, label)) from office.executors where revoked_at is null));

-- ---------- W1: two connections from the SAME OAuth client are two executors ----------
set role office_app;
insert into t.tok select 'w1client', office.oauth_register('ChatGPT', array['https://chatgpt.com/connector_platform_oauth_redirect'])->>'client_id';
reset role;

begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
insert into t.tok select 'code_a', office.oauth_authorize((select v from t.tok where k = 'w1client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k = 'ws_a'), 'chatgpt', null, 'gpt-a');
insert into t.tok select 'code_b', office.oauth_authorize((select v from t.tok where k = 'w1client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k = 'ws_a'), 'chatgpt', null, 'gpt-b');
select t.throws('label is required for a new executor',
  format($q$select office.oauth_authorize(%L, 'https://chatgpt.com/connector_platform_oauth_redirect',
         'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', %L, 'chatgpt', null, '')$q$,
         (select v from t.tok where k = 'w1client'), (select v from t.ids where k = 'ws_a')), '22023');
select t.throws('duplicate label refused',
  format($q$select office.oauth_authorize(%L, 'https://chatgpt.com/connector_platform_oauth_redirect',
         'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', %L, 'chatgpt', null, 'gpt-a')$q$,
         (select v from t.tok where k = 'w1client'), (select v from t.ids where k = 'ws_a')), '22023');
commit;

set role office_app;
insert into t.tok select 'tok_a', office.oauth_exchange_code((select v from t.tok where k = 'code_a'), (select v from t.tok where k = 'w1client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')::jsonb->>'access_token';
insert into t.tok select 'tok_b', office.oauth_exchange_code((select v from t.tok where k = 'code_b'), (select v from t.tok where k = 'w1client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')::jsonb->>'access_token';
select t.ok('W1.1 gpt-a and gpt-b are different executors with their own labels',
  (select a->'you'->>'executor_id' <> b->'you'->>'executor_id' and a->'you'->>'label' = 'gpt-a' and b->'you'->>'label' = 'gpt-b'
   from (select office.gateway_status(t.h('tok_a')) a, office.gateway_status(t.h('tok_b')) b) q));
reset role;

-- a fresh run with an author step and an independent review step, both for ChatGPT
insert into office.briefs (id, workspace_id, title, objective, status)
select '0000000a-0000-4000-8000-000000000040', v, 'Independence', 'Перевірити незалежність', 'active' from t.ids where k = 'ws_a';
insert into office.runs (id, workspace_id, brief_id, playbook_key, status, budget_usd, idempotency_key)
select '0000000b-0000-4000-8000-000000000040', v, '0000000a-0000-4000-8000-000000000040', 'reels_concepts', 'running', 1, 'independence-run-0040'
from t.ids where k = 'ws_a';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select '0000000c-0000-4000-8000-000000000041', '0000000b-0000-4000-8000-000000000040', v, 'copy', 'copywriter', 'awaiting_agent', 'chatgpt',
  '{"schemaName":"copy","system":"Ти — копірайтер","user":"…","jsonSchema":{"type":"object"},"governance":{"data_class":"internal","knowledge_refs":[{"record_id":"k1"}],"excluded_count":1}}'
from t.ids where k = 'ws_a';

set role office_app;
select t.ok('W1.2 gpt-b without seats sees nothing', office.gateway_list(t.h('tok_b')) = '[]');
select t.ok('gpt-b without seats cannot claim', office.gateway_claim(t.h('tok_b'), '0000000c-0000-4000-8000-000000000041')->>'claimed' = 'false');
reset role;

begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select office.set_executor_seats((select id from office.executors where label = 'gpt-b'), array['copywriter']);
select office.set_executor_seats((select id from office.executors where label = 'gpt-a'), array['copywriter','reviewer']);
select t.throws('unknown seat refused',
  $q$select office.set_executor_seats((select id from office.executors where label = 'gpt-a'), array['astronaut'])$q$, '22023');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
set local role authenticated;
select t.throws('viewer cannot change seats',
  $q$select office.set_executor_seats((select id from office.executors where label = 'gpt-b'), array['reviewer'])$q$, '42501');
commit;

set role office_app;
select t.ok('W1.3 gpt-b with copywriter seat sees only copywriter steps',
  (select bool_and(x->>'seat' = 'copywriter') and count(*) >= 1 from jsonb_array_elements(office.gateway_list(t.h('tok_b'), 20)) x));
insert into t.tok select 'cb', office.gateway_claim(t.h('tok_b'), '0000000c-0000-4000-8000-000000000041')::text;
select t.ok('claim payload carries data_class in the envelope',
  (select v::jsonb->'envelope'->>'data_class' = 'internal' from t.tok where k = 'cb'));
select office.gateway_submit(t.h('tok_b'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"text":"ok"}') from t.tok where k = 'cb';
reset role;

insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, independent_of_step, agent_request)
select '0000000c-0000-4000-8000-000000000042', '0000000b-0000-4000-8000-000000000040', v, 'copy_review', 'copywriter', 'awaiting_agent',
  'chatgpt', 'copy', '{"schemaName":"review","system":"Рецензент","user":"…","jsonSchema":{"type":"object"}}'
from t.ids where k = 'ws_a';

set role office_app;
select t.ok('W1.4 author (gpt-b) cannot review own text: not_independent',
  office.gateway_claim(t.h('tok_b'), '0000000c-0000-4000-8000-000000000042')->>'reason' = 'not_independent');
select t.ok('review hidden from the author in list',
  not exists (select 1 from jsonb_array_elements(office.gateway_list(t.h('tok_b'), 20)) x where x->>'step_id' = '0000000c-0000-4000-8000-000000000042'));
select t.ok('W1.4 another executor (gpt-a) may review it',
  (office.gateway_claim(t.h('tok_a'), '0000000c-0000-4000-8000-000000000042')->>'claimed')::boolean);
reset role;

select t.ok('W1.6 events carry executor_id and label',
  (select count(*) = 2 from office.events where kind = 'attempt.claimed' and run_id = '0000000b-0000-4000-8000-000000000040'
     and payload ? 'executor_id' and payload->>'executor_label' in ('gpt-a','gpt-b')));

-- W1.5 revoke gpt-b: gpt-a keeps working, gpt-b token stops
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select office.revoke_executor((select id from office.executors where label = 'gpt-b' and revoked_at is null));
commit;
set role office_app;
select t.throws('W1.5 revoked gpt-b token refused', $q$select office.gateway_status(t.h('tok_b'))$q$, '28000');
select t.ok('W1.5 gpt-a still works', office.gateway_status(t.h('tok_a'))->'you'->>'label' = 'gpt-a');
reset role;

-- reconnect an existing executor instead of creating a new one
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
insert into t.tok select 'code_re', office.oauth_authorize((select v from t.tok where k = 'w1client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k = 'ws_a'), 'chatgpt', (select id from office.executors where label = 'gpt-a'), null);
select t.throws('cannot reconnect a revoked executor',
  format($q$select office.oauth_authorize(%L, 'https://chatgpt.com/connector_platform_oauth_redirect',
         'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', %L, 'chatgpt', %L, null)$q$,
         (select v from t.tok where k = 'w1client'), (select v from t.ids where k = 'ws_a'),
         (select id from office.executors where label = 'gpt-b')), '22023');
commit;
select t.ok('reconnect reuses the same executor',
  (select executor_id = (select id from office.executors where label = 'gpt-a') from office.oauth_codes
   where code_hash = office.sha256_hex((select v from t.tok where k = 'code_re'))));

insert into t.tok select 'fresh', office.create_executor('pavutyna', 'grok', 'Grok test');
select t.ok('create_executor: grok allowed, provider xai, no seats',
  (select kind = 'grok' and provider = 'xai' and allowed_seats = '{}' and label like 'grok_%' from office.executors where name = 'Grok test'));

-- ---------- governance ----------
select t.ok('knowledge defaults to internal', not exists (select 1 from office.knowledge_docs where data_class <> 'internal'));
insert into office.knowledge_docs (workspace_id, kind, title, body, status, data_class)
select v, 'fact', 'Бюджет Q4', 'Конфіденційні цифри', 'approved', 'confidential' from t.ids where k = 'ws_a';
insert into office.knowledge_docs (workspace_id, kind, title, body, status, data_class)
select v, 'fact', 'Телефони абонентів', 'Персональні дані', 'approved', 'personal' from t.ids where k = 'ws_a';

-- worker context for a Claude step and a ChatGPT step of the same workspace
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor)
select '0000000c-0000-4000-8000-000000000043', '0000000b-0000-4000-8000-000000000040', v, 'g_claude', 'strategist', 'ready', 'claude_session'
from t.ids where k = 'ws_a';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor)
select '0000000c-0000-4000-8000-000000000044', '0000000b-0000-4000-8000-000000000040', v, 'g_gpt', 'strategist', 'ready', 'chatgpt'
from t.ids where k = 'ws_a';
set role office_app;
select t.ok('Claude (internal max) gets no confidential and no personal knowledge',
  (select not exists (select 1 from jsonb_array_elements(c->'knowledge') k where k->>'data_class' in ('confidential','personal'))
          and (c->'governance'->>'excluded_count')::int = 2 and c->'governance'->>'provider' = 'anthropic'
   from office.worker_context('0000000c-0000-4000-8000-000000000043') c));
select t.ok('ChatGPT Business (confidential max) gets confidential but never personal',
  (select exists (select 1 from jsonb_array_elements(c->'knowledge') k where k->>'data_class' = 'confidential')
          and not exists (select 1 from jsonb_array_elements(c->'knowledge') k where k->>'data_class' = 'personal')
          and c->'governance'->>'data_class' = 'confidential'
   from office.worker_context('0000000c-0000-4000-8000-000000000044') c));
select t.ok('knowledge refs carry record_id and version',
  (select bool_and(r ? 'record_id' and r ? 'version') from office.worker_context('0000000c-0000-4000-8000-000000000044') c,
          jsonb_array_elements(c->'governance'->'knowledge_refs') r));
reset role;

-- stale verification narrows to public; unknown provider is denied
update office.provider_policies set verified_at = now() - interval '91 days' where provider = 'anthropic';
set role office_app;
select t.ok('policy not re-verified for 90 days → only public',
  (select c->'governance'->>'max_data_class' = 'public' and jsonb_array_length(c->'knowledge') = 0
   from office.worker_context('0000000c-0000-4000-8000-000000000043') c));
reset role;
update office.provider_policies set verified_at = now() where provider = 'anthropic';

-- gate at the gateway: a confidential step is not handed to an internal-only provider
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select '0000000c-0000-4000-8000-000000000045', '0000000b-0000-4000-8000-000000000040', v, 'conf', 'copywriter', 'awaiting_agent', 'grok',
  '{"schemaName":"copy","system":"…","user":"…","jsonSchema":{"type":"object"},"governance":{"data_class":"confidential"}}'
from t.ids where k = 'ws_a';
update office.executors set allowed_seats = array['copywriter'] where name = 'Grok test';
set role office_app;
select t.ok('confidential step hidden from xai (internal max)', office.gateway_list(t.h('fresh')) = '[]');
select t.ok('confidential step cannot be claimed by xai',
  office.gateway_claim(t.h('fresh'), '0000000c-0000-4000-8000-000000000045')->>'reason' = 'data_class_above_provider_policy');
select t.ok('get returns no envelope content',
  (select not (g ? 'instructions') and g->>'reason' = 'data_class_above_provider_policy'
   from office.gateway_get(t.h('fresh'), '0000000c-0000-4000-8000-000000000045') g));
reset role;
select t.ok('blocked access is logged', exists (select 1 from office.events where kind = 'governance.blocked'));
update office.settings set value = 'false' where workspace_id is null and key = 'governance_enforced';
set role office_app;
select t.ok('flag off → policy only logged, not enforced', jsonb_array_length(office.gateway_list(t.h('fresh'))) = 1);
reset role;
update office.settings set value = 'true' where workspace_id is null and key = 'governance_enforced';

select t.ok('every claim recorded in external_transfers with provider, class and refs',
  (select count(*) >= 2 and bool_and(provider = 'openai' and envelope_sha256 ~ '^[0-9a-f]{64}$')
   from office.external_transfers where run_id = '0000000b-0000-4000-8000-000000000040' and op = 'claim'));
select t.ok('transfer keeps knowledge refs and excluded count',
  exists (select 1 from office.external_transfers where step_id = '0000000c-0000-4000-8000-000000000041'
          and knowledge_refs = '[{"record_id":"k1"}]' and excluded_count = 1));
set role office_app;
select office.gateway_get(t.h('tok_a'), '0000000c-0000-4000-8000-000000000042');
select office.gateway_get(t.h('tok_a'), '0000000c-0000-4000-8000-000000000042');
reset role;
select t.ok('repeated get of the same envelope within 10 minutes is deduplicated',
  (select count(*) = 1 from office.external_transfers where step_id = '0000000c-0000-4000-8000-000000000042'));

begin;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true);
set local role authenticated;
select t.ok('outsider sees no transfers', not exists (select 1 from office.external_transfers));
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.ok('owner sees transfers of own workspace', exists (select 1 from office.external_transfers));
select t.throws('users cannot write transfers',
  $q$insert into office.external_transfers (workspace_id, provider, op, data_class, envelope_sha256) values (gen_random_uuid(), 'x', 'get', 'public', 'x')$q$, '42501');
select t.throws('users cannot change provider policies', $q$update office.provider_policies set max_data_class = 'confidential'$q$, '42501');
update office.knowledge_docs set data_class = 'confidential' where title = 'Покриття';
select t.ok('owner can set knowledge data class', (select data_class = 'confidential' from office.knowledge_docs where title = 'Покриття'));
commit;

-- ---------- legacy flag ----------
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select '0000000c-0000-4000-8000-000000000046', '0000000b-0000-4000-8000-000000000040', v, 'legacy', 'strategist', 'awaiting_agent', 'claude_session',
  '{"schemaName":"x"}' from t.ids where k = 'ws_a';
select t.ok('legacy path on: step visible', exists (select 1 from office.agent_pending(20) where step_id = '0000000c-0000-4000-8000-000000000046'));
update office.settings set value = 'false' where workspace_id is null and key = 'legacy_agent_api';
select t.ok('legacy path off: agent_pending empty',
  not exists (select 1 from office.agent_pending(20) where step_id = '0000000c-0000-4000-8000-000000000046'));
select t.ok('legacy path off: agent_submit refused',
  office.agent_submit('0000000c-0000-4000-8000-000000000046', '{"x":1}')->>'reason' = 'legacy_disabled');
select t.ok('bypass attempt logged', exists (select 1 from office.events where kind = 'gateway.bypass_detected'));
update office.settings set value = 'true' where workspace_id is null and key = 'legacy_agent_api';
select t.ok('legacy path on again: submit accepted',
  office.agent_submit('0000000c-0000-4000-8000-000000000046', '{"x":1}')->>'accepted' = 'true');
select t.ok('legacy use is logged', exists (select 1 from office.events where kind = 'gateway.legacy_used'));

-- next_steps from a playbook carry independence and grok
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, locked_by, attempt)
select '0000000c-0000-4000-8000-000000000047', '0000000b-0000-4000-8000-000000000040', v, 'plan', 'orchestrator', 'running', 'w9', 1
from t.ids where k = 'ws_a';
set role office_app;
select office.worker_complete('0000000c-0000-4000-8000-000000000047', 'w9', 1,
  '{"output":{},"next_steps":[{"step_key":"review_x","agent_role":"reviewer","executor":"grok","independent_of_step":"copy"}]}');
reset role;
select t.ok('worker_complete stores executor grok and independent_of_step',
  exists (select 1 from office.steps where step_key = 'review_x' and executor = 'grok' and independent_of_step = 'copy'));

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Identity/governance SQL tests failed'; end if;
end $$;
