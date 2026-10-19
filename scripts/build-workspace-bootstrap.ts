/** Compile the approved role contracts into a CLI-created migration, never connect to a database. */
import {existsSync,writeFileSync} from 'node:fs';
import {ROLE_CONTRACTS,ROLE_CONTRACT_VERSION,roleInstructions} from '../src/lib/orchestrator/role-contracts';
const path=process.argv[2];
if(!path||!/^supabase\/migrations\/\d+_office_workspace_bootstrap\.sql$/.test(path)||!existsSync(path))throw new Error('Pass the existing CLI-created workspace bootstrap migration');
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const production=new Set(['designer','graphic_designer','print_designer','video_editor']);
const values=Object.entries(ROLE_CONTRACTS).map(([key,r],i)=>{
 const tier=['orchestrator','strategist','research_analyst','reviewer','creative_director'].includes(key)?'strong':'balanced';
 const executor=['reviewer','print_designer'].includes(key)?'claude_session':'chatgpt';
 return `(p_workspace,${[key,r.title,tier,roleInstructions(key),'role-contracts:'+ROLE_CONTRACT_VERSION,production.has(key)?'production':'marketing',executor].map(quote).join(',')},${10+i*10})`;
}).join(',\n');
writeFileSync(path,`-- Bootstrap only newly created workspaces. Existing custom agents and business data remain untouched.
begin;
create or replace function office.seed_default_agents(p_workspace uuid) returns void
language sql security definer set search_path='' as $$
 insert into office.agents(workspace_id,role_key,display_name,model_tier,system_prompt,provenance,department,default_executor,sort_order)
 values ${values}
 on conflict(workspace_id,role_key) do nothing
$$;
create function office.bootstrap_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform office.seed_default_agents(new.id);
 insert into office.automation_settings(workspace_id) values(new.id) on conflict do nothing;
 return new;
end $$;
create trigger bootstrap_workspace after insert on office.workspaces for each row execute function office.bootstrap_workspace();
create function office.create_sandbox(p_source uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if not office.has_role(p_source,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 select id into v from office.workspaces where slug='sandbox';
 if v is not null then
  if office.has_role(v,array['owner']) then return v;end if;
  raise exception 'sandbox belongs to another owner' using errcode='42501';
 end if;
 insert into office.workspaces(slug,name) values('sandbox','AI Office Sandbox') on conflict(slug) do nothing returning id into v;
 if v is null then
  select id into v from office.workspaces where slug='sandbox';
  if office.has_role(v,array['owner']) then return v;end if;
  raise exception 'sandbox belongs to another owner' using errcode='42501';
 end if;
 insert into office.workspace_members(workspace_id,user_id,role) values(v,auth.uid(),'owner');
 perform office.log_event(v,null,null,'user',auth.uid(),null,'workspace.sandbox_created','idle',jsonb_build_object('source_workspace',p_source));
 return v;
end $$;
revoke all on function office.seed_default_agents(uuid),office.bootstrap_workspace(),office.create_sandbox(uuid) from public,anon,authenticated,service_role,office_app;
grant execute on function office.create_sandbox(uuid) to authenticated;
commit;
`);
