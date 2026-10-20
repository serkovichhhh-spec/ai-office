-- DRAFT ONLY. Intentionally outside migrations/: do not apply to Supabase.
-- Local acceptance tests explicitly load this file after migrations 0001..0008.
-- Additive: existing functions, columns, statuses and approval records are preserved.

alter table office.knowledge_docs add column valid_until date;
grant update (valid_until) on office.knowledge_docs to authenticated;

-- Separate staging area avoids changing knowledge_docs' existing status constraint.
-- Unapproved research cannot enter worker_context's approved knowledge query.
create table office.knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references office.workspaces(id),
  research_artifact_id uuid not null references office.artifacts(id),
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
  created_by uuid not null default auth.uid() references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
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
grant update (title, claim, confidence, sources, why_it_matters, owner_question, valid_until, data_class, status)
  on office.knowledge_candidates to authenticated;

-- Invoker rights: promotion uses the owner's existing Knowledge Hub INSERT permission.
create function office.guard_knowledge_candidate() returns trigger
language plpgsql set search_path = '' as $$
declare source_run uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'candidate' or new.approved_doc_id is not null or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'research must start as candidate' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if old.status <> 'candidate' then raise exception 'reviewed candidate is immutable' using errcode = '42501'; end if;
    if new.workspace_id is distinct from old.workspace_id or new.research_artifact_id is distinct from old.research_artifact_id
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
