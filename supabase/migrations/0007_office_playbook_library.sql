-- AI Office — playbook library v1 (12 playbooks from the approved ChatGPT spec, 2026-10-19).
-- Versioned playbooks, per-step executors, knowledge ids/versions for citations,
-- new seats, and an approval gate for blocked/escalated packages.

-- 1. Seats: scriptwriter and ads_specialist.
alter table office.agents drop constraint if exists agents_role_key_check;
alter table office.agents add constraint agents_role_key_check check (role_key in (
  'orchestrator','strategist','research_analyst','performance_analyst','creative_director','creative',
  'copywriter','smm','content_maker','reviewer','scriptwriter','ads_specialist',
  'designer','graphic_designer','print_designer','video_editor'));

insert into office.agents (workspace_id, role_key, display_name, model_tier, system_prompt, provenance, department, sort_order, default_executor)
select w.id, v.role_key, v.display_name, 'balanced', v.prompt, 'placeholder', 'marketing', v.sort_order, v.executor
from office.workspaces w
cross join (values
  ('scriptwriter', 'Сценарист', 'Ти — сценарист відео: драматургія, таймкоди, озвучення, знімальні рішення. Українською.', 75, 'claude_session'),
  ('ads_specialist', 'Таргетолог', 'Ти — спеціаліст із платної реклами (Meta, Google): структура кампаній, аудиторії, оголошення, A/B-перевірки. Українською.', 85, 'chatgpt')
) v(role_key, display_name, prompt, sort_order, executor)
on conflict (workspace_id, role_key) do nothing;

-- 2. Versioned playbooks: the brief chooses key + version, the run keeps it for its whole life.
alter table office.briefs add column if not exists playbook_version int not null default 1 check (playbook_version between 1 and 100);
alter table office.runs add column if not exists playbook_version int not null default 1 check (playbook_version between 1 and 100);

create or replace function office.run_playbook_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select b.playbook_version into new.playbook_version from office.briefs b where b.id = new.brief_id;
  return new;
end $$;
drop trigger if exists runs_playbook_version on office.runs;
create trigger runs_playbook_version before insert on office.runs
  for each row execute function office.run_playbook_version();

create or replace function office.create_brief(p_workspace uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not office.has_role(p_workspace, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into office.briefs (workspace_id, title, objective, audience, channel, deliverable_count,
    deliverables, "references", acceptance_criteria, deadline, priority, playbook_key, playbook_version, fields, created_by)
  values (p_workspace,
    p->>'title', p->>'objective', coalesce(p->>'audience',''), coalesce(p->>'channel',''),
    coalesce((p->>'deliverable_count')::int, 3),
    coalesce(p->'deliverables','[]'::jsonb), coalesce(p->'references','[]'::jsonb),
    coalesce(p->'acceptance_criteria','[]'::jsonb),
    nullif(p->>'deadline','')::date, coalesce(p->>'priority','medium'),
    coalesce(p->>'playbook_key','reels_concepts'),
    coalesce((p->>'playbook_version')::int, 1),
    case when jsonb_typeof(p->'fields') = 'object' then p->'fields' else '{}'::jsonb end,
    (select auth.uid()))
  returning id into v_id;
  perform office.log_event(p_workspace, null, null, 'user', (select auth.uid()), null,
    'brief.created', null, jsonb_build_object('brief_id', v_id, 'title', p->>'title',
      'playbook', coalesce(p->>'playbook_key','reels_concepts'), 'version', coalesce((p->>'playbook_version')::int, 1)));
  return v_id;
end $$;
revoke all on function office.create_brief(uuid, jsonb) from public, anon, service_role, office_app;
grant execute on function office.create_brief(uuid, jsonb) to authenticated;

-- 3. Per-step executor chosen by the playbook (author vs independent reviewer).
create or replace function office.worker_complete(p_step uuid, p_worker text, p_attempt int, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s office.steps; r office.runs; art jsonb; ns jsonb; v_version int; v_art uuid; v_arts jsonb := '[]'::jsonb;
        v_cost numeric := coalesce((p_result->'usage'->>'cost_usd')::numeric, 0);
        v_tin bigint := coalesce((p_result->'usage'->>'tokens_in')::bigint, 0);
        v_tout bigint := coalesce((p_result->'usage'->>'tokens_out')::bigint, 0);
        v_status text := p_result->>'run_status';
begin
  select * into s from office.steps where id = p_step for update;
  if not found or s.status <> 'running' or s.locked_by is distinct from p_worker or s.attempt <> p_attempt then
    return jsonb_build_object('accepted', false, 'reason', 'stale_or_foreign_lease');
  end if;
  select * into r from office.runs where id = s.run_id for update;
  if r.status not in ('running') then
    update office.steps set status = 'cancelled', locked_by = null, locked_until = null, finished_at = now() where id = s.id;
    return jsonb_build_object('accepted', false, 'reason', 'run_' || r.status);
  end if;

  update office.steps set status = 'succeeded', output = p_result->'output', provider = p_result->>'provider',
    model = p_result->>'model', cost_usd = v_cost, tokens_in = v_tin, tokens_out = v_tout,
    locked_by = null, locked_until = null, finished_at = now(), error = null
  where id = s.id;
  update office.runs set cost_usd = cost_usd + v_cost, tokens_in = tokens_in + v_tin, tokens_out = tokens_out + v_tout,
    provider = coalesce(provider, nullif(p_result->>'provider', 'code'))
  where id = r.id;

  for art in select value from jsonb_array_elements(coalesce(p_result->'artifacts', '[]'::jsonb)) loop
    select coalesce(max(version), 0) + 1 into v_version from office.artifacts where run_id = r.id and kind = art->>'kind';
    insert into office.artifacts (workspace_id, run_id, step_id, kind, title, version, content, content_hash, provider, model)
    values (r.workspace_id, r.id, s.id, art->>'kind', coalesce(art->>'title', art->>'kind'), v_version,
            art->'content', office.json_hash(art->'content'), coalesce(p_result->>'provider', 'unknown'), p_result->>'model')
    returning id into v_art;
    v_arts := v_arts || jsonb_build_array(jsonb_build_object('id', v_art, 'kind', art->>'kind', 'version', v_version));
    perform office.log_event(r.workspace_id, r.id, s.id, 'agent', null, s.agent_role, 'artifact.created', 'delivering',
      jsonb_build_object('artifact_id', v_art, 'kind', art->>'kind', 'version', v_version));
  end loop;

  for ns in select value from jsonb_array_elements(coalesce(p_result->'next_steps', '[]'::jsonb)) loop
    insert into office.steps (run_id, workspace_id, step_key, agent_role, cycle, depends_on, input, executor)
    values (r.id, r.workspace_id, ns->>'step_key', ns->>'agent_role',
      (select coalesce(max(cycle), 0) + 1 from office.steps where run_id = r.id and step_key = ns->>'step_key'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(ns->'depends_on','[]'::jsonb)) x), '{}'),
      coalesce(ns->'input', '{}'::jsonb),
      case when ns->>'executor' in ('claude_session','chatgpt','human') then ns->>'executor' end);
  end loop;

  perform office.log_event(r.workspace_id, r.id, s.id, 'agent', null, s.agent_role, 'step.succeeded',
    coalesce(p_result->>'activity', 'idle'),
    jsonb_build_object('step', s.step_key, 'cycle', s.cycle, 'message', p_result->>'message',
                       'cost_usd', v_cost, 'model', p_result->>'model', 'provider', p_result->>'provider'));

  if v_status in ('needs_approval','needs_input') then
    update office.runs set status = v_status where id = r.id;
    perform office.log_event(r.workspace_id, r.id, null, 'system', null, 'orchestrator',
      'run.' || v_status, 'waiting_approval', '{}');
  elsif v_status is not null then
    raise exception 'unsupported run_status %', v_status;
  end if;

  return jsonb_build_object('accepted', true, 'artifacts', v_arts);
end $$;

-- 4. Knowledge ids + content versions in the worker context, so outputs can cite record_id/version.
create or replace function office.knowledge_version(k office.knowledge_docs) returns text
language sql immutable set search_path = '' as $$
  select left(encode(sha256(convert_to(k.title || E'\n' || k.body, 'UTF8')), 'hex'), 12)
$$;

create or replace function office.worker_context(p_step uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'step', to_jsonb(s),
    'run', to_jsonb(r),
    'brief', to_jsonb(b),
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'agent', (select to_jsonb(a) from office.agents a where a.workspace_id = s.workspace_id and a.role_key = s.agent_role),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'version', office.knowledge_version(k),
                                                               'title', k.title, 'kind', k.kind, 'body', k.body,
                                                               'source_url', k.source_url, 'freshness_date', k.freshness_date)
                                            order by k.kind, k.title)
                           from office.knowledge_docs k where k.workspace_id = s.workspace_id and k.status = 'approved'), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'version', x.version, 'content', x.content,
                                                               'id', x.id, 'hash', x.content_hash)
                                            order by x.kind, x.version)
                           from office.artifacts x where x.run_id = s.run_id), '[]'::jsonb)
  )
  from office.steps s join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
  join office.workspaces w on w.id = s.workspace_id
  where s.id = p_step
$$;

-- 5. A blocked or escalated package can be revised or rejected, never approved for production.
create or replace function office.approval_outcome_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_outcome text;
begin
  if new.decision = 'approved' then
    select a.content->>'outcome' into v_outcome from office.artifacts a where a.id = new.artifact_id;
    if v_outcome in ('blocked', 'escalated') then
      raise exception 'package is % — resolve the questions or request a revision', v_outcome using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists approvals_outcome_gate on office.approvals;
create trigger approvals_outcome_gate before insert on office.approvals
  for each row execute function office.approval_outcome_gate();

revoke all on function office.run_playbook_version(), office.knowledge_version(office.knowledge_docs),
  office.approval_outcome_gate() from public, anon, authenticated, service_role, office_app;
revoke all on function office.worker_complete(uuid, text, int, jsonb), office.worker_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function office.worker_complete(uuid, text, int, jsonb), office.worker_context(uuid) to office_app;
