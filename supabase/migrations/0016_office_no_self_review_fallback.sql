-- AI Office 1.2.1: a reviewer step is never moved by the router to an executor that already produced validated work
-- in the same run (25.10: two graphic packs built by Claude had their ChatGPT review moved to Claude when the ChatGPT
-- channel paused). Library v1 playbooks have no independent_of_step, so the router enforces this itself for fallback.
create or replace function office.route_candidate(s office.steps, p_kind text, p_require_verified boolean) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from office.executors e
  where e.workspace_id = s.workspace_id and e.kind = p_kind and e.revoked_at is null
    and (not p_require_verified or e.verified_at is not null)
    and (e.allowed_seats is null or s.agent_role = any(e.allowed_seats))
    and office.gateway_independent(e, s)
    and office.gateway_policy_ok(e, s)
    and office.provider_available(s.workspace_id, e.provider)
    and not office.executor_tripped(e.id)
    and not (p_require_verified and s.agent_role = 'reviewer' and exists (
      select 1 from office.execution_attempts x where x.run_id = s.run_id and x.executor_id = e.id and x.state = 'validated'))
  order by e.verified_at nulls last, e.created_at
  limit 1
$$;
revoke all on function office.route_candidate(office.steps, text, boolean) from public, anon, authenticated, service_role, office_app;
