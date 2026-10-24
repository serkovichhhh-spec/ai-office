-- 0012: Capability Router (verified-only fallback) + Trigger Gateway state machine.
-- Isolated in workspace gtu (owner 2222…); runs after all earlier tests (reuses t.ok / t.tok / t.h).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

-- ---------- fixtures ----------
insert into t.tok values
  ('r_claude', office.create_executor('gtu', 'claude_session', 'Router Claude')),
  ('r_claude2', office.create_executor('gtu', 'claude_session', 'Router Claude 2')),
  ('r_gpt', office.create_executor('gtu', 'chatgpt', 'Router ChatGPT')),
  ('r_grok', office.create_executor('gtu', 'grok', 'Router Grok'));
update office.executors set allowed_seats = '{copywriter,strategist}', verified_at = now() where name = 'Router Claude';
update office.executors set allowed_seats = '{copywriter}' where name = 'Router Claude 2';
update office.executors x set allowed_seats = (select array_agg(a.role_key) from office.agents a where a.workspace_id = x.workspace_id),
  verified_at = now() where name in ('Router ChatGPT', 'Router Grok');
-- Even a verified Grok placed first in the chain must never be chosen automatically.
insert into office.settings (workspace_id, key, value)
select v, 'fallback_chains', '{"claude_session":["grok","chatgpt"],"chatgpt":["grok","claude_session"]}' from t.ids where k = 'ws_b';

create function t.ex(p_name text) returns uuid language sql stable as $$ select id from office.executors where name = p_name $$;
create function t.st(p_n int) returns uuid language sql immutable as $$
  select ('0000000c-0000-4000-8000-0000000007' || lpad(p_n::text, 2, '0'))::uuid $$;
create function t.mkstep(p_n int, p_seat text, p_exec text, p_class text default 'internal') returns void language sql as $$
  insert into office.steps (id, run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
  select t.st(p_n), '0000000b-0000-4000-8000-000000000070', v, 'step_' || chr(96 + p_n), p_seat, 'awaiting_agent', p_exec,
         jsonb_build_object('schemaName', 'scripts', 'system', 's', 'user', 'u' || p_n, 'jsonSchema', '{"type":"object"}'::jsonb,
                            'governance', jsonb_build_object('data_class', p_class))
  from t.ids where k = 'ws_b' $$;
create function t.exec_of(p_n int) returns text language sql stable as $$ select executor from office.steps where id = t.st(p_n) $$;
grant execute on all functions in schema t to public;

insert into office.briefs (id, workspace_id, title, objective, status)
select '0000000a-0000-4000-8000-000000000070', v, 'Router brief', 'Перевірити маршрутизацію', 'active' from t.ids where k = 'ws_b';
insert into office.runs (id, workspace_id, brief_id, playbook_key, status, budget_usd, idempotency_key)
select '0000000b-0000-4000-8000-000000000070', v, '0000000a-0000-4000-8000-000000000070', 'reels_concepts', 'running', 1, 'router-run-0070'
from t.ids where k = 'ws_b';

select t.mkstep(1, 'copywriter', 'claude_session');                  -- A: plain Claude text step
select t.mkstep(2, 'copywriter', 'claude_session', 'confidential');  -- C: above Anthropic's data class
select t.mkstep(3, 'reviewer', 'claude_session');                    -- F: no Claude executor holds the seat

-- ---------- Router ----------
select t.ok('verified executors were not auto-marked before they existed (backfill only for ≥3 validated)',
  not exists (select 1 from office.executors where verified_note like 'auto:%' and name like 'Router%'));
select office.router_tick();
select t.ok('available original executor keeps the step', t.exec_of(1) = 'claude_session');
select t.ok('confidential step leaves Claude for verified ChatGPT, never Grok',
  t.exec_of(2) = 'chatgpt' and (select routed_from from office.steps where id = t.st(2)) = 'claude_session');
select t.ok('fallback logged with reason data_policy',
  exists (select 1 from office.events where step_id = t.st(2) and kind = 'route.fallback'
          and payload->>'to' = 'chatgpt' and payload->>'reason' = 'data_policy'));
select t.ok('missing seat is a configuration stop, not a silent move',
  t.exec_of(3) = 'claude_session' and (select route_blocked from office.steps where id = t.st(3)) = 'no_verified_executor'
  and exists (select 1 from office.events where step_id = t.st(3) and kind = 'route.blocked' and payload->>'reason' = 'no_executor_for_seat'));
select office.router_tick();
select t.ok('route.blocked is announced once', (select count(*) from office.events where step_id = t.st(3) and kind = 'route.blocked') = 1);

-- Acceptance (§17.1): artificial Claude usage limit → the step moves to ChatGPT within one worker tick.
insert into office.provider_limits (workspace_id, provider, limited_until, reason)
select v, 'anthropic', now() + interval '5 hours', 'USAGE_LIMIT_REACHED' from t.ids where k = 'ws_b';
select office.router_tick();
select t.ok('usage limit: Claude step rerouted to ChatGPT', t.exec_of(1) = 'chatgpt');
select t.ok('reason provider_limit', exists (select 1 from office.events where step_id = t.st(1) and kind = 'route.fallback'
  and payload->>'reason' = 'provider_limit'));
select t.ok('rerouted step is visible to ChatGPT through the gateway',
  exists (select 1 from jsonb_array_elements(office.gateway_list(t.h('r_gpt'), 20)) x where (x->>'step_id')::uuid = t.st(1)));

-- Unverified fallback target → stop + notify, no move.
update office.executors set verified_at = null where name = 'Router ChatGPT';
select t.mkstep(4, 'copywriter', 'claude_session');
select office.router_tick();
select t.ok('no verified executor: step stops with no_verified_executor',
  t.exec_of(4) = 'claude_session' and (select route_blocked from office.steps where id = t.st(4)) = 'no_verified_executor');
select t.ok('verified Grok is still never used', t.exec_of(4) <> 'grok' and t.exec_of(2) <> 'grok' and t.exec_of(1) <> 'grok');
update office.executors set verified_at = now() where name = 'Router ChatGPT';
select office.router_tick();
select t.ok('after verification the stopped step moves and the block is cleared',
  t.exec_of(4) = 'chatgpt' and (select route_blocked from office.steps where id = t.st(4)) is null);

-- Limit cleared: no flapping back while ChatGPT can do it.
delete from office.provider_limits;
select office.router_tick();
select t.ok('no flapping: rerouted step stays with ChatGPT', t.exec_of(1) = 'chatgpt');
select t.ok('router kill switch', (select (office.router_tick()) is not null));
update office.settings set value = 'false' where workspace_id is null and key = 'routing_enabled';
select t.ok('routing_enabled=false disables the router', (office.router_tick())->>'disabled' = 'true');
update office.settings set value = 'true' where workspace_id is null and key = 'routing_enabled';

-- ---------- Trigger Gateway ----------
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select v, 'claude-routine', 'claude_routine', t.ex('Router Claude'), true, '{"env_prefix":"CLAUDE_ROUTINE","daily_cap":20}'
from t.ids where k = 'ws_b';
insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
select v, 'owner-notify', 'manual_notify', null, true, '{"wait_minutes":0,"daily_cap":10}' from t.ids where k = 'ws_b';
create function t.ch(p_label text) returns office.trigger_channels language sql stable as $$
  select c.* from office.trigger_channels c join t.ids w on w.v = c.workspace_id and w.k = 'ws_b' where c.label = p_label $$;
grant execute on function t.ch(text) to public;
select t.throws('paid / unknown adapters cannot exist',
  $q$insert into office.trigger_channels (workspace_id, label, adapter, enabled) select v, 'fal', 'fal_api', true from t.ids where k = 'ws_b'$q$, '23514');

select t.ok('workspace without triggers_enabled gets nothing',
  not exists (select 1 from jsonb_array_elements(office.trigger_dispatch(20)) x where (x->>'step_id')::uuid in (t.st(1), t.st(2), t.st(3), t.st(4))));
select t.ok('nothing was recorded for it either', not exists (select 1 from office.trigger_runs where run_id = '0000000b-0000-4000-8000-000000000070'));
insert into office.settings (workspace_id, key, value) select v, 'triggers_enabled', 'true' from t.ids where k = 'ws_b';

select t.mkstep(5, 'copywriter', 'claude_session');   -- G
create table t.disp (n serial, j jsonb);
grant select, insert on t.disp to public;
insert into t.disp (j) select x from jsonb_array_elements(office.trigger_dispatch(20)) x;
select t.ok('dispatch wakes the Claude channel for the Claude step with only the task id',
  exists (select 1 from t.disp where (j->>'step_id')::uuid = t.st(5) and j->>'adapter' = 'claude_routine'
          and j->>'text' = 'task_id=' || t.st(5)));
select t.ok('owner is not notified for a step a channel can take',
  not exists (select 1 from t.disp where (j->>'step_id')::uuid = t.st(5) and j->>'adapter' = 'manual_notify'));
select t.ok('step reserved for the channel executor for ~10 min',
  (select reserved_for = t.ex('Router Claude') and reserved_until > now() + interval '9 minutes' from office.steps where id = t.st(5)));
select t.ok('reservation hides the step from another Claude executor',
  not exists (select 1 from jsonb_array_elements(office.gateway_list(t.h('r_claude2'), 20)) x where (x->>'step_id')::uuid = t.st(5)));
select t.ok('no second trigger while one is open',
  not exists (select 1 from jsonb_array_elements(office.trigger_dispatch(5)) x where (x->>'step_id')::uuid = t.st(5)));

create function t.tr(p_n int) returns uuid language sql stable as $$
  select t.id from office.trigger_runs t where t.step_id = t.st(p_n) order by t.created_at desc, t.attempt_no desc limit 1 $$;
create function t.last(p_n int) returns text language sql stable as $$
  select last_event from office.trigger_runs where id = t.tr(p_n) $$;
grant execute on all functions in schema t to public;

select office.trigger_report(t.tr(5), '{"result":"accepted","provider_run_id":"session_x","session_url":"https://claude.ai/code/session_x"}');
select t.ok('HTTP 200 is only trigger_accepted', t.last(5) = 'trigger_accepted'
  and exists (select 1 from office.events where kind = 'trigger.accepted' and step_id = t.st(5)));

create table t.claimed (c jsonb);
grant select, insert on t.claimed to public;
set role office_app;
insert into t.claimed select office.gateway_claim(t.h('r_claude'), t.st(5));
reset role;
select t.ok('claim by the channel executor → task_claimed', t.last(5) = 'task_claimed'
  and (select claimed_step_id from office.trigger_runs where id = t.tr(5)) = t.st(5));
set role office_app;
select office.gateway_submit(t.h('r_claude'), (c->>'attempt_id')::uuid, c->>'lease_token', '{"ok":true}') from t.claimed;
reset role;
select t.ok('submit → artifact_submitted', t.last(5) = 'artifact_submitted');
update office.steps set status = 'succeeded', finished_at = now() where id = t.st(5);
select t.ok('validated result → contract_validated + task_completed',
  t.last(5) = 'task_completed' and exists (select 1 from office.trigger_events where trigger_run_id = t.tr(5) and type = 'contract_validated'));
select t.ok('success is only task_completed and resets failures', (t.ch('claude-routine')).consecutive_failures = 0);

-- No claim within 10 minutes → trigger_expired (no_claim), counted by the breaker.
select t.mkstep(6, 'copywriter', 'claude_session');
select office.trigger_dispatch(5);
select office.trigger_report(t.tr(6), '{"result":"accepted"}');
update office.trigger_runs set created_at = now() - interval '11 minutes' where id = t.tr(6);
select office.trigger_expire();
select t.ok('accepted without claim for 10 min → trigger_expired no_claim',
  t.last(6) = 'trigger_expired' and exists (select 1 from office.trigger_events where trigger_run_id = t.tr(6) and data->>'code' = 'no_claim'));
select t.ok('expiry releases the reservation', (select reserved_for from office.steps where id = t.st(6)) is null);
select t.ok('breaker counts the expiry', (t.ch('claude-routine')).consecutive_failures = 1);

-- Retry with backoff: immediately → nothing, after 30 s → attempt 2 for the same step.
select t.ok('backoff: no immediate relaunch for the same step',
  not exists (select 1 from jsonb_array_elements(office.trigger_dispatch(5)) x where (x->>'step_id')::uuid = t.st(6)));
update office.trigger_runs set updated_at = now() - interval '31 seconds' where id = t.tr(6);
insert into t.disp (j) select x from jsonb_array_elements(office.trigger_dispatch(5)) x;
select t.ok('after backoff the step is relaunched as attempt 2',
  exists (select 1 from t.disp where (j->>'step_id')::uuid = t.st(6))
  and (select attempt_no from office.trigger_runs where id = t.tr(6)) = 2);
select office.trigger_report(t.tr(6), '{"result":"retryable","status":503,"message":"overloaded"}');
select t.ok('retryable error → trigger_failed, counted', t.last(6) = 'trigger_failed' and (t.ch('claude-routine')).consecutive_failures = 2);
update office.trigger_runs set updated_at = now() - interval '3 minutes' where step_id = t.st(6);
select t.ok('at most 2 launches per channel per step', not exists (select 1 from jsonb_array_elements(office.trigger_dispatch(5)) x
  where (x->>'step_id')::uuid = t.st(6) and x->>'adapter' = 'claude_routine'));

-- Third failure in a row → circuit breaker: channel paused 1 h, Claude steps fall back to verified ChatGPT.
select t.mkstep(7, 'copywriter', 'claude_session');
select office.trigger_dispatch(5);
select office.trigger_report(t.tr(7), '{"result":"retryable","status":500}');
select t.ok('3 failures → breaker pauses the channel for 1 h',
  (select office.channel_paused(c) and not c.paused_manual and c.paused_reason = 'circuit_breaker'
          and c.paused_until between now() + interval '59 minutes' and now() + interval '61 minutes' from t.ch('claude-routine') c));
select t.ok('breaker announced', exists (select 1 from office.events where kind = 'channel.paused' and payload->>'reason' = 'circuit_breaker'));
update office.executors set allowed_seats = '{}' where name = 'Router Claude 2';   -- only the channel executor can do Claude work
select office.router_tick();
select t.ok('paused channel → Claude steps go to verified ChatGPT (reason channel_paused)',
  t.exec_of(7) = 'chatgpt' and exists (select 1 from office.events where step_id = t.st(7) and kind = 'route.fallback'
                                        and payload->>'reason' = 'channel_paused'));

-- Second trip within 24 h → stays paused until the owner resumes.
update office.trigger_channels set paused_until = null, paused_reason = null where id = (t.ch('claude-routine')).id;
select t.mkstep(8, 'copywriter', 'claude_session'); select t.mkstep(9, 'copywriter', 'claude_session'); select t.mkstep(10, 'copywriter', 'claude_session');
select office.trigger_dispatch(20); select office.trigger_report(t.tr(8), '{"result":"retryable"}');
select office.trigger_dispatch(20); select office.trigger_report(t.tr(9), '{"result":"retryable"}');
select office.trigger_dispatch(20); select office.trigger_report(t.tr(10), '{"result":"retryable"}');
select t.ok('second breaker trip in 24 h → manual resume required', (t.ch('claude-routine')).paused_manual);

-- HTTP outcomes.
update office.trigger_channels set paused_manual = false, paused_until = null, paused_reason = null, consecutive_failures = 0
where id = (t.ch('claude-routine')).id;
update office.steps set status = 'cancelled' where id in (t.st(6), t.st(8), t.st(9), t.st(10));
select office.trigger_expire();
select t.mkstep(11, 'copywriter', 'claude_session');
select office.trigger_dispatch(20);
select office.trigger_report(t.tr(11), '{"result":"rate_limited","status":429,"retry_after_s":600}');
select t.ok('429 pauses the channel until Retry-After without counting a failure',
  (select c.paused_reason = 'rate_limited' and c.paused_until between now() + interval '9 minutes' and now() + interval '11 minutes'
          and c.consecutive_failures = 0 from t.ch('claude-routine') c));
update office.trigger_channels set paused_until = null, paused_reason = null where id = (t.ch('claude-routine')).id;
update office.trigger_runs set updated_at = now() - interval '1 minute' where id = t.tr(11);
select office.trigger_dispatch(20);
select office.trigger_report(t.tr(11), '{"result":"not_configured"}');
select t.ok('missing secret → trigger_skipped, reservation released, no failure',
  t.last(11) = 'trigger_skipped' and (select reserved_for from office.steps where id = t.st(11)) is null
  and (t.ch('claude-routine')).consecutive_failures = 0);
update office.trigger_runs set updated_at = now() - interval '3 minutes' where step_id = t.st(11);
select t.mkstep(12, 'copywriter', 'claude_session');
select office.trigger_dispatch(20);
select office.trigger_report(t.tr(12), '{"result":"auth","status":401}');
select t.ok('401 → channel paused until the owner resumes', (t.ch('claude-routine')).paused_manual
  and (t.ch('claude-routine')).paused_reason = 'auth');

-- Nobody can be woken up → owner is told once.
insert into t.disp (j) select x from jsonb_array_elements(office.trigger_dispatch(20)) x;
select t.ok('manual_notify for a waiting step when no executor channel can take it',
  exists (select 1 from t.disp where (j->>'step_id')::uuid = t.st(3) and j->>'adapter' = 'manual_notify'
          and j->>'url' like '%/w/gtu/runs/0000000b-0000-4000-8000-000000000070'));
select office.trigger_report(t.id, '{"result":"notified"}') from office.trigger_runs t
  join office.trigger_channels c on c.id = t.channel_id and c.adapter = 'manual_notify' where t.last_event = 'trigger_requested';
select t.ok('notification recorded as owner.attention', exists (select 1 from office.events where step_id = t.st(3) and kind = 'owner.attention'));
select t.ok('no repeated notification for the same parking of the step',
  not exists (select 1 from jsonb_array_elements(office.trigger_dispatch(20)) x where (x->>'step_id')::uuid = t.st(3)));

-- Quiet hours and kill switch.
select t.ok('quiet hours window detected',
  office.channel_quiet(row(gen_random_uuid(), gen_random_uuid(), 'q', 'claude_routine', gen_random_uuid(), true,
    '{"quiet_hours":{"from":"00:00","to":"23:59:59.999","tz":"Europe/Kyiv"}}', null, false, null, 0, now(), now())::office.trigger_channels)
  and not office.channel_quiet(row(gen_random_uuid(), gen_random_uuid(), 'q', 'claude_routine', gen_random_uuid(), true,
    '{}', null, false, null, 0, now(), now())::office.trigger_channels));
update office.trigger_channels set paused_manual = false, paused_reason = null where id = (t.ch('claude-routine')).id;
select t.mkstep(13, 'copywriter', 'claude_session');
update office.settings set value = 'false' where workspace_id is null and key = 'triggers_enabled';
select t.ok('global kill switch stops dispatch', office.trigger_dispatch(20) = '[]'::jsonb);
update office.settings set value = 'true' where workspace_id is null and key = 'triggers_enabled';

-- ---------- privileges, owner controls, QA ----------
set role office_app;
select t.throws('app cannot set provider limits', format($q$select office.set_provider_limit(%L, 'anthropic', null)$q$,
  (select v from t.ids where k = 'ws_b')), '42501');
reset role;
begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
set local role authenticated;
select office.set_provider_limit((select v from t.ids where k = 'ws_b'), 'anthropic', now() + interval '2 hours', 'manual');
select t.ok('owner sees routing state with limit, channels and attention',
  (select jsonb_array_length(r->'providers') = 1 and jsonb_array_length(r->'channels') = 2
          and exists (select 1 from jsonb_array_elements(r->'attention') a where (a->>'step_id')::uuid = t.st(3))
   from office.routing_state((select v from t.ids where k = 'ws_b')) r));
select office.clear_provider_limit((select v from t.ids where k = 'ws_b'), 'anthropic');
select office.set_executor_verified(t.ex('Router Claude 2'), true, 'test');
select office.resume_channel((t.ch('claude-routine')).id);
select office.set_channel_enabled((t.ch('claude-routine')).id, false);
select t.throws('limit in the past rejected', format($q$select office.set_provider_limit(%L, 'openai', now() - interval '1 hour')$q$,
  (select v from t.ids where k = 'ws_b')), '22023');
commit;
select t.ok('owner controls applied', (select verified_at is not null from office.executors where name = 'Router Claude 2')
  and not (t.ch('claude-routine')).enabled and not exists (select 1 from office.provider_limits));
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
select t.throws('owner of another workspace cannot read routing state',
  format($q$select office.routing_state(%L)$q$, (select v from t.ids where k = 'ws_b')), '42501');
commit;
select t.ok('QA reports blocked steps and failures',
  (select bool_and(x->>'level' <> 'ok') from jsonb_array_elements(office.qa_checks((select v from t.ids where k = 'ws_b'))->'checks') x
   where x->>'key' in ('route_blocked', 'trigger_failures_24h')));

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Router / trigger SQL tests failed'; end if;
end $$;
