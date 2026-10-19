-- AI Office — playbook-specific brief fields + per-executor rate limit on the gateway.

-- 1. Brief fields defined by declarative playbooks (PlaybookSpec.briefFields).
alter table office.briefs add column if not exists fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 20000);

create or replace function office.create_brief(p_workspace uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not office.has_role(p_workspace, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into office.briefs (workspace_id, title, objective, audience, channel, deliverable_count,
    deliverables, "references", acceptance_criteria, deadline, priority, playbook_key, fields, created_by)
  values (p_workspace,
    p->>'title', p->>'objective', coalesce(p->>'audience',''), coalesce(p->>'channel',''),
    coalesce((p->>'deliverable_count')::int, 3),
    coalesce(p->'deliverables','[]'::jsonb), coalesce(p->'references','[]'::jsonb),
    coalesce(p->'acceptance_criteria','[]'::jsonb),
    nullif(p->>'deadline','')::date, coalesce(p->>'priority','medium'),
    coalesce(p->>'playbook_key','reels_concepts'),
    case when jsonb_typeof(p->'fields') = 'object' then p->'fields' else '{}'::jsonb end,
    (select auth.uid()))
  returning id into v_id;
  perform office.log_event(p_workspace, null, null, 'user', (select auth.uid()), null,
    'brief.created', null, jsonb_build_object('brief_id', v_id, 'title', p->>'title', 'playbook', coalesce(p->>'playbook_key','reels_concepts')));
  return v_id;
end $$;
revoke all on function office.create_brief(uuid, jsonb) from public, anon, service_role, office_app;
grant execute on function office.create_brief(uuid, jsonb) to authenticated;

-- 2. Rate limit: at most 120 gateway calls per executor per minute (fixed window).
create table office.executor_rate (
  executor_id uuid primary key references office.executors(id) on delete cascade,
  window_start timestamptz not null,
  calls int not null default 0
);
alter table office.executor_rate enable row level security;
revoke all on office.executor_rate from public, anon, authenticated, service_role, office_app;

create function office.gateway_rate_check(p_executor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_calls int;
begin
  insert into office.executor_rate as r (executor_id, window_start, calls)
  values (p_executor, date_trunc('minute', now()), 1)
  on conflict (executor_id) do update set
    calls = case when r.window_start = date_trunc('minute', now()) then r.calls + 1 else 1 end,
    window_start = date_trunc('minute', now())
  returning calls into v_calls;
  if v_calls > 120 then
    raise exception 'rate limit: too many calls, retry in a minute' using errcode = '54000';
  end if;
end $$;

create or replace function office.gateway_executor(p_token_hash text, p_op text) returns office.executors
language plpgsql security definer set search_path = '' as $$
declare e office.executors;
begin
  select * into e from office.executors x
  where x.revoked_at is null and (x.token_hash = p_token_hash or x.id = (
      select t.executor_id from office.oauth_tokens t
      where t.token_hash = p_token_hash and t.kind = 'access' and t.revoked_at is null and t.expires_at > now()));
  if not found then raise exception 'invalid executor token' using errcode = '28000'; end if;
  if not (p_op = any(e.allowed_ops)) then raise exception 'operation % not allowed for this executor', p_op using errcode = '42501'; end if;
  perform office.gateway_rate_check(e.id);
  update office.executors set last_seen_at = now() where id = e.id;
  return e;
end $$;

revoke all on function office.gateway_rate_check(uuid), office.gateway_executor(text, text)
  from public, anon, authenticated, service_role, office_app;
