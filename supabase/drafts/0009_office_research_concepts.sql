-- DRAFT ONLY. Intentionally outside migrations/: do not apply to Supabase.
-- Local acceptance tests explicitly load this file after migrations 0001..0008.
-- No removals/renames. Existing function signatures and P0 governance are preserved;
-- worker_context/gateway policy/submit additionally enforce knowledge expiry.

alter table office.knowledge_docs add column valid_until date;
grant update (valid_until) on office.knowledge_docs to authenticated;

-- Separate staging area avoids changing knowledge_docs' existing status constraint.
-- Unapproved research cannot enter worker_context's approved knowledge query.
create table office.knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id),
  research_artifact_id uuid not null references office.artifacts(id),
  source_index int not null default 0 check (source_index >= 0),
  kind text not null check (kind in ('fact','market','insight','case','argument','result','rejected_idea','taste_rule')),
  title text not null check (length(title) between 5 and 200),
  claim text not null check (length(claim) between 10 and 2000),
  confidence text not null check (confidence in ('verified','reported','assumption')),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 6),
  why_it_matters text not null check (length(why_it_matters) between 10 and 500),
  owner_question text check (length(owner_question) between 10 and 300),
  valid_until date,
  data_class text not null default 'internal' check (data_class in ('public','internal','confidential')),
  status text not null default 'candidate' check (status in ('candidate','approved','rejected')),
  approved_doc_id uuid unique references office.knowledge_docs(id),
  created_by uuid default auth.uid() references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text not null default '' check (length(review_note) <= 2000),
  unique (research_artifact_id, source_index),
  check (confidence <> 'assumption' or owner_question is not null),
  check (confidence = 'assumption' or jsonb_array_length(sources) > 0),
  check ((status = 'candidate' and reviewed_by is null and reviewed_at is null and approved_doc_id is null)
      or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and approved_doc_id is null)
      or (status = 'approved' and reviewed_by is not null and reviewed_at is not null and approved_doc_id is not null))
);
create index knowledge_candidates_workspace_status on office.knowledge_candidates(workspace_id, status);
create index knowledge_candidates_research_artifact on office.knowledge_candidates(research_artifact_id);
alter table office.knowledge_candidates enable row level security;
create policy candidates_read on office.knowledge_candidates for select to authenticated using (office.is_member(workspace_id));
create policy candidates_insert on office.knowledge_candidates for insert to authenticated
  with check (office.has_role(workspace_id, array['owner','editor']));
create policy candidates_update on office.knowledge_candidates for update to authenticated
  using (office.has_role(workspace_id, array['owner','editor']))
  with check (office.has_role(workspace_id, array['owner','editor']));
grant select, insert on office.knowledge_candidates to authenticated;
grant update (title, claim, confidence, sources, why_it_matters, owner_question, valid_until, data_class)
  on office.knowledge_candidates to authenticated;

-- Invoker rights: promotion uses the owner's existing Knowledge Hub INSERT permission.
create function office.guard_knowledge_candidate() returns trigger
language plpgsql set search_path = '' as $$
declare source_run uuid; source jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'candidate' or new.approved_doc_id is not null or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'research must start as candidate' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    if new.created_by is null and pg_trigger_depth() < 2 then
      raise exception 'system candidates must originate in an artifact trigger' using errcode = '42501';
    end if;
    new.created_at := now();
  else
    if old.status <> 'candidate' then raise exception 'reviewed candidate is immutable' using errcode = '42501'; end if;
    if new.id is distinct from old.id or new.source_index is distinct from old.source_index
       or new.workspace_id is distinct from old.workspace_id or new.research_artifact_id is distinct from old.research_artifact_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.approved_doc_id is distinct from old.approved_doc_id or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'candidate provenance is immutable' using errcode = '42501';
    end if;
  end if;
  select a.run_id into source_run from office.artifacts a join office.steps s on s.id = a.step_id
    where a.id = new.research_artifact_id and a.workspace_id = new.workspace_id
      and s.workspace_id = new.workspace_id and s.run_id = a.run_id and s.agent_role = 'research_analyst';
  if source_run is null then raise exception 'research artifact must belong to this workspace' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(new.sources) s where jsonb_typeof(s) <> 'object'
      or coalesce(s->>'url', '') !~ '^https?://[^[:space:]]+$'
      or length(coalesce(s->>'title', '')) < 3
      or coalesce(s->>'accessed_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    raise exception 'invalid research sources' using errcode = '23514';
  end if;
  for source in select value from jsonb_array_elements(new.sources) loop
    perform (source->>'accessed_at')::date;
    if source->>'published_at' is not null then perform (source->>'published_at')::date; end if;
  end loop;
  if new.status <> 'candidate' then
    if not office.has_role(new.workspace_id, array['owner']) then
      raise exception 'only owner may review research candidates' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.status = 'approved' then
      if new.confidence = 'assumption' or jsonb_array_length(new.sources) = 0 or new.valid_until < current_date then
        raise exception 'approval requires sourced, unexpired research' using errcode = '23514';
      end if;
      insert into office.knowledge_docs(workspace_id, kind, title, body, status, source_url, freshness_date, created_by, data_class, valid_until)
        values (new.workspace_id, case when new.kind = 'fact' then 'fact' else 'other' end,
          new.title, new.claim, 'approved', new.sources->0->>'url', current_date, auth.uid(), new.data_class, new.valid_until)
        returning id into new.approved_doc_id;
    end if;
  end if;
  return new;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'invalid source date' using errcode='23514';
end $$;
create trigger knowledge_candidate_guard before insert or update on office.knowledge_candidates
  for each row execute function office.guard_knowledge_candidate();
revoke all on function office.guard_knowledge_candidate() from public, anon, authenticated, office_app;

create table office.concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id),
  run_id uuid not null references office.runs(id),
  artifact_id uuid not null references office.artifacts(id),
  concept_key text not null check (concept_key ~ '^[a-zA-Z0-9_-]{1,80}$'),
  title text not null check (length(title) between 1 and 200),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  concept_status text not null default 'draft' check (concept_status in ('draft','proposed','selected','rejected','archived')),
  created_at timestamptz not null default now(),
  unique (run_id, artifact_id, concept_key)
);
create index concepts_workspace_run on office.concepts(workspace_id, run_id);
create index concepts_artifact on office.concepts(artifact_id);
alter table office.concepts enable row level security;
create policy concepts_read on office.concepts for select to authenticated using (office.is_member(workspace_id));
create policy concepts_insert on office.concepts for insert to authenticated
  with check (office.has_role(workspace_id, array['owner','editor']));
create policy concepts_update on office.concepts for update to authenticated
  using (office.has_role(workspace_id, array['owner','editor']))
  with check (office.has_role(workspace_id, array['owner','editor']));
grant select, insert on office.concepts to authenticated;
grant update (title, content, concept_status) on office.concepts to authenticated;

create function office.guard_concept() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from office.artifacts a join office.runs r on r.id = a.run_id
      where a.id = new.artifact_id and a.run_id = new.run_id and a.workspace_id = new.workspace_id and r.workspace_id = new.workspace_id) then
    raise exception 'concept artifact/run workspace mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.workspace_id, new.run_id, new.artifact_id, new.concept_key, new.created_at)
       is distinct from (old.id, old.workspace_id, old.run_id, old.artifact_id, old.concept_key, old.created_at) then
      raise exception 'concept provenance is immutable' using errcode = '42501';
    end if;
  end if;
  if new.concept_status in ('selected','rejected','archived') or (tg_op = 'UPDATE' and old.concept_status in ('selected','rejected','archived')) then
    if not office.has_role(new.workspace_id, array['owner']) then
      raise exception 'concept decision requires owner' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger concept_guard before insert or update on office.concepts for each row execute function office.guard_concept();
revoke all on function office.guard_concept() from public, anon, authenticated, office_app;

alter table office.approvals add column scope text;
alter table office.approvals add column target_id uuid;
alter table office.approvals add constraint approvals_scope_target_pair check (
  (scope is null and target_id is null) or (scope is not null and target_id is not null and scope in ('run','concept','knowledge_candidate'))
);
create index approvals_scope_target on office.approvals(workspace_id, scope, target_id) where scope is not null;

create function office.guard_approval_target() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.scope is null and new.target_id is null then return new; end if;
  if not office.has_role(new.workspace_id, array['owner']) then
    raise exception 'scoped approval requires owner' using errcode = '42501';
  end if;
  if not exists (select 1 from office.artifacts a where a.id = new.artifact_id and a.workspace_id = new.workspace_id and a.run_id = new.run_id) then
    raise exception 'approval artifact workspace mismatch' using errcode = '23514';
  end if;
  if (new.scope = 'run' and new.target_id = new.run_id)
     or (new.scope = 'concept' and exists (select 1 from office.concepts c where c.id = new.target_id and c.workspace_id = new.workspace_id and c.run_id = new.run_id and c.artifact_id = new.artifact_id))
     or (new.scope = 'knowledge_candidate' and exists (select 1 from office.knowledge_candidates c join office.artifacts a on a.id = c.research_artifact_id
         where c.id = new.target_id and c.workspace_id = new.workspace_id and a.run_id = new.run_id and a.id = new.artifact_id)) then
    if new.approver_id <> auth.uid() then raise exception 'approval actor mismatch' using errcode = '42501'; end if;
    return new;
  end if;
  raise exception 'approval target workspace/run mismatch' using errcode = '23514';
end $$;
create trigger approval_target_guard before insert on office.approvals for each row execute function office.guard_approval_target();
revoke all on function office.guard_approval_target() from public, anon, authenticated, office_app;

-- Trigger runs inside worker_complete's transaction and rights. No external writer is added.
create function office.stage_research_artifact() returns trigger
language plpgsql set search_path = '' as $$
declare candidate jsonb; entry jsonb; ordinal int := 0; claim_text text; retrieved date; class_floor text;
begin
  if not exists (select 1 from office.steps s join office.workspaces w on w.id=s.workspace_id
      where s.id=new.step_id and s.agent_role='research_analyst' and s.workspace_id=new.workspace_id and s.run_id=new.run_id
        and w.slug='pavutyna') then return new; end if;
  select coalesce(s.agent_request->'governance'->>'data_class','internal') into class_floor from office.steps s where s.id=new.step_id;
  if new.content->>'schema_version' = 'KnowledgeCandidate.v1' then
    if jsonb_typeof(new.content->'candidates') is distinct from 'array' then raise exception 'invalid candidates' using errcode='23514'; end if;
    if jsonb_array_length(new.content->'candidates')>12 then raise exception 'too many candidates' using errcode='23514'; end if;
    for candidate in select value from jsonb_array_elements(new.content->'candidates') loop
      ordinal := ordinal+1;
      insert into office.knowledge_candidates(workspace_id,research_artifact_id,source_index,kind,title,claim,confidence,sources,why_it_matters,owner_question,valid_until,data_class)
        values(new.workspace_id,new.id,ordinal,candidate->>'kind',candidate->>'title',candidate->>'claim',candidate->>'confidence',
          candidate->'sources',candidate->>'why_it_matters',candidate->>'owner_question',nullif(candidate->>'valid_until','')::date,
          case when office.data_class_rank(class_floor)>office.data_class_rank(candidate->>'data_class') then class_floor else candidate->>'data_class' end);
    end loop;
  elsif jsonb_typeof(new.content->'research_candidates')='array' then
    -- Legacy ResearchCandidate format. Keep unverified/invalid-source suggestions as
    -- assumptions instead of inventing provenance or granting verified status.
    for entry in select value from jsonb_array_elements(new.content->'research_candidates') loop
      ordinal := ordinal+1;
      claim_text := entry->>'proposed_fact';
      retrieved := null;
      begin
        retrieved := left(entry->>'retrieved_at',10)::date;
      exception when invalid_datetime_format or datetime_field_overflow then retrieved := null;
      end;
      if entry->>'url' ~ '^https?://[^[:space:]]+$' and retrieved is not null and length(claim_text)>=10 then
        candidate := jsonb_build_object('confidence','reported','sources',jsonb_build_array(jsonb_build_object(
          'url',entry->>'url','title',left('Джерело: ' || new.title,200),'accessed_at',retrieved,'quote',entry->>'excerpt')));
      else
        candidate := '{"confidence":"assumption","sources":[]}'::jsonb;
      end if;
      -- Schema-valid legacy claims may be short; preserve the original verbatim in
      -- the artifact and give the staging claim an explicit label.
      if length(coalesce(claim_text,''))<10 then claim_text := 'Потребує перевірки: ' || coalesce(claim_text,''); end if;
      insert into office.knowledge_candidates(workspace_id,research_artifact_id,source_index,kind,title,claim,confidence,sources,why_it_matters,owner_question,data_class)
        values(new.workspace_id,new.id,ordinal,'fact',left('Дослідження: ' || claim_text,200),left(claim_text,2000),candidate->>'confidence',candidate->'sources',
          'Пропозиція дослідника: перевірте твердження та першоджерело.',
          case when candidate->>'confidence'='assumption' then 'Потрібне придатне першоджерело для цього твердження.' end,
          class_floor);
    end loop;
  end if;
  return new;
end $$;
create trigger research_artifact_candidates after insert on office.artifacts for each row execute function office.stage_research_artifact();
revoke all on function office.stage_research_artifact() from public,anon,authenticated,service_role,office_app;

-- The sole terminal-state writer: owner checked before locking; duplicate clicks are
-- idempotent for the same decision and rejected for a conflicting decision.
create function office.review_knowledge_candidate(p_id uuid,p_decision text,p_valid_until date,p_note text,p_expected_hash text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c office.knowledge_candidates; a office.artifacts;
begin
  select * into c from office.knowledge_candidates where id=p_id;
  if not found or not office.has_role(c.workspace_id,array['owner']) then
    raise exception 'only owner may review research candidates' using errcode='42501';
  end if;
  select * into c from office.knowledge_candidates where id=p_id for update;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
  if c.status = p_decision then return c.approved_doc_id; end if;
  if c.status <> 'candidate' then raise exception 'candidate already reviewed' using errcode='55000'; end if;
  if p_expected_hash is not null and p_expected_hash <> md5(to_jsonb(c)::text) then
    raise exception 'candidate changed since review' using errcode='55000';
  end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'review note too long' using errcode='22023'; end if;
  if p_decision='approved' and (p_valid_until is null or p_valid_until < (now() at time zone 'Europe/Kyiv')::date) then
    raise exception 'approval requires an unexpired validity date' using errcode='23514';
  end if;
  if p_decision='rejected' and length(trim(coalesce(p_note,'')))=0 then raise exception 'rejection needs a comment' using errcode='22023'; end if;
  update office.knowledge_candidates set status=p_decision,
    valid_until=case when p_decision='approved' then p_valid_until else valid_until end,review_note=coalesce(p_note,'') where id=p_id;
  select * into c from office.knowledge_candidates where id=p_id;
  select * into a from office.artifacts where id=c.research_artifact_id;
  insert into office.approvals(workspace_id,run_id,artifact_id,artifact_hash,decision,rationale,approver_id,scope,target_id)
    values(c.workspace_id,a.run_id,a.id,a.content_hash,p_decision,coalesce(p_note,''),auth.uid(),'knowledge_candidate',c.id);
  perform office.log_event(c.workspace_id,a.run_id,a.step_id,'user',auth.uid(),'research_analyst','knowledge.' || p_decision,'idle',
    jsonb_build_object('candidate_id',c.id,'knowledge_id',c.approved_doc_id));
  return c.approved_doc_id;
end $$;
revoke all on function office.review_knowledge_candidate(uuid,text,date,text,text) from public,anon,service_role,office_app;
grant execute on function office.review_knowledge_candidate(uuid,text,date,text,text) to authenticated;

create function office.knowledge_refs_expired(s office.steps) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from jsonb_array_elements(coalesce(s.agent_request->'governance'->'knowledge_refs','[]'::jsonb)) ref
      join office.knowledge_docs k on k.id::text=ref->>'record_id' and k.workspace_id=s.workspace_id
      where k.valid_until < (now() at time zone 'Europe/Kyiv')::date);
$$;
-- Expiry takes precedence and remains enforced with general governance disabled.
create function office.gateway_policy_reason(e office.executors,s office.steps) returns text
language sql stable security definer set search_path = '' as $$
  select case when office.knowledge_refs_expired(s) then 'knowledge_expired'
    when not coalesce((office.setting(s.workspace_id,'governance_enforced'))::boolean,true) or e.provider='human'
      or (office.provider_max_class(e.provider) is not null
        and office.data_class_rank(coalesce(s.agent_request->'governance'->>'data_class','internal')) <= office.data_class_rank(office.provider_max_class(e.provider))) then null
    else 'data_class_above_provider_policy' end;
$$;
create or replace function office.gateway_policy_ok(e office.executors,s office.steps) returns boolean
language sql stable security definer set search_path = '' as $$
  select office.gateway_policy_reason(e,s) is null;
$$;
revoke all on function office.knowledge_refs_expired(office.steps),office.gateway_policy_reason(office.executors,office.steps)
  from public,anon,authenticated,service_role,office_app;

-- Same P0 provider governance; additionally omit expired knowledge from content AND refs.
create or replace function office.worker_context(p_step uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select s, r, b, w,
           (select to_jsonb(a) from office.agents a where a.workspace_id = s.workspace_id and a.role_key = s.agent_role) as agent,
           office.provider_for_kind(coalesce(s.executor,
             (select a.default_executor from office.agents a where a.workspace_id = s.workspace_id and a.role_key = s.agent_role),
             'claude_session')) as provider,
           coalesce((office.setting(s.workspace_id, 'governance_enforced'))::boolean, true) as enforced
    from office.steps s join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
    join office.workspaces w on w.id = s.workspace_id
    where s.id = p_step
  ), lim as (
    select base.*, office.provider_max_class(provider) as max_class from base
  ), kn as (
    select k.id, k.title, k.kind, k.body, k.source_url, k.freshness_date, k.data_class, k.valid_until,
           office.knowledge_version(k) as version,
           (not lim.enforced
                 or (lim.max_class is not null and office.data_class_rank(k.data_class) <= office.data_class_rank(lim.max_class)
                     and k.data_class <> 'personal')) as allowed
    from lim join office.knowledge_docs k on k.workspace_id = (lim.s).workspace_id and k.status = 'approved'
      and (k.valid_until is null or k.valid_until >= (now() at time zone 'Europe/Kyiv')::date)
  )
  select jsonb_build_object(
    'step', to_jsonb(lim.s),
    'run', to_jsonb(lim.r),
    'brief', to_jsonb(lim.b),
    'workspace', jsonb_build_object('id', (lim.w).id, 'slug', (lim.w).slug, 'name', (lim.w).name),
    'agent', lim.agent,
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'version', k.version,
                                                               'title', k.title, 'kind', k.kind, 'body', k.body,
                                                               'source_url', k.source_url, 'freshness_date', k.freshness_date,
                                                               'data_class', k.data_class, 'valid_until', k.valid_until)
                                            order by k.kind, k.title)
                           from kn k where k.allowed), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'version', x.version, 'content', x.content,
                                                               'id', x.id, 'hash', x.content_hash)
                                            order by x.kind, x.version)
                           from office.artifacts x where x.run_id = (lim.s).run_id), '[]'::jsonb),
    'governance', jsonb_build_object(
       'provider', lim.provider,
       'max_data_class', lim.max_class,
       'enforced', lim.enforced,
       -- The brief and artifacts are internal by default, so the envelope is never below internal.
       'data_class', (select u.c from (select k.data_class as c from kn k where k.allowed union all select 'internal') u
                      order by office.data_class_rank(u.c) desc limit 1),
       'knowledge_refs', coalesce((select jsonb_agg(jsonb_build_object('record_id', k.id,
                                     'version', k.version, 'data_class', k.data_class)
                                     order by k.title) from kn k where k.allowed), '[]'::jsonb),
       'excluded_count', (select count(*) from kn k where not k.allowed))
  )
  from lim
$$;

-- An answer based on expired inputs stays a proposal, including direct gateway callers.
create or replace function office.gateway_submit(p_token_hash text, p_attempt uuid, p_lease_token text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; a office.execution_attempts; s office.steps; v_reason text;
begin
  e := office.gateway_executor(p_token_hash, 'submit');
  if jsonb_typeof(p_result) <> 'object' then raise exception 'result must be a JSON object' using errcode = '22023'; end if;
  select * into a from office.execution_attempts where id = p_attempt for update;
  if not found or a.executor_id <> e.id or a.lease_token_hash <> encode(sha256(convert_to(p_lease_token, 'UTF8')), 'hex') then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
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

-- Distinguish expiry from provider-policy denial without changing MCP tool schemas.
create or replace function office.gateway_get(p_token_hash text, p_step uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; s office.steps; v_env jsonb;
begin
  e := office.gateway_executor(p_token_hash, 'get');
  select * into s from office.steps where id = p_step;
  if not found or s.workspace_id <> e.workspace_id then raise exception 'task not found' using errcode = 'P0002'; end if;
  if not office.gateway_policy_ok(e, s) then
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'governance.blocked', 'idle',
      jsonb_build_object('executor_label', e.label, 'provider', e.provider, 'op', 'get'));
    return jsonb_build_object('task_id', s.id, 'status', s.status, 'claimable', false, 'reason', office.gateway_policy_reason(e,s));
  end if;
  v_env := office.gateway_envelope(s.id);
  perform office.record_transfer(e, s, 'get', v_env);
  return v_env || jsonb_build_object('status', s.status,
    'claimable', office.gateway_eligible(e, s)
      and not exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed' and x.lease_expires_at > now()));
end $$;
create or replace function office.gateway_claim(p_token_hash text, p_step uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; s office.steps; v_token text; v_attempt uuid; v_expires timestamptz; v_env jsonb;
begin
  e := office.gateway_executor(p_token_hash, 'claim');
  perform office.gateway_expire();
  if p_step is null then
    select st.* into s from office.steps st join office.runs r on r.id = st.run_id and r.status = 'running'
    where office.gateway_eligible(e, st) and office.gateway_policy_ok(e, st)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
    order by st.created_at for update of st skip locked limit 1;
    if not found then
      if exists(select 1 from office.steps st join office.runs r on r.id=st.run_id and r.status='running'
        where office.gateway_eligible(e,st) and office.knowledge_refs_expired(st)) then
        return jsonb_build_object('claimed',false,'reason','knowledge_expired');
      end if;
      return jsonb_build_object('claimed',false,'reason','no_tasks');
    end if;
  else
    select * into s from office.steps where id = p_step for update;
    if not found or s.workspace_id <> e.workspace_id then raise exception 'task not found' using errcode = 'P0002'; end if;
    if not office.gateway_independent(e, s) then
      return jsonb_build_object('claimed', false, 'reason', 'not_independent');
    end if;
    if not office.gateway_eligible(e, s) then
      return jsonb_build_object('claimed', false, 'reason', 'not_assigned_to_you_or_not_waiting');
    end if;
    if not office.gateway_policy_ok(e, s) then
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'governance.blocked', 'idle',
        jsonb_build_object('executor_label', e.label, 'provider', e.provider, 'op', 'claim'));
      return jsonb_build_object('claimed', false, 'reason', office.gateway_policy_reason(e,s));
    end if;
    if exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed') then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(mins => e.lease_minutes);
  insert into office.execution_attempts (step_id, run_id, workspace_id, executor_id, lease_token_hash, lease_expires_at, input_hashes)
  values (s.id, s.run_id, s.workspace_id, e.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires,
          office.run_input_hashes(s.run_id))
  returning id into v_attempt;
  v_env := office.gateway_envelope(s.id);
  perform office.record_transfer(e, s, 'claim', v_env);
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.claimed',
    office.activity_for_role(s.agent_role),
    jsonb_build_object('step', s.step_key, 'attempt_id', v_attempt, 'executor', e.kind, 'executor_name', e.name,
                       'executor_id', e.id, 'executor_label', e.label, 'lease_expires_at', v_expires));
  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt, 'lease_token', v_token, 'lease_expires_at', v_expires,
                            'envelope', v_env);
end $$;
-- Reprepare stale parked work automatically on every worker_claim tick.
create or replace function office.worker_reap() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0; locked_attempts uuid[];
begin
  for s in select * from office.steps where status = 'running' and locked_until < now() for update skip locked loop
    n := n + 1;
    if s.attempt >= s.max_attempts then
      update office.steps set status = 'failed', error = 'lease expired, attempts exhausted',
        locked_by = null, locked_until = null, finished_at = now() where id = s.id;
      update office.runs set status = 'failed', error_code = 'step_dead_lettered',
        error_message = s.step_key || ': lease expired' where id = s.run_id and status = 'running';
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role,
        'step.dead_lettered', 'blocked', jsonb_build_object('reason', 'lease_expired'));
    else
      update office.steps set status = 'ready', locked_by = null, locked_until = null,
        next_attempt_at = now() + make_interval(secs => least(300, 15 * power(2, s.attempt)::int)) where id = s.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role,
        'step.lease_expired', 'idle', jsonb_build_object('attempt', s.attempt));
    end if;
  end loop;
  -- Skip concurrently held steps/attempts rather than reversing gateway_submit's
  -- attempt -> step lock order. The next worker tick will recover skipped rows.
  for s in select st.* from office.steps st join office.runs r on r.id=st.run_id
      join office.workspaces w on w.id=st.workspace_id
      where st.status in ('awaiting_agent','ready') and office.knowledge_refs_expired(st)
        and r.status in ('queued','running') and w.status='active'
      for update of st skip locked loop
    locked_attempts := array(select a.id from office.execution_attempts a where a.step_id=s.id
      and a.state in ('claimed','expired','submitted') order by a.id for update skip locked);
    if exists(select 1 from office.execution_attempts a where a.step_id=s.id
        and a.state in ('claimed','expired','submitted') and not (a.id=any(locked_attempts))) then continue; end if;
    update office.execution_attempts set state='rejected',rejection_reason='knowledge_expired'
      where id=any(locked_attempts);
    update office.steps set status='ready',agent_request=null,agent_response=null,
      locked_by=null,locked_until=null,next_attempt_at=now(),finished_at=null where id=s.id;
    perform office.log_event(s.workspace_id,s.run_id,s.id,'system',null,s.agent_role,
      'step.knowledge_expired','planning',jsonb_build_object('reason','knowledge_expired','step',s.step_key,'next','reprepare'));
    n := n+1;
  end loop;
  return n;
end $$;
