-- Stage 4. Owner-approved finite programs; shadow remains the default.
begin;
alter table office.automation_settings add column program_engine_enabled boolean not null default false;
create table office.program_playbooks(playbook_key text not null,version int not null,brief_schema jsonb not null,primary key(playbook_key,version));
insert into office.program_playbooks values('smm_content_plan',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":100},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"period_start":{"type":"string","minLength":1,"maxLength":10,"format":"date"},"period_end":{"type":"string","minLength":1,"maxLength":10,"format":"date"},"channels":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":5,"uniqueItems":true},"pillars":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"capacity_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":10,"uniqueItems":true},"events_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","period_start","period_end","channels","capacity_knowledge_ids"]}'::jsonb);
insert into office.program_playbooks values('social_content_pack',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"content_kind":{"type":"string","enum":["post","stories","carousel","short_video"]},"channels":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":5,"uniqueItems":true},"plan_item_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true},"available_asset_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true},"production_constraints":{"type":"string","minLength":1,"maxLength":3000},"platform_spec_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":20,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","content_kind","channels","production_constraints","platform_spec_knowledge_ids"]}'::jsonb);
insert into office.program_playbooks values('graphic_design_pack',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"placements":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"format_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"asset_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true},"art_direction_artifact_id":{"type":"string","minLength":1,"maxLength":3000},"required_copy":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":20,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","placements","format_knowledge_ids"]}'::jsonb);
insert into office.program_playbooks values('campaign_art_direction',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":3},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"campaign_channels":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"mandatory_asset_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true},"visual_constraints":{"type":"string","minLength":1,"maxLength":3000},"reference_notes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":20,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","campaign_channels","visual_constraints"]}'::jsonb);
insert into office.program_playbooks values('creative_ideation',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":5},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"idea_kind":{"type":"string","enum":["campaign","activation","hook","naming","mechanic"]},"candidate_count":{"type":"integer","minimum":6,"maximum":12},"creative_boundaries":{"type":"string","minLength":1,"maxLength":3000},"rejected_ideas":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","idea_kind","candidate_count","creative_boundaries"]}'::jsonb);
insert into office.program_playbooks values('paid_media_campaign',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"platform":{"type":"string","enum":["meta","google"]},"offer_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"geo_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"budget_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"conversion_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"platform_spec_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":20,"uniqueItems":true},"landing_knowledge_id":{"type":"string","minLength":1,"maxLength":3000}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","platform","offer_knowledge_id","geo_knowledge_ids","budget_knowledge_id","conversion_knowledge_id","platform_spec_knowledge_ids","landing_knowledge_id"]}'::jsonb);
insert into office.program_playbooks values('reels_concepts',3,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":10},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"video_kind":{"type":"string","enum":["reel","promo","explainer","testimonial"]},"duration_seconds":{"type":"number","minimum":1,"maximum":3600},"format_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"production_constraints":{"type":"string","minLength":1,"maxLength":3000},"asset_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true},"voice_style":{"type":"string","minLength":1,"maxLength":3000}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","video_kind","duration_seconds","format_knowledge_ids","production_constraints"]}'::jsonb);
insert into office.program_playbooks values('outdoor_print_pack',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":10},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"medium":{"type":"string","enum":["billboard","citylight","flyer","a4","other"]},"supplier_spec_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"placement_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"cta_route_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"mandatory_copy":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":20,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","medium","supplier_spec_knowledge_id","placement_knowledge_ids","cta_route_knowledge_id"]}'::jsonb);
insert into office.program_playbooks values('offer_launch',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":20},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"offer_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"launch_channels":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":12,"uniqueItems":true},"launch_at":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"readiness_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":20,"uniqueItems":true},"previous_offer_knowledge_id":{"type":"string","minLength":1,"maxLength":3000}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","offer_knowledge_id","launch_channels","launch_at","readiness_knowledge_ids"]}'::jsonb);
insert into office.program_playbooks values('campaign_analysis',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"dataset_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":20,"uniqueItems":true},"period":{"type":"string","minLength":1,"maxLength":3000},"comparison_period":{"type":"string","minLength":1,"maxLength":3000},"metric_keys":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"decision_question":{"type":"string","minLength":1,"maxLength":3000}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","dataset_knowledge_ids","period","metric_keys","decision_question"]}'::jsonb);
insert into office.program_playbooks values('competitor_analysis',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"competitors":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":10,"uniqueItems":true},"dimensions":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":10,"uniqueItems":true},"geo_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"source_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"research_mode":{"type":"string","enum":["knowledge_only","candidate_collection"]}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","competitors","dimensions","geo_knowledge_ids","source_knowledge_ids","research_mode"]}'::jsonb);
insert into office.program_playbooks values('owned_media_copy',2,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":30},"deadline":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"minItems":0,"maxItems":20},"copy_kind":{"type":"string","enum":["website","landing","email","sms","pr","ivr","faq"]},"message_knowledge_ids":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":30,"uniqueItems":true},"destination_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"delivery_spec_knowledge_id":{"type":"string","minLength":1,"maxLength":3000},"publication_at":{"type":"string","minLength":1,"maxLength":80,"format":"date-time"},"mandatory_sections":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":0,"maxItems":30,"uniqueItems":true}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references","copy_kind","message_knowledge_ids","delivery_spec_knowledge_id"]}'::jsonb);
insert into office.program_playbooks values('research_brief',1,'{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"objective":{"type":"string","minLength":1,"maxLength":3000},"audience":{"type":"string","minLength":1,"maxLength":2000},"channel":{"type":"string","minLength":1,"maxLength":120},"deliverable_count":{"type":"integer","minimum":1,"maximum":10},"deadline":{"type":"string","format":"date","minLength":10,"maxLength":40},"acceptance_criteria":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1500},"minItems":1,"maxItems":20},"references":{"type":"array","items":{"type":"string","minLength":1,"maxLength":2048},"maxItems":20}},"required":["title","objective","audience","channel","deliverable_count","deadline","acceptance_criteria","references"]}'::jsonb);
create table office.programs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references office.workspaces(id),
 parent_run_id uuid not null references office.runs(id),plan_artifact_id uuid not null unique references office.artifacts(id),plan_hash text not null,plan jsonb not null,
 status text not null default 'active' check(status in ('active','blocked','completed','cancelled')),blocked_reason text,
 budget_usd numeric(10,4) not null check(budget_usd>0 and budget_usd<'Infinity'::numeric),max_triggers int not null default 8 check(max_triggers between 1 and 50),
 approved_by uuid not null references auth.users(id),approved_at timestamptz not null default now()
);
create unique index programs_one_live_parent on office.programs(parent_run_id) where status in ('active','blocked');
alter table office.runs add column program_id uuid references office.programs(id);
create index runs_program on office.runs(program_id) where program_id is not null;
create table office.program_items(
 program_id uuid not null references office.programs(id),workspace_id uuid not null references office.workspaces(id),
 item_key text not null,run_id uuid not null unique references office.runs(id),depends_on text[] not null,primary key(program_id,item_key)
);
create table office.program_gates(
 program_id uuid not null references office.programs(id),workspace_id uuid not null references office.workspaces(id),after_item text not null,question text not null,
 approved_by uuid references auth.users(id),approved_at timestamptz,note text,primary key(program_id,after_item)
);
alter table office.programs enable row level security;
alter table office.program_items enable row level security;
alter table office.program_gates enable row level security;
alter table office.program_playbooks enable row level security;
create policy programs_read on office.programs for select to authenticated using(office.is_member(workspace_id));
create policy items_read on office.program_items for select to authenticated using(office.is_member(workspace_id));
create policy gates_read on office.program_gates for select to authenticated using(office.is_member(workspace_id));
create policy program_registry_read on office.program_playbooks for select to authenticated using(true);
revoke all on office.programs,office.program_items,office.program_gates,office.program_playbooks from public,anon,authenticated,service_role,office_app;
grant select on office.programs,office.program_items,office.program_gates,office.program_playbooks to authenticated;

-- Validator for the explicit subset used by the frozen brief schemas. No dynamic SQL or runtime graph generation.
create function office.program_brief_valid(schema jsonb,v jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare k text;child jsonb;x jsonb;typ text:=schema->>'type';str text;
begin
 if v is null then return false;end if;
 if schema ? 'enum' and not exists(select 1 from jsonb_array_elements(schema->'enum') e where e=v) then return false;end if;
 if typ='object' then
  if jsonb_typeof(v)<>'object' then return false;end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(schema->'required','[]')) r where not(v ? r)) then return false;end if;
  for k,child in select * from jsonb_each(v) loop
   if not(schema->'properties' ? k) then if schema->'additionalProperties'='false'::jsonb then return false;end if;
   elsif not office.program_brief_valid(schema->'properties'->k,child) then return false;end if;
  end loop;
 elsif typ='array' then
  if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<coalesce((schema->>'minItems')::int,0)
   or jsonb_array_length(v)>coalesce((schema->>'maxItems')::int,10000) then return false;end if;
  if schema->>'uniqueItems'='true' and (select count(*)<>count(distinct e) from jsonb_array_elements(v) e) then return false;end if;
  for x in select value from jsonb_array_elements(v) loop if not office.program_brief_valid(schema->'items',x) then return false;end if;end loop;
 elsif typ='string' then
  if jsonb_typeof(v)<>'string' then return false;end if;str:=v#>>'{}';
  if length(str)<coalesce((schema->>'minLength')::int,0) or length(str)>coalesce((schema->>'maxLength')::int,1000000) then return false;end if;
  if schema->>'format' in ('date','date-time') then
   if str !~ '^\d{4}-\d{2}-\d{2}(T.*)?$' then return false;end if;perform str::timestamptz;
  end if;
 elsif typ in ('integer','number') then
  if jsonb_typeof(v)<>'number' then return false;end if;
  if typ='integer' and (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric) then return false;end if;
  if schema ? 'minimum' and (v#>>'{}')::numeric<(schema->>'minimum')::numeric then return false;end if;
  if schema ? 'maximum' and (v#>>'{}')::numeric>(schema->>'maximum')::numeric then return false;end if;
 elsif typ is not null and jsonb_typeof(v)<>typ then return false;
 end if;
 return true;
exception when others then return false;
end $$;
create function office.program_plan_valid(p_ws uuid,p jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare w jsonb;schema jsonb;n int;cap int;k text;v jsonb;ids text[];dep text;record_id text;
begin
 if jsonb_typeof(p->'workstreams') is distinct from 'array' or jsonb_typeof(p->'owner_gates') is distinct from 'array' then return false;end if;
 n:=jsonb_array_length(p->'workstreams');cap:=case p->>'depth' when 'light' then 2 when 'standard' then 4 when 'deep' then 6 else 0 end;
 if n is null or n<1 or n>cap then return false;end if;
 select array_agg(x->>'id') into ids from jsonb_array_elements(p->'workstreams') x;
 if (select count(*)<>count(distinct x) from unnest(ids) x) then return false;end if;
 for w in select value from jsonb_array_elements(p->'workstreams') loop
  if coalesce(w->>'id','') !~ '^ws[0-9]+$' or coalesce(w->>'playbook','') !~ '^[a-z_]+@[1-9][0-9]*$' or split_part(w->>'playbook','@',1)='program' then return false;end if;
  select brief_schema into schema from office.program_playbooks where playbook_key=split_part(w->>'playbook','@',1) and version=split_part(w->>'playbook','@',2)::int;
  if not found or not office.program_brief_valid(schema,w->'inputs') or coalesce((w->'inputs'->>'deliverable_count')::int,0)>10 then return false;end if;
  if jsonb_typeof(w->'depends_on')<>'array' then return false;end if;
  for dep in select jsonb_array_elements_text(w->'depends_on') loop if dep=w->>'id' or not(dep=any(ids)) then return false;end if;end loop;
  if (select count(*)<>count(distinct x) from jsonb_array_elements(w->'depends_on') x) then return false;end if;
  for k,v in select * from jsonb_each(w->'inputs') loop
   if k ~ '_knowledge_ids?$' then
    for record_id in select value#>>'{}' from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else jsonb_build_array(v) end) loop
     if not exists(select 1 from office.knowledge_docs d where d.workspace_id=p_ws and d.id::text=record_id and d.status='approved' and (d.expires_at is null or d.expires_at>=current_date)) then return false;end if;
    end loop;
   end if;
  end loop;
 end loop;
 if exists(with recursive walk(id,path,cycle) as (
  select x->>'id',array[x->>'id'],false from jsonb_array_elements(p->'workstreams') x
  union all select dep.value,walk.path||dep.value,dep.value=any(walk.path) from walk
   join lateral (select jsonb_array_elements_text(x->'depends_on') value from jsonb_array_elements(p->'workstreams') x where x->>'id'=walk.id) dep on true
   where not walk.cycle and cardinality(walk.path)<=7
 )select 1 from walk where cycle) then return false;end if;
 for w in select value from jsonb_array_elements(p->'owner_gates') loop
  if not(coalesce(w->>'after','')=any(ids)) or length(trim(coalesce(w->>'question','')))=0 then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;
create function office.set_program_engine(p_ws uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not office.has_role(p_ws,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 insert into office.automation_settings(workspace_id,program_engine_enabled) values(p_ws,p_enabled)
 on conflict(workspace_id) do update set program_engine_enabled=excluded.program_engine_enabled;
 perform office.log_event(p_ws,null,null,'user',auth.uid(),null,'program.engine_configured','idle',jsonb_build_object('enabled',p_enabled));
end $$;
create function office.start_program(p_artifact uuid,p_budget numeric,p_trigger_cap int default 8) returns uuid
language plpgsql security definer set search_path='' as $$
declare a office.artifacts;r office.runs;w office.workspaces;p_id uuid;item jsonb;child_brief uuid;child_run uuid;child jsonb;share numeric;n int;
begin
 select * into a from office.artifacts where id=p_artifact;
 if not found or not office.has_role(a.workspace_id,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 select * into r from office.runs where id=a.run_id for update;
 select id into p_id from office.programs where plan_artifact_id=a.id;if found then return p_id;end if;
 if not exists(select 1 from office.automation_settings where workspace_id=a.workspace_id and program_engine_enabled) then raise exception 'program engine disabled' using errcode='55000';end if;
 if r.playbook_key<>'program' or r.status<>'needs_approval' or a.kind<>'work_plan' or a.provider='stub'
  or a.version<>(select max(version) from office.artifacts where run_id=r.id and kind='work_plan') then raise exception 'latest reviewed work plan required' using errcode='55000';end if;
 if jsonb_array_length(coalesce(a.content->'open_questions','[]'))>0 or not office.program_plan_valid(a.workspace_id,a.content) then raise exception 'plan has unresolved questions or invalid inputs' using errcode='22023';end if;
 select * into w from office.workspaces where id=a.workspace_id;
 n:=jsonb_array_length(a.content->'workstreams');share:=trunc(p_budget/n,4);
 if p_budget is null or p_budget<=0 or p_budget>='Infinity'::numeric or p_budget>r.budget_usd or share<=0 or p_trigger_cap is null or p_trigger_cap not between 1 and 50 then raise exception 'invalid program budget or trigger cap' using errcode='22023';end if;
 insert into office.programs(workspace_id,parent_run_id,plan_artifact_id,plan_hash,plan,budget_usd,max_triggers,approved_by)
 values(a.workspace_id,r.id,a.id,a.content_hash,a.content,p_budget,p_trigger_cap,auth.uid()) returning id into p_id;
 for item in select value from jsonb_array_elements(a.content->'workstreams') loop
  child:=item->'inputs';
  child:=child||jsonb_build_object('playbook_key',split_part(item->>'playbook','@',1),'playbook_version',split_part(item->>'playbook','@',2)::int,
   'priority',(select priority from office.briefs where id=r.brief_id),
   'fields',child-array['title','objective','audience','channel','deliverable_count','deadline','acceptance_criteria','references']);
  child_brief:=office.create_brief(a.workspace_id,child);
  child_run:=office.submit_brief(child_brief,'program:'||p_id::text||':'||(item->>'id'));
  update office.runs set program_id=p_id,budget_usd=share where id=child_run;
  insert into office.program_items(program_id,workspace_id,item_key,run_id,depends_on)
   values(p_id,a.workspace_id,item->>'id',child_run,array(select jsonb_array_elements_text(item->'depends_on')));
 end loop;
 insert into office.program_gates(program_id,workspace_id,after_item,question)
  select p_id,a.workspace_id,x->>'after',string_agg(x->>'question',E'\n' order by x->>'question') from jsonb_array_elements(a.content->'owner_gates') x group by x->>'after';
 perform office.log_event(a.workspace_id,r.id,null,'user',auth.uid(),null,'program.started','planning',jsonb_build_object('program_id',p_id,'plan_hash',a.content_hash,'budget_usd',p_budget,'children',n));
 return p_id;
end $$;
create function office.program_child_done(p_run uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select status in ('approved','handoff_queued') or
  (playbook_key='research_brief' and status='needs_approval'
   and exists(select 1 from office.knowledge_docs k where k.origin_run_id=p_run and k.status='approved' and (k.expires_at is null or k.expires_at>=current_date))
   and not exists(select 1 from office.knowledge_docs k where k.origin_run_id=p_run and k.status='draft'))
  from office.runs where id=p_run),false)
$$;
create function office.program_ready(p_run uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when r.program_id is null then true else p.status='active' and settings.program_engine_enabled
  and (select coalesce(sum(x.cost_usd),0) from office.runs x where x.program_id=p.id)<p.budget_usd
  and not exists(select 1 from office.program_items parent where parent.program_id=p.id and parent.item_key=any(i.depends_on)
    and not office.program_child_done(parent.run_id))
  and not exists(select 1 from office.program_gates g where g.program_id=p.id and g.after_item=any(i.depends_on) and g.approved_at is null)
 end from office.runs r left join office.programs p on p.id=r.program_id
 left join office.automation_settings settings on settings.workspace_id=r.workspace_id
 left join office.program_items i on i.run_id=r.id where r.id=p_run
$$;
create function office.program_refresh() returns void
language plpgsql security definer set search_path='' as $$
begin
 update office.programs p set status='blocked',blocked_reason='child_failed_or_cancelled'
  where status='active' and exists(select 1 from office.runs r where r.program_id=p.id and r.status in ('failed','cancelled'));
 update office.programs p set status='blocked',blocked_reason='program_budget_exceeded'
  where status='active' and (select coalesce(sum(cost_usd),0) from office.runs where program_id=p.id)>=p.budget_usd;
 update office.programs p set status='completed',blocked_reason=null where status='active'
  and exists(select 1 from office.program_items i where i.program_id=p.id)
  and not exists(select 1 from office.program_items i where i.program_id=p.id and not office.program_child_done(i.run_id))
  and not exists(select 1 from office.program_gates g where g.program_id=p.id and g.approved_at is null);
end $$;
create function office.approve_program_gate(p_id uuid,p_after text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare p office.programs;
begin
 select * into p from office.programs where id=p_id for update;
 if not found or not office.has_role(p.workspace_id,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 if p.status<>'active' or not exists(select 1 from office.program_items i where i.program_id=p.id and i.item_key=p_after and office.program_child_done(i.run_id)) then raise exception 'dependency is not approved' using errcode='55000';end if;
 update office.program_gates set approved_by=auth.uid(),approved_at=now(),note=coalesce(p_note,'') where program_id=p.id and after_item=p_after and approved_at is null;
 if found then perform office.log_event(p.workspace_id,p.parent_run_id,null,'user',auth.uid(),null,'program.gate_approved','planning',jsonb_build_object('program_id',p.id,'after',p_after,'note',p_note));end if;
 perform office.program_refresh();
end $$;
create or replace function office.guard_run_transition() returns trigger
language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;
  ok := (old.status, new.status) in (
    ('queued','running'), ('queued','cancelled'), ('queued','failed'),
    ('running','needs_approval'), ('running','needs_input'), ('running','failed'), ('running','cancelled'),
    ('needs_input','running'), ('needs_input','cancelled'),
    ('needs_approval','approved'), ('needs_approval','running'), ('needs_approval','cancelled'),
    ('approved','handoff_queued')
  ) or (new.status='cancelled' and new.program_id is not null and old.status in ('approved','handoff_queued','failed')
    and exists(select 1 from office.programs p where p.id=new.program_id and p.status='cancelled'));
  if not ok then
    raise exception 'office.runs: transition % -> % is not allowed', old.status, new.status using errcode = '23514';
  end if;
  new.updated_at := now();
  if new.status = 'running' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('needs_approval','approved','handoff_queued','failed','cancelled') then new.finished_at := now(); end if;
  return new;
end $$;
create function office.cancel_program(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p office.programs;
begin
 select * into p from office.programs where id=p_id;
 if not found or not office.has_role(p.workspace_id,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 -- Parent first serializes approval/revision. Then take all child steps before child
 -- runs, matching the worker's order; never wait for a submitting attempt while holding its step.
 perform 1 from office.runs where id=p.parent_run_id for update;
 perform 1 from office.steps where run_id in(select id from office.runs where program_id=p.id) order by id for update;
 perform 1 from office.runs where program_id=p.id order by id for update;
 select * into p from office.programs where id=p_id for update;
 if p.status='cancelled' then return;end if;
 update office.programs set status='cancelled',blocked_reason='cancelled_by_owner' where id=p.id;
 update office.runs set status='cancelled',error_code='program_cancelled' where program_id=p.id;
 update office.steps set status='cancelled',locked_by=null,locked_until=null where run_id in(select id from office.runs where program_id=p.id) and status in ('ready','running','awaiting_agent');
 update office.execution_attempts set state='released',rejection_reason='program_cancelled' where id in(
  select a.id from office.execution_attempts a where a.run_id in(select id from office.runs where program_id=p.id)
    and a.state='claimed' for update of a skip locked);
 update office.handoffs set status='cancelled' where run_id in(select id from office.runs where program_id=p.id) and status not in ('done','cancelled');
 update office.runs set status='cancelled',error_code='program_cancelled' where id=p.parent_run_id;
 perform office.log_event(p.workspace_id,p.parent_run_id,null,'user',auth.uid(),null,'program.cancelled','idle',jsonb_build_object('program_id',p.id));
end $$;

create or replace function office.run_input_hashes(p_run uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'version',version,'hash',content_hash) order by kind),'[]'::jsonb) from (
 select a.kind,a.version,a.content_hash from office.artifacts a where a.run_id=p_run
  and a.version=(select max(b.version) from office.artifacts b where b.run_id=a.run_id and b.kind=a.kind)
 union all
 select 'upstream:'||parent.item_key||':deliverable',a.version,a.content_hash from office.program_items i
  join office.program_items parent on parent.program_id=i.program_id and parent.item_key=any(i.depends_on)
  join office.artifacts a on a.run_id=parent.run_id and a.kind='deliverable' where i.run_id=p_run
   and a.version=(select max(b.version) from office.artifacts b where b.run_id=a.run_id and b.kind=a.kind)
 ) q
$$;

create or replace function office.worker_claim(p_worker text, p_limit int default 3, p_lease_seconds int default 120)
returns setof office.steps
language plpgsql security definer set search_path = '' as $$
declare s office.steps; r office.runs; w office.workspaces; spent numeric; v_program uuid;
begin
  perform office.worker_reap();
  perform office.program_refresh();
  for s in
    select st.* from office.steps st join office.runs ru on ru.id = st.run_id
    where st.status = 'ready' and st.next_attempt_at <= now() and ru.status in ('queued','running') and office.program_ready(ru.id)
    order by st.created_at
    for update of st skip locked
    limit least(greatest(p_limit, 1), 10)
  loop
    select * into r from office.runs where id = s.run_id for update;
    if r.program_id is not null then
      select id into v_program from office.programs where id=r.program_id and status='active' for update skip locked;
      if not found or office.program_ready(r.id) is not true then continue;end if;
    end if;
    select * into w from office.workspaces where id = s.workspace_id;
    select coalesce(sum(cost_usd), 0) into spent from office.runs
      where workspace_id = w.id and created_at >= date_trunc('day', now());
    if w.status <> 'active' then
      continue;
    elsif r.cost_usd >= r.budget_usd and r.budget_usd > 0 and r.cost_usd > 0 then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'budget_exceeded',
        error_message = 'run budget reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.budget_exceeded', 'blocked', '{}');
      continue;
    elsif spent >= w.daily_budget_usd and w.daily_budget_usd > 0 and spent > 0 then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'daily_budget_exceeded',
        error_message = 'workspace daily budget reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.budget_exceeded', 'blocked', '{}');
      continue;
    elsif r.steps_executed >= w.max_steps_per_run then
      update office.steps set status = 'cancelled' where id = s.id;
      update office.runs set status = 'failed', error_code = 'max_steps_exceeded',
        error_message = 'step limit reached' where id = r.id;
      perform office.log_event(s.workspace_id, s.run_id, s.id, 'system', null, s.agent_role, 'run.max_steps', 'blocked', '{}');
      continue;
    end if;

    if s.agent_response is not null and s.agent_response->>'attempt_id' is not null and exists(
      select 1 from office.execution_attempts a where a.id=(s.agent_response->>'attempt_id')::uuid
      and a.input_hashes is distinct from office.run_input_hashes(s.run_id)) then
      update office.execution_attempts set state='rejected',rejection_reason='inputs_changed_after_submit'
       where id=(s.agent_response->>'attempt_id')::uuid and state='submitted';
      update office.steps set agent_response=null where id=s.id;
    end if;
    if r.status = 'queued' then update office.runs set status = 'running' where id = r.id; end if;
    update office.runs set steps_executed = steps_executed + 1 where id = r.id;
    update office.steps set status = 'running', attempt = attempt + 1, locked_by = p_worker,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now())
    where id = s.id returning * into s;
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.started',
      office.activity_for_role(s.agent_role), jsonb_build_object('step', s.step_key, 'attempt', s.attempt, 'cycle', s.cycle));
    return next s;
  end loop;
end $$;

create or replace function office.gateway_eligible(e office.executors,s office.steps) returns boolean
language sql stable set search_path = '' as $$
  select s.status = 'awaiting_agent' and s.workspace_id=e.workspace_id
    and (coalesce(s.input->>'routing_policy'='capabilities',false) or coalesce(s.executor,'claude_session')=e.kind)
    and (e.allowed_seats is null or s.agent_role=any(e.allowed_seats))
    and not exists (select 1 from unnest(s.requires) c where
      nullif(e.capabilities->c->>'verified_at','') is null or nullif(trim(e.capabilities->c->>'evidence'),'') is null)
    and office.executor_independent(e,s) and office.program_ready(s.run_id)
$$;

create or replace function office.trigger_next(p_slugs text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings office.automation_settings;c office.trigger_channels;e office.executors;s office.steps;t office.trigger_runs;
 n int;v_key text;reason text;v_skip uuid;
begin
 for settings in select a.* from office.automation_settings a join office.workspaces w on w.id=a.workspace_id
  where w.slug=any(p_slugs) and w.status='active' and a.triggers_enabled and a.kill_switch_at is null
  order by a.workspace_id for update of a skip locked loop
  for c in select * from office.trigger_channels where workspace_id=settings.workspace_id and enabled order by id for update skip locked loop
   reason:=null;
   if (select count(*)=3 and bool_and(status in ('failed','expired')) from
     (select status from office.trigger_runs where channel_id=c.id and status<>'skipped' order by created_at desc,id desc limit 3) recent) then reason:='consecutive_failures';
   elsif (select coalesce(sum(est_credits),0) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('month',now()))+c.est_credits_per_run>c.max_credits_per_month and not exists(select 1 from office.trigger_runs where channel_id=c.id and status='pending' and http_attempts<3) then reason:='credit_cap';end if;
   if reason is not null then
    update office.trigger_channels set enabled=false,paused_reason=reason where id=c.id;
    perform office.log_event(c.workspace_id,null,null,'system',null,null,'trigger.channel_paused','idle',jsonb_build_object('channel_id',c.id,'reason',reason));
    continue;
   end if;
   select * into e from office.executors where id=c.executor_id and workspace_id=c.workspace_id and revoked_at is null and mode='triggered' and kind='chatgpt';
   if not found then continue;end if;
   select st.* into s from office.steps st join office.runs r on r.id=st.run_id
    where st.workspace_id=c.workspace_id and r.status='running'
      and (r.program_id is null or exists(select 1 from office.programs p where p.id=r.program_id and
       ((select count(*) from office.trigger_runs x join office.runs cr on cr.id=x.run_id where cr.program_id=p.id and x.status<>'skipped')<p.max_triggers
       or exists(select 1 from office.trigger_runs x where x.step_id=st.id and x.channel_id=c.id and x.status='pending'))))
      and ((select count(*) from office.trigger_runs x where x.step_id=st.id and x.status<>'skipped')<2 or exists(select 1 from office.trigger_runs x where x.step_id=st.id and x.channel_id=c.id and x.status='pending'))
      and ((select count(*) from office.trigger_runs x where x.run_id=st.run_id and x.status<>'skipped')<settings.max_triggers_per_run or exists(select 1 from office.trigger_runs x where x.step_id=st.id and x.channel_id=c.id and x.status='pending'))
      and not exists(select 1 from office.trigger_runs x where x.step_id=st.id and
        (x.status in ('accepted','queued','in_progress','suspended') or
        (x.status='pending' and (x.dispatch_locked_until>now() or x.next_retry_at>now())))) and st.agent_role=any(c.allowed_seats) and office.gateway_eligible(e,st)
      and not exists(select 1 from office.execution_attempts a where a.step_id=st.id and a.state='claimed' and a.lease_expires_at>now())
    order by st.created_at for update of st skip locked limit 1;
   if not found then continue;end if;
   select * into t from office.trigger_runs where channel_id=c.id and step_id=s.id and status='pending' and attempt_id is null
    and http_attempts<3 and next_retry_at<=now() and (dispatch_locked_until is null or dispatch_locked_until<=now()) order by created_at for update limit 1;
   if found then
    update office.trigger_runs set dispatch_token=gen_random_uuid(),dispatch_locked_until=now()+interval '45 seconds',http_attempts=http_attempts+1,updated_at=now()
      where id=t.id returning * into t;
    return to_jsonb(t)||jsonb_build_object('channel_ref',c.channel_ref,'secret_ref',c.secret_ref);
   end if;
   reason:=null;
   if (select count(*) from office.trigger_runs where channel_id=c.id and status in ('pending','accepted','queued','in_progress','suspended'))>=c.max_concurrent then reason:='concurrency_cap';
   elsif (select count(*) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('day',now()))>=c.max_runs_per_day then reason:='daily_cap';
   elsif (select coalesce(sum(est_credits),0) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('month',now()))+c.est_credits_per_run>c.max_credits_per_month then reason:='credit_cap';
   elsif (select count(*) from office.trigger_runs where step_id=s.id and status<>'skipped')>=2 then reason:='step_trigger_cap';
   elsif (select count(*) from office.trigger_runs where run_id=s.run_id and status<>'skipped')>=settings.max_triggers_per_run then reason:='run_trigger_cap';end if;
   if reason is not null then
    v_key:=office.sha256_hex(s.id::text||':skip:'||reason||':'||date_trunc('hour',now())::text);
    insert into office.trigger_runs(channel_id,workspace_id,run_id,step_id,idempotency_key,status,error_code)
      values(c.id,c.workspace_id,s.run_id,s.id,v_key,'skipped',reason) on conflict do nothing;
    continue;
   end if;
   select count(*)+1 into n from office.trigger_runs where step_id=s.id and channel_id=c.id;
   v_key:=office.sha256_hex(s.id::text||':'||s.cycle::text||':'||n::text||':'||c.id::text);
   insert into office.trigger_runs(channel_id,workspace_id,run_id,step_id,idempotency_key,est_credits,http_attempts,dispatch_token,dispatch_locked_until)
    values(c.id,c.workspace_id,s.run_id,s.id,v_key,c.est_credits_per_run,1,gen_random_uuid(),now()+interval '45 seconds')
    on conflict(channel_id,idempotency_key) do nothing returning * into t;
   if found then return to_jsonb(t)||jsonb_build_object('channel_ref',c.channel_ref,'secret_ref',c.secret_ref);end if;
  end loop;
 end loop;
 return null;
end $$;

create or replace function office.worker_context(p_step uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'upstream_artifacts',coalesce((select jsonb_agg(jsonb_build_object('source_run_id',parent.run_id,'workstream',parent.item_key,'id',a.id,'version',a.version,'content',a.content))
       from office.program_items i join office.program_items parent on parent.program_id=i.program_id and parent.item_key=any(i.depends_on)
       join office.artifacts a on a.run_id=parent.run_id and a.kind='deliverable'
       where i.run_id=r.id and office.program_child_done(parent.run_id)
         and a.version=(select max(version) from office.artifacts a2 where a2.run_id=a.run_id and a2.kind='deliverable')),'[]'::jsonb),
    'step', to_jsonb(s),
    'run', to_jsonb(r),
    'brief', to_jsonb(b),
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'agent', (select to_jsonb(a) from office.agents a where a.workspace_id = s.workspace_id and a.role_key = s.agent_role),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'version', office.knowledge_version(k),
                                                               'title', k.title, 'kind', k.kind, 'body', k.body,
                                                               'source_url', k.source_url, 'freshness_date', k.freshness_date,'confidence',k.confidence,'sources',k.sources,'expires_at',k.expires_at)
                                            order by k.kind, k.title)
                           from office.knowledge_docs k where k.workspace_id = s.workspace_id and k.status = 'approved' and (k.expires_at is null or k.expires_at>=current_date)), '[]'::jsonb),
    'artifacts', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'version', x.version, 'content', x.content,
                                                               'id', x.id, 'hash', x.content_hash)
                                            order by x.kind, x.version)
                           from office.artifacts x where x.run_id = s.run_id), '[]'::jsonb)
  )
  from office.steps s join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
  join office.workspaces w on w.id = s.workspace_id
  where s.id = p_step
$$;

create or replace function office.cancel_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r office.runs;p_id uuid;
begin
  select * into r from office.runs where id = p_run;
  if not found or not office.has_role(r.workspace_id, array['owner','approver','editor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into p_id from office.programs where parent_run_id=p_run and status in ('active','blocked');
  if found then perform office.cancel_program(p_id);return;end if;
  if r.program_id is not null then perform 1 from office.steps where run_id=r.id order by id for update;end if;
  perform 1 from office.runs where id=r.id for update;
  update office.runs set status = 'cancelled', error_code = 'cancelled_by_user' where id = p_run;
  update office.steps set status = 'cancelled', locked_by = null, locked_until = null
    where run_id = p_run and status in ('ready','running','awaiting_agent');
  perform office.log_event(r.workspace_id, p_run, null, 'user', (select auth.uid()), null, 'run.cancelled', null, '{}');
end $$;
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
  if a.state not in ('claimed','expired') then
    return jsonb_build_object('accepted', false, 'reason', 'attempt_' || a.state);
  end if;
  select * into s from office.steps where id = a.step_id for update;

  if not office.file_refs_valid(s.run_id,p_result) then return jsonb_build_object('accepted',false,'reason','unknown_file_ref');end if;

  if a.lease_expires_at < now() then v_reason := 'lease_expired';
  elsif office.program_ready(s.run_id) is not true then v_reason := 'program_not_ready';
  elsif s.status <> 'awaiting_agent' then v_reason := 'task_no_longer_waiting';
  elsif office.run_input_hashes(s.run_id) <> a.input_hashes then v_reason := 'inputs_changed';
  end if;

  if v_reason is not null then
    update office.execution_attempts set state = 'rejected', rejection_reason = v_reason, result = p_result, submitted_at = now()
    where id = a.id;
    perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.saved_as_proposal', 'idle',
      jsonb_build_object('attempt_id', a.id, 'reason', v_reason, 'executor', e.kind));
    return jsonb_build_object('accepted', false, 'reason', v_reason, 'saved_as_proposal', true);
  end if;

  update office.execution_attempts set state = 'submitted', result = p_result, submitted_at = now() where id = a.id;
  update office.steps set status = 'ready', next_attempt_at = now(), agent_response = jsonb_build_object(
      'schemaName', s.agent_request->>'schemaName', 'output', p_result, 'submitted_at', now(),
      'attempt_id', a.id, 'executor', e.kind)
  where id = s.id;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'step.agent_submitted',
    office.activity_for_role(s.agent_role), jsonb_build_object('step', s.step_key, 'attempt_id', a.id, 'executor', e.kind, 'executor_name', e.name));
  return jsonb_build_object('accepted', true, 'next', 'AI Office перевірить відповідь за схемою протягом ~1 хв');
end $$;
revoke all on function office.program_brief_valid(jsonb,jsonb),office.program_plan_valid(uuid,jsonb),office.set_program_engine(uuid,boolean),
 office.start_program(uuid,numeric,int),office.program_child_done(uuid),office.program_ready(uuid),office.program_refresh(),
 office.approve_program_gate(uuid,text,text),office.cancel_program(uuid) from public,anon,authenticated,service_role,office_app;
grant execute on function office.set_program_engine(uuid,boolean),office.start_program(uuid,numeric,int),office.approve_program_gate(uuid,text,text),office.cancel_program(uuid) to authenticated;
grant execute on function office.program_ready(uuid) to office_app;
commit;
