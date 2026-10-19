import {describe,it,expect} from 'vitest';
import {WorkPlanSchema,workPlanErrors,type WorkPlan} from '@/lib/orchestrator/work-plan';
import {PLAYBOOKS} from '@/lib/orchestrator/registry';
const inputs={title:'Address information',objective:'Explain the address availability check',audience:'Local residents',channel:'email',deliverable_count:1,deadline:'2026-10-30',acceptance_criteria:['Use approved facts'],references:[],copy_kind:'email',message_knowledge_ids:['fact-1'],delivery_spec_knowledge_id:'spec-1'};
const stream=(id:string,depends_on:string[]=[])=>({id,playbook:'owned_media_copy@2',purpose:'Prepare channel-specific copy',inputs,depends_on});
const plan=():WorkPlan=>({diagnosis:{real_task:'Explain availability',audience_tension:'Unknown availability',what_we_know:[],what_we_dont_know:[],questions_to_owner:[],recommended_depth:'light'},depth:'light',workstreams:[stream('ws1'),stream('ws2',['ws1'])],owner_gates:[{after:'ws1',question:'Approve the message?'}],success_criteria:['Enquiries are attributed'],open_questions:[]});
describe('WorkPlan safety boundary',()=>{
 it('accepts a bounded registered DAG with full brief inputs',()=>{const p=WorkPlanSchema.parse(plan());expect(workPlanErrors(p,PLAYBOOKS)).toEqual([]);});
 it('rejects unregistered playbooks and recursive programs',()=>{const p=plan();p.workstreams[0].playbook='made_up@1';expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('not registered');p.workstreams[0].playbook='program@1';expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('recursion');});
 it('rejects duplicate IDs, self dependencies, cycles and missing parents',()=>{
  const p=plan();p.workstreams[0].depends_on=['ws2'];expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('cycle');
  p.workstreams[0].depends_on=['ws1'];expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('invalid dependency');
  p.workstreams[0].depends_on=['ws99'];expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('ws99');
  p.workstreams[1].id='ws1';expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('duplicate');
 });
 it('rejects missing inputs, unknown properties and malformed deadlines',()=>{
  const p=plan();p.workstreams[0].inputs={...inputs,unexpected:true,deadline:'tomorrow'};
  expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('invalid inputs');expect(workPlanErrors(p,PLAYBOOKS).join()).toContain('deadline');
  p.workstreams[0].inputs={title:'Insufficient'};expect(workPlanErrors(p,PLAYBOOKS).length).toBeGreaterThan(0);
 });
 it('enforces depth caps and owner gate targets',()=>{const p=plan();p.workstreams.push(stream('ws3'));p.owner_gates[0].after='ws99';const errors=workPlanErrors(p,PLAYBOOKS).join();expect(errors).toContain('at most 2');expect(errors).toContain('unknown workstream');});
});
