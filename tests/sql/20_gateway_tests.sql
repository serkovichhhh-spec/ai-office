-- Execution Gateway + OAuth acceptance tests. Runs after 10_office_tests.sql (reuses schema t).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

create table t.tok (k text primary key, v text);
grant select, insert, update on t.tok to public;

-- ---------- fixtures ----------
insert into t.tok values
  ('claude', office.create_executor('pavutyna', 'claude_session', 'Claude scheduled task')),
  ('gpt',    office.create_executor('pavutyna', 'chatgpt', 'ChatGPT Business')),
  ('gpt_b',  office.create_executor('gtu', 'chatgpt', 'ChatGPT GTU'));
insert into t.tok select 'listonly', office.create_executor('pavutyna', 'chatgpt', 'List only');
update office.executors set allowed_ops = array['list'] where name = 'List only';
create function t.h(p_key text) returns text language sql stable as $$
  select encode(sha256(convert_to(v, 'UTF8')), 'hex') from t.tok where k = p_key $$;
grant execute on function t.h(text) to public;

insert into office.briefs (id, workspace_id, title, objective, status)
select '0000000a-0000-4000-8000-000000000001', v, 'Gateway brief', 'Перевірити шлюз', 'active' from t.ids where k = 'ws_a';
insert into office.runs (id, workspace_id, brief_id, playbook_key, status, budget_usd, idempotency_key)
select '0000000b-0000-4000-8000-000000000001', v, '0000000a-0000-4000-8000-000000000001', 'reels_concepts', 'running', 1, 'gateway-run-0001'
from t.ids where k = 'ws_a';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
select '0000000c-0000-4000-8000-000000000001', '0000000b-0000-4000-8000-000000000001', v, 'strategy', 'strategist',
       'awaiting_agent', 'chatgpt',
       '{"schemaName":"strategy","system":"Ти — стратег","user":"<brief>…</brief>","jsonSchema":{"type":"object"}}'
from t.ids where k = 'ws_a';
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, agent_request)
select '0000000c-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000001', v, 'scripts', 'copywriter',
       'awaiting_agent', '{"schemaName":"scripts","system":"Ти — копірайтер","user":"…","jsonSchema":{"type":"object"}}'
from t.ids where k = 'ws_a';
insert into office.artifacts (workspace_id, run_id, kind, title, version, content, content_hash, provider)
select v, '0000000b-0000-4000-8000-000000000001', 'strategy', 'Стратегія', 1, '{"a":1}', 'hash-v1', 'stub' from t.ids where k = 'ws_a';

-- ---------- as the application role (what the MCP server uses) ----------
set role office_app;

select t.throws('unknown token rejected', $q$select office.gateway_list('deadbeef')$q$, '28000');
select t.ok('ChatGPT sees only its task',
  (select jsonb_agg(x->>'step') from jsonb_array_elements(office.gateway_list(t.h('gpt'))) x) = '["strategy"]');
select t.ok('Claude sees only its task',
  (select jsonb_agg(x->>'step') from jsonb_array_elements(office.gateway_list(t.h('claude'))) x) = '["scripts"]');
select t.ok('other workspace executor sees nothing', office.gateway_list(t.h('gpt_b')) = '[]');
select t.throws('other workspace cannot get task',
  $q$select office.gateway_get(t.h('gpt_b'), '0000000c-0000-4000-8000-000000000001')$q$, 'P0002');
select t.ok('envelope is TaskEnvelope.v1 with schema and inputs',
  (select e->>'schema_version' = 'TaskEnvelope.v1' and e->'output_schema' = '{"type":"object"}'
          and jsonb_array_length(e->'inputs') = 1 and (e->>'claimable')::boolean
   from office.gateway_get(t.h('gpt'), '0000000c-0000-4000-8000-000000000001') e));
select t.throws('op not in allowed_ops is refused',
  $q$select office.gateway_claim(t.h('listonly'))$q$, '42501');
select t.ok('cannot claim a task assigned to another executor',
  office.gateway_claim(t.h('claude'), '0000000c-0000-4000-8000-000000000001')->>'reason' = 'not_assigned_to_you_or_not_waiting');

-- claim → stale inputs → saved as proposal
insert into t.tok select 'c1', office.gateway_claim(t.h('gpt'))::text;
select t.ok('claim returns lease token and envelope',
  (select (v::jsonb->>'claimed')::boolean and length(v::jsonb->>'lease_token') = 64
          and v::jsonb->'envelope'->>'task_id' = '0000000c-0000-4000-8000-000000000001' from t.tok where k = 'c1'));
select t.ok('second claim refused', office.gateway_claim(t.h('gpt'), '0000000c-0000-4000-8000-000000000001')->>'reason' = 'already_claimed');
select t.ok('claimed task hidden from list', office.gateway_list(t.h('gpt')) = '[]');
select t.ok('no tasks → claimed=false', office.gateway_claim(t.h('gpt'))->>'reason' = 'no_tasks');
select t.ok('legacy agent_pending skips ChatGPT task',
  not exists (select 1 from office.agent_pending(20) where step_id = '0000000c-0000-4000-8000-000000000001'));
select t.ok('legacy agent_submit refuses ChatGPT task',
  office.agent_submit('0000000c-0000-4000-8000-000000000001', '{"x":1}')->>'reason' = 'assigned_elsewhere');
select t.throws('submit with wrong lease token refused',
  $q$select office.gateway_submit(t.h('gpt'), (select (v::jsonb->>'attempt_id')::uuid from t.tok where k = 'c1'), 'wrong', '{}')$q$, 'P0002');
select t.ok('renew extends active lease',
  (select (office.gateway_renew(t.h('gpt'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token')->>'renewed')::boolean from t.tok where k = 'c1'));
reset role;
insert into office.artifacts (workspace_id, run_id, kind, title, version, content, content_hash, provider)
select v, '0000000b-0000-4000-8000-000000000001', 'strategy', 'Стратегія', 2, '{"a":2}', 'hash-v2', 'stub' from t.ids where k = 'ws_a';
set role office_app;
select t.ok('submit after inputs changed is saved as proposal, not applied',
  (select r->>'reason' = 'inputs_changed' and (r->>'saved_as_proposal')::boolean
   from (select office.gateway_submit(t.h('gpt'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"plan":"old"}') r
         from t.tok where k = 'c1') q));
reset role;
select t.ok('step still waiting after stale submit',
  (select status = 'awaiting_agent' and agent_response is null from office.steps where id = '0000000c-0000-4000-8000-000000000001'));
select t.ok('proposal kept on the attempt',
  (select state = 'rejected' and result = '{"plan":"old"}' from office.execution_attempts
   where id = (select (v::jsonb->>'attempt_id')::uuid from t.tok where k = 'c1')));
set role office_app;

-- fresh claim → accepted
insert into t.tok select 'c2', office.gateway_claim(t.h('gpt'), '0000000c-0000-4000-8000-000000000001')::text;
select t.ok('submit with live lease and current inputs is accepted',
  (select (office.gateway_submit(t.h('gpt'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"plan":"new"}')->>'accepted')::boolean
   from t.tok where k = 'c2'));
select t.ok('double submit refused',
  (select office.gateway_submit(t.h('gpt'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"plan":"again"}')->>'reason' = 'attempt_submitted'
   from t.tok where k = 'c2'));
reset role;
select t.ok('step ready with response, attempt and executor recorded',
  (select status = 'ready' and agent_response->'output' = '{"plan":"new"}' and agent_response->>'executor' = 'chatgpt'
          and agent_response->>'attempt_id' = (select v::jsonb->>'attempt_id' from t.tok where k = 'c2')
   from office.steps where id = '0000000c-0000-4000-8000-000000000001'));
update office.steps set status = 'running' where id = '0000000c-0000-4000-8000-000000000001';
update office.steps set status = 'succeeded' where id = '0000000c-0000-4000-8000-000000000001';
select t.ok('attempt validated when step succeeds',
  (select state = 'validated' from office.execution_attempts where id = (select (v::jsonb->>'attempt_id')::uuid from t.tok where k = 'c2')));

-- expired lease → late result kept as proposal; task claimable again
set role office_app;
insert into t.tok select 'c3', office.gateway_claim(t.h('claude'))::text;
reset role;
update office.execution_attempts set lease_expires_at = now() - interval '1 second'
where id = (select (v::jsonb->>'attempt_id')::uuid from t.tok where k = 'c3');
set role office_app;
select t.ok('expired task visible again', jsonb_array_length(office.gateway_list(t.h('claude'))) = 1);
insert into t.tok select 'late', office.gateway_submit(t.h('claude'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"late":true}')::text
from t.tok where k = 'c3';
select t.ok('late submit saved as proposal',
  (select v::jsonb->>'reason' = 'lease_expired' and (v::jsonb->>'saved_as_proposal')::boolean from t.tok where k = 'late'),
  (select v from t.tok where k = 'late'));
select t.ok('team status counts work per executor',
  (select (s->>'waiting_for_you')::int = 1 and s->'you'->>'kind' = 'claude_session' from office.gateway_status(t.h('claude')) s));
select t.throws('application role cannot read executor tokens', 'select token_hash from office.executors', '42501');
reset role;

-- worker_park assigns the seat's default executor and rejects a submitted answer that failed validation
update office.agents set default_executor = 'chatgpt'
where role_key = 'reviewer' and workspace_id = (select v from t.ids where k = 'ws_a');
insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, locked_by, attempt)
select '0000000c-0000-4000-8000-000000000003', '0000000b-0000-4000-8000-000000000001', v, 'review', 'reviewer', 'running', 'w1', 1
from t.ids where k = 'ws_a';
set role office_app;
select t.ok('park routes to seat default executor',
  office.worker_park('0000000c-0000-4000-8000-000000000003', 'w1', 1, '{"schemaName":"review","jsonSchema":{}}')->>'executor' = 'chatgpt');
insert into t.tok select 'c4', office.gateway_claim(t.h('gpt'), '0000000c-0000-4000-8000-000000000003')::text;
select office.gateway_submit(t.h('gpt'), (v::jsonb->>'attempt_id')::uuid, v::jsonb->>'lease_token', '{"bad":1}') from t.tok where k = 'c4';
reset role;
update office.steps set status = 'running', locked_by = 'w2', attempt = 1 where id = '0000000c-0000-4000-8000-000000000003';
set role office_app;
select office.worker_park('0000000c-0000-4000-8000-000000000003', 'w2', 1, '{"schemaName":"review","note":"missing field verdict"}');
reset role;
select t.ok('invalid submitted answer marks attempt rejected with reason',
  (select state = 'rejected' and rejection_reason = 'missing field verdict' from office.execution_attempts
   where id = (select (v::jsonb->>'attempt_id')::uuid from t.tok where k = 'c4')));

-- ---------- OAuth ----------
set role office_app;
select t.throws('register rejects non-https redirect', $q$select office.oauth_register('x', array['http://evil.example/cb'])$q$, '22023');
insert into t.tok select 'client', office.oauth_register('ChatGPT', array['https://chatgpt.com/connector_platform_oauth_redirect'])->>'client_id';
reset role;

-- RFC 7636 appendix B vector
begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
set local role authenticated;
select t.throws('viewer cannot connect an executor',
  format($q$select office.oauth_authorize(%L, 'https://chatgpt.com/connector_platform_oauth_redirect',
         'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', %L, 'chatgpt')$q$,
         (select v from t.tok where k = 'client'), (select v from t.ids where k = 'ws_a')), '42501');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('authorize rejects unregistered redirect',
  format($q$select office.oauth_authorize(%L, 'https://evil.example/cb', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', %L, 'chatgpt')$q$,
         (select v from t.tok where k = 'client'), (select v from t.ids where k = 'ws_a')), '22023');
insert into t.tok select 'code', office.oauth_authorize((select v from t.tok where k = 'client'),
  'https://chatgpt.com/connector_platform_oauth_redirect', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  (select v from t.ids where k = 'ws_a'), 'chatgpt');
commit;

set role office_app;
select t.ok('wrong PKCE verifier → invalid_grant',
  office.oauth_exchange_code((select v from t.tok where k = 'code'), (select v from t.tok where k = 'client'),
    'https://chatgpt.com/connector_platform_oauth_redirect', 'wrong-verifier-wrong-verifier-wrong-verifier-xx')->>'error' = 'invalid_grant');
insert into t.tok select 'tokens', office.oauth_exchange_code((select v from t.tok where k = 'code'), (select v from t.tok where k = 'client'),
    'https://chatgpt.com/connector_platform_oauth_redirect', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')::text;
select t.ok('correct PKCE verifier issues tokens (RFC 7636 vector)',
  (select v::jsonb->>'token_type' = 'Bearer' and v::jsonb->>'access_token' like 'aio_at_%' from t.tok where k = 'tokens'));
insert into t.tok select 'at', v::jsonb->>'access_token' from t.tok where k = 'tokens';
insert into t.tok select 'rt', v::jsonb->>'refresh_token' from t.tok where k = 'tokens';
select t.ok('OAuth access token works on the gateway',
  office.gateway_status(t.h('at'))->'you'->>'kind' = 'chatgpt');
select t.ok('refresh rotates tokens',
  (office.oauth_refresh((select v from t.tok where k = 'rt'), (select v from t.tok where k = 'client'))->>'access_token') like 'aio_at_%');
select t.ok('refresh token reuse → invalid_grant',
  office.oauth_refresh((select v from t.tok where k = 'rt'), (select v from t.tok where k = 'client'))->>'error' = 'invalid_grant');
select t.throws('reuse revoked the whole token family', $q$select office.gateway_status(t.h('at'))$q$, '28000');
select t.ok('code replay → invalid_grant',
  office.oauth_exchange_code((select v from t.tok where k = 'code'), (select v from t.tok where k = 'client'),
    'https://chatgpt.com/connector_platform_oauth_redirect', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')->>'error' = 'invalid_grant');
select t.throws('application role cannot authorize on behalf of a user',
  $q$select office.oauth_authorize('x','y','z',null,'chatgpt')$q$, '42501');
reset role;

begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('browser user cannot call gateway directly', $q$select office.gateway_list('x')$q$, '42501');
select office.revoke_executor((select id from office.executors where name = 'Claude scheduled task'));
commit;
set role office_app;
select t.throws('revoked executor token stops working', $q$select office.gateway_list(t.h('claude'))$q$, '28000');
reset role;
select t.ok('revocation logged', exists (select 1 from office.events where kind = 'executor.revoked'));

-- ===================== report =====================
\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Gateway SQL tests failed'; end if;
end $$;
