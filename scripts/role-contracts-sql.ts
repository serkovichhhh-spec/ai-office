/** Emit scoped, idempotent DML for an operator to inspect/apply. Never connects itself. */
import { ROLE_CONTRACTS, ROLE_CONTRACT_VERSION, roleInstructions } from "../src/lib/orchestrator/role-contracts";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9_-]{1,100}$/.test(slug)) throw new Error("Usage: npx tsx scripts/role-contracts-sql.ts <workspace-slug>");
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const production = new Set(["designer", "graphic_designer", "print_designer", "video_editor"]);
const values = Object.entries(ROLE_CONTRACTS).map(([key, r], i) => {
  const tier = ["orchestrator", "strategist", "research_analyst", "reviewer", "creative_director"].includes(key) ? "strong" : "balanced";
  return `(${[key, r.title, tier, roleInstructions(key), production.has(key) ? "production" : "marketing", "chatgpt"].map(quote).join(", ")}, ${10 + i * 10})`;
}).join(",\n");

process.stdout.write(`with previous as materialized (
 select a.* from office.agents a join office.workspaces w on w.id=a.workspace_id where w.slug=${quote(slug)}
), configured as (
 insert into office.agents (workspace_id,role_key,display_name,model_tier,system_prompt,provenance,department,default_executor,sort_order)
 select w.id,v.role_key,v.display_name,v.tier,v.prompt,${quote("role-contracts:" + ROLE_CONTRACT_VERSION)},v.department,v.executor,v.sort_order
 from office.workspaces w cross join (values\n${values}\n) v(role_key,display_name,tier,prompt,department,executor,sort_order)
 where w.slug=${quote(slug)}
 on conflict (workspace_id,role_key) do update set
 system_prompt=excluded.system_prompt, model_tier=excluded.model_tier, provenance=excluded.provenance, updated_at=now()
 where office.agents.provenance in ('placeholder','production-local',${quote("role-contracts:" + ROLE_CONTRACT_VERSION)})
 returning role_key,provenance
), logged as (
 insert into office.events (workspace_id,actor_type,agent_role,kind,activity,payload)
 select w.id,'system','orchestrator','agents.contracts_updated','planning',jsonb_build_object('version',${quote(ROLE_CONTRACT_VERSION)},'roles',(select jsonb_agg(role_key) from configured))
 from office.workspaces w where w.slug=${quote(slug)} and exists (select 1 from configured) returning id
)
select jsonb_build_object('workspace',${quote(slug)},'configured',(select jsonb_agg(to_jsonb(c)) from configured c),
 'preserved_custom',(select jsonb_agg(role_key) from previous where provenance not in ('placeholder','production-local',${quote("role-contracts:" + ROLE_CONTRACT_VERSION)})),
 'previous',(select jsonb_agg(to_jsonb(p)) from previous p),'event_id',(select id from logged)) as result;
`);
