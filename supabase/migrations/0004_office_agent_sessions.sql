-- AI Office — "session" provider: AI steps are handed to a Claude session (run by the owner
-- or on a schedule) instead of calling a model API from the cloud worker.
-- Flow: worker claims an AI step -> parks it as awaiting_agent with the full request
--       -> Claude session reads office.agent_pending(), writes office.agent_submit()
--       -> worker re-claims the step, validates the response with the same schema, continues.

alter table office.steps drop constraint if exists steps_status_check;
alter table office.steps add constraint steps_status_check
  check (status in ('ready','running','awaiting_agent','succeeded','failed','cancelled'));
alter table office.steps add column if not exists agent_request jsonb;
alter table office.steps add column if not exists agent_response jsonb;
create index if not exists steps_awaiting_idx on office.steps (created_at) where status = 'awaiting_agent';

-- Worker: hand the step to an external Claude session. Does not consume an attempt.
create or replace function office.worker_park(p_step uuid, p_worker text, p_attempt int, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s office.steps;
begin
  select * into s from office.steps where id = p_step for update;
  if not found or s.status <> 'running' or s.locked_by is distinct from p_worker or s.attempt <> p_attempt then
    return jsonb_build_object('accepted', false, 'reason', 'stale_or_foreign_lease');
  end if;
  update office.steps set status = 'awaiting_agent', attempt = greatest(attempt - 1, 0),
    locked_by = null, locked_until = null, agent_request = p_request, agent_response = null
  where id = s.id;
  -- A hand-off is not real work; do not count it against the run's step limit.
  update office.runs set steps_executed = greatest(steps_executed - 1, 0) where id = s.run_id;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'step.awaiting_agent', 'idle',
    jsonb_build_object('step', s.step_key, 'schema', p_request->>'schemaName', 'note', p_request->>'note'));
  return jsonb_build_object('accepted', true);
end $$;

-- Claude session: what is waiting.
create or replace function office.agent_pending(p_limit int default 5)
returns table (step_id uuid, run_id uuid, workspace text, brief_title text, step_key text, agent_role text,
               request jsonb, waiting_since timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.run_id, w.slug, b.title, s.step_key, s.agent_role, s.agent_request, s.created_at
  from office.steps s
  join office.runs r on r.id = s.run_id and r.status = 'running'
  join office.briefs b on b.id = r.brief_id
  join office.workspaces w on w.id = s.workspace_id and w.status = 'active'
  where s.status = 'awaiting_agent'
  order by s.created_at
  limit least(greatest(p_limit, 1), 20)
$$;

-- Claude session: deliver the answer; the cloud worker validates it and continues the playbook.
create or replace function office.agent_submit(p_step uuid, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s office.steps;
begin
  if jsonb_typeof(p_response) <> 'object' then
    raise exception 'response must be a JSON object' using errcode = '22023';
  end if;
  select * into s from office.steps where id = p_step for update;
  if not found or s.status <> 'awaiting_agent' then
    return jsonb_build_object('accepted', false, 'reason', 'not_awaiting');
  end if;
  update office.steps set status = 'ready', agent_response = jsonb_build_object(
      'schemaName', s.agent_request->>'schemaName', 'output', p_response, 'submitted_at', now()),
    next_attempt_at = now()
  where id = s.id;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.agent_submitted',
    office.activity_for_role(s.agent_role), jsonb_build_object('step', s.step_key));
  return jsonb_build_object('accepted', true);
end $$;

-- Cancelling a run also releases parked steps.
create or replace function office.cancel_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r office.runs;
begin
  select * into r from office.runs where id = p_run for update;
  if not found or not office.has_role(r.workspace_id, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update office.runs set status = 'cancelled', error_code = 'cancelled_by_user' where id = p_run;
  update office.steps set status = 'cancelled', locked_by = null, locked_until = null
    where run_id = p_run and status in ('ready','running','awaiting_agent');
  perform office.log_event(r.workspace_id, p_run, null, 'user', (select auth.uid()), null, 'run.cancelled', null, '{}');
end $$;

revoke all on function office.worker_park(uuid, text, int, jsonb), office.agent_pending(int),
  office.agent_submit(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function office.worker_park(uuid, text, int, jsonb), office.agent_pending(int),
  office.agent_submit(uuid, jsonb) to office_app;
