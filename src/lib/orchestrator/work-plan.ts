import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020.js';
import briefSchemas from './library/brief-schemas.json';
import planningBriefs from './planning-brief-schemas.json';
export const PROGRAM_BRIEF_CONTRACTS={...briefSchemas.$defs,...planningBriefs};
import {BriefDiagnosisSchema} from './intelligence-contracts';
const text=z.string().trim().min(1).max(2000);
export const WorkPlanSchema=z.strictObject({
 diagnosis:BriefDiagnosisSchema,depth:z.enum(['light','standard','deep']),
 workstreams:z.array(z.strictObject({id:z.string().regex(/^ws[0-9]+$/),playbook:z.string().regex(/^[a-z_]+@[1-9][0-9]*$/),purpose:text,
   inputs:z.record(z.string(),z.unknown()),depends_on:z.array(z.string().regex(/^ws[0-9]+$/)).max(5)})).min(1).max(6),
 owner_gates:z.array(z.strictObject({after:z.string().regex(/^ws[0-9]+$/),question:text})).max(12),
 success_criteria:z.array(text).min(1).max(20),open_questions:z.array(text).max(20),
});
export type WorkPlan=z.infer<typeof WorkPlanSchema>;
const ajv=new Ajv2020({allErrors:true,strict:false,validateFormats:true});
const validDate=(v:string)=>z.iso.date().safeParse(v).success||z.iso.datetime({offset:true,local:true}).safeParse(v).success;
ajv.addFormat('date',validDate);ajv.addFormat('date-time',validDate);
const validators=new Map(Object.entries(PROGRAM_BRIEF_CONTRACTS).map(([key,schema])=>[key,ajv.compile(schema)]));
export function workPlanErrors(plan:WorkPlan,registry:Record<string,{key:string;version:number;catalog?:{hidden?:boolean}}>,knowledgeIds?:ReadonlySet<string>):string[]{
 const errors:string[]=[];
 const max={light:2,standard:4,deep:6}[plan.depth];
 if(plan.workstreams.length>max) errors.push(`depth=${plan.depth} allows at most ${max} workstreams`);
 const ids=new Set(plan.workstreams.map(w=>w.id));
 if(ids.size!==plan.workstreams.length) errors.push('duplicate workstream ID');
 const visiting=new Set<string>(),visited=new Set<string>();
 const visit=(id:string)=>{
  if(visiting.has(id)){errors.push('dependency cycle');return;}
  if(visited.has(id))return;
  visiting.add(id);
  for(const dep of plan.workstreams.find(w=>w.id===id)?.depends_on??[])if(ids.has(dep))visit(dep);
  visiting.delete(id);visited.add(id);
 };
 for(const w of plan.workstreams){
  const p=registry[w.playbook];
  if(!p)errors.push(`${w.id}: playbook is not registered`);
  else if(!p.catalog || p.catalog.hidden)errors.push(`${w.id}: legacy playbook is not eligible for a new program`);
  const key=w.playbook.split('@')[0];
  if(key==='program')errors.push('program recursion is forbidden');
  const validate=validators.get(key);
  if(!validate)errors.push(`${w.id}: playbook has no supported brief contract`);
  else if(!validate(w.inputs))errors.push(`${w.id}: invalid inputs ${ajv.errorsText(validate.errors)}`);
  if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(w.inputs.deadline??''))||!Number.isFinite(Date.parse(String(w.inputs.deadline))))errors.push(`${w.id}: a concrete valid deadline is required`);
  if(Number(w.inputs.deliverable_count)>10)errors.push(`${w.id}: current run supports at most 10 deliverables`);
  if(knowledgeIds)for(const [key,value] of Object.entries(w.inputs))if(/_knowledge_ids?$/.test(key)){
   for(const id of Array.isArray(value)?value:[value])if(!knowledgeIds.has(String(id)))errors.push(`${w.id}: unknown approved knowledge ${String(id)}`);
  }
  for(const dep of w.depends_on)if(!ids.has(dep)||dep===w.id)errors.push(`${w.id}: invalid dependency ${dep}`);
  if(new Set(w.depends_on).size!==w.depends_on.length)errors.push(`${w.id}: duplicate dependency`);
  visit(w.id);
 }
 for(const gate of plan.owner_gates)if(!ids.has(gate.after))errors.push('owner gate targets an unknown workstream');
 return [...new Set(errors)];
}
