-- AI Office 1.1.2: ChatGPT workspace agents may alter long opaque strings (lease_token / attempt_id) between
-- claim and submit, so a correct answer was refused as not_found (25.10, C4 sandbox).
-- New gateway_submit_step: exact attempt + lease first; otherwise the caller's OWN single active, unexpired lease
-- on that task (identity is already proven by the OAuth token). Every fallback is journaled (gateway.lease_fallback).
-- Stale-work protection stays: lease expiry, task still waiting, input hashes, data policy.
-- Also: an adapter failure that arrives after the executor already claimed the task no longer fails the trigger run.
-- Additive: gateway_submit keeps its signature and behaviour (body moved into gateway_submit_core).

create or replace function office.gateway_submit_core(e office.executors, a office.execution_attempts, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps; v_reason text;
begin
  if a.state='rejected' and a.rejection_reason='knowledge_expired' then
    update office.execution_attempts set result=p_result,submitted_at=now() where id=a.id;
    return jsonb_build_object('accepted',false,'reason','knowledge_expired','saved_as_proposal',true);
  end if;
  if a.state not in ('claimed','expired') then
    return jsonb_build_object('accepted', false, 'reason', 'attempt_' || a.state);
  end if;
  select * into s from office.steps where id = a.step_id for update;

  if a.lease_expires_at < now() then v_reason := 'lease_expired';
  elsif not office.gateway_policy_ok(e,s) then v_reason := office.gateway_policy_reason(e,s);
  elsif s.status <> 'awaiting_agent' then v_reason := 'task_no_longer_waiting';
  elsif office.run_input_hashes(s.run_id) <> a.input_hashes then v_reason := 'inputs_changed';
  end if;

  if v_reason is not null then
    update office.execution_attempts set state = 'rejected', rejection_reason = v_reason, result = p_result, submitted_at = now()
    where id = a.id;
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.saved_as_proposal', 'idle',
      jsonb_build_object('attempt_id', a.id, 'reason', v_reason, 'executor', e.kind, 'executor_id', e.id, 'executor_label', e.label));
    return jsonb_build_object('accepted', false, 'reason', v_reason, 'saved_as_proposal', true);
  end if;

  update office.execution_attempts set state = 'submitted', result = p_result, submitted_at = now() where id = a.id;
  update office.steps set status = 'ready', next_attempt_at = now(), agent_response = jsonb_build_object(
      'schemaName', s.agent_request->>'schemaName', 'output', p_result, 'submitted_at', now(),
      'attempt_id', a.id, 'executor', e.kind, 'executor_id', e.id, 'executor_label', e.label)
  where id = s.id;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.agent_submitted',
    office.activity_for_role(s.agent_role), jsonb_build_object('step', s.step_key, 'attempt_id', a.id, 'executor', e.kind,
      'executor_name', e.name, 'executor_id', e.id, 'executor_label', e.label));
  return jsonb_build_object('accepted', true, 'next', 'AI Office перевірить відповідь за схемою протягом ~1 хв');
end $$;

create or replace function office.gateway_submit(p_token_hash text, p_attempt uuid, p_lease_token text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; a office.execution_attempts;
begin
  e := office.gateway_executor(p_token_hash, 'submit');
  if jsonb_typeof(p_result) <> 'object' then raise exception 'result must be a JSON object' using errcode = '22023'; end if;
  select * into a from office.execution_attempts where id = p_attempt for update;
  if not found or a.executor_id <> e.id or a.lease_token_hash <> encode(sha256(convert_to(p_lease_token, 'UTF8')), 'hex') then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  return office.gateway_submit_core(e, a, p_result);
end $$;

create or replace function office.gateway_submit_step(p_token_hash text, p_step uuid, p_attempt uuid, p_lease_token text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e office.executors; a office.execution_attempts; n int;
begin
  e := office.gateway_executor(p_token_hash, 'submit');
  if jsonb_typeof(p_result) <> 'object' then raise exception 'result must be a JSON object' using errcode = '22023'; end if;
  -- 1) Exact match, as before.
  select * into a from office.execution_attempts
  where id = p_attempt and step_id = p_step and executor_id = e.id
    and lease_token_hash = encode(sha256(convert_to(coalesce(p_lease_token, ''), 'UTF8')), 'hex')
  for update;
  if found then return office.gateway_submit_core(e, a, p_result); end if;
  -- 2) Fallback: this executor's own active, unexpired lease on this task (at most one can exist).
  select count(*) into n from office.execution_attempts
  where step_id = p_step and executor_id = e.id and state = 'claimed' and lease_expires_at > now();
  if n <> 1 then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  select * into a from office.execution_attempts
  where step_id = p_step and executor_id = e.id and state = 'claimed' and lease_expires_at > now()
  for update;
  perform office.log_event(a.workspace_id, a.run_id, a.step_id, 'agent', null, null, 'gateway.lease_fallback', 'idle',
    jsonb_build_object('attempt_id', a.id, 'executor_label', e.label,
                       'attempt_id_matched', a.id = p_attempt, 'lease_token_given', p_lease_token is not null and p_lease_token <> ''));
  return office.gateway_submit_core(e, a, p_result);
end $$;

-- A failure reported after the executor already claimed the task (e.g. 409 from a retried HTTP call while the
-- agent was in fact running) is history, not an outcome.
create or replace function office.trigger_report(p_run uuid, p_outcome jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t office.trigger_runs; v_res text := p_outcome->>'result'; v_retry int;
begin
  select * into t from office.trigger_runs where id = p_run;
  if not found or office.trigger_terminal(t.last_event) then return; end if;
  if v_res = 'accepted' then
    update office.trigger_runs set provider_run_id = left(p_outcome->>'provider_run_id', 200),
      session_url = case when p_outcome->>'session_url' ~ '^https://' then left(p_outcome->>'session_url', 500) end
    where id = t.id;
    if t.last_event = 'trigger_requested' then
      perform office.trigger_mark(t.id, 'trigger_accepted', jsonb_build_object('session_url', p_outcome->>'session_url'));
    else
      insert into office.trigger_events (trigger_run_id, type, data) values (t.id, 'trigger_accepted', '{}'::jsonb);
    end if;
    return;
  end if;
  if t.last_event not in ('trigger_requested') and v_res not in ('notified') then
    insert into office.trigger_events (trigger_run_id, type, data)
    values (t.id, 'trigger_failed', jsonb_build_object('code', coalesce(v_res, 'unknown'), 'status', p_outcome->'status',
      'message', left(p_outcome->>'message', 300), 'late', true));
    return;
  end if;
  if v_res = 'notified' then
    perform office.trigger_mark(t.id, 'owner_notified', '{}'::jsonb);
    perform office.log_event(t.workspace_id, t.run_id, t.step_id, 'system', null, null, 'owner.attention', 'blocked',
      jsonb_build_object('trigger_run_id', t.id, 'delivered', coalesce(p_outcome->>'delivered', 'in_app')));
  elsif v_res = 'not_configured' then
    perform office.trigger_mark(t.id, 'trigger_skipped', jsonb_build_object('code', 'not_configured'));
  elsif v_res = 'rate_limited' then
    v_retry := least(greatest(coalesce((p_outcome->>'retry_after_s')::int, 3600), 60), 86400);
    update office.trigger_channels set paused_until = now() + make_interval(secs => v_retry), paused_reason = 'rate_limited',
      updated_at = now() where id = t.channel_id;
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', 'rate_limited', 'status', p_outcome->'status',
      'count_failure', false));
    perform office.log_event(t.workspace_id, null, null, 'system', null, null, 'channel.paused', 'blocked',
      jsonb_build_object('channel_id', t.channel_id, 'reason', 'rate_limited', 'until', now() + make_interval(secs => v_retry)));
  elsif v_res in ('auth', 'fatal') then
    update office.trigger_channels set paused_manual = true, paused_reason = v_res, updated_at = now() where id = t.channel_id;
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', v_res, 'status', p_outcome->'status',
      'message', left(p_outcome->>'message', 300), 'count_failure', false));
    perform office.log_event(t.workspace_id, null, null, 'system', null, null, 'channel.paused', 'blocked',
      jsonb_build_object('channel_id', t.channel_id, 'reason', v_res, 'manual_resume', true));
  else
    perform office.trigger_mark(t.id, 'trigger_failed', jsonb_build_object('code', coalesce(v_res, 'unknown'),
      'status', p_outcome->'status', 'message', left(p_outcome->>'message', 300)));
  end if;
end $$;

revoke all on function office.gateway_submit_core(office.executors, office.execution_attempts, jsonb),
  office.gateway_submit_step(text, uuid, uuid, text, jsonb), office.gateway_submit(text, uuid, text, jsonb),
  office.trigger_report(uuid, jsonb)
  from public, anon, authenticated, service_role, office_app;
grant execute on function office.gateway_submit_step(text, uuid, uuid, text, jsonb), office.gateway_submit(text, uuid, text, jsonb),
  office.trigger_report(uuid, jsonb) to office_app;
