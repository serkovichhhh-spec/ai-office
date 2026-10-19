import {describe,it,expect} from 'vitest';
import {BriefDiagnosisSchema,ChallengeReportSchema,KnowledgeCandidatesSchema,KnowledgeCandidateSchema} from '@/lib/orchestrator/intelligence-contracts';
import {SKILL_PACKAGES,V1_SKILL_PINS,skillsForStep} from '@/lib/orchestrator/skills';
import {catalogForWorkspace} from '@/lib/orchestrator/registry';
import {SessionProvider,AgentNeededError} from '@/lib/ai/session';
const source={url:'https://example.org/product',title:'Product',accessed_at:'2026-10-19'};
const candidate={kind:'fact',title:'Bounded fact',claim:'A specific bounded statement',confidence:'verified',sources:[source],valid_until:null,why_it_matters:'Changes the decision',owner_question:''};
const test={pass:true,note:'A concrete reason tied to this concept'};
const challenge={reviewed_artifact_id:'build-1',reviewed_version:1,concepts:[{concept_id:'C1',tests:{swap:test,three_second:test,banality:test,proof:test,talkability:test},verdict:'strong',one_line_reason:'Distinct and clear',needs_fact:[]}],stronger_alternative:null,recommendation:'proceed'};
describe('intelligence contracts and pinned skills',()=>{
 it('accepts three sourced candidates; prevents verified without proof and assumption without a question',()=>{
  expect(KnowledgeCandidatesSchema.safeParse({status:'ready',summary:'Decision-ready evidence',candidates:[candidate,{...candidate,title:'Second'},{...candidate,title:'Third'}],blocking_questions:[]}).success).toBe(true);
  expect(KnowledgeCandidateSchema.safeParse({...candidate,sources:[]}).success).toBe(false);
  expect(KnowledgeCandidateSchema.safeParse({...candidate,confidence:'assumption',sources:[]}).success).toBe(false);
  expect(KnowledgeCandidateSchema.safeParse({...candidate,confidence:'assumption',sources:[],owner_question:'Which addresses meet this condition?'}).success).toBe(true);
  expect(KnowledgeCandidateSchema.safeParse({...candidate,sources:[{...source,url:'http://example.org'}]}).success).toBe(false);
 });
 it('requires a real alternative for weak ideas and closes nested schemas',()=>{
  expect(ChallengeReportSchema.safeParse(challenge).success).toBe(true);
  expect(ChallengeReportSchema.safeParse({...challenge,concepts:[{...challenge.concepts[0],verdict:'weak'}]}).success).toBe(false);
  expect(ChallengeReportSchema.safeParse({...challenge,stronger_alternative:{headline:42,idea:{},why_stronger:''}}).success).toBe(false);
  expect(ChallengeReportSchema.safeParse({...challenge,concepts:[{...challenge.concepts[0],tests:{...challenge.concepts[0].tests,invented:test}}]}).success).toBe(false);
 });
 it('limits owner questions and rejects a false reference shape',()=>{
  const d={real_task:'Obtain relevant enquiries',audience_tension:'Unclear availability',what_we_know:[],what_we_dont_know:[],questions_to_owner:['Which placement?'],recommended_depth:'light'};
  expect(BriefDiagnosisSchema.safeParse(d).success).toBe(true);
  expect(BriefDiagnosisSchema.safeParse({...d,questions_to_owner:Array(6).fill('Question')}).success).toBe(false);
  expect(BriefDiagnosisSchema.safeParse({...d,what_we_know:[{statement:'Fact',refs:[{url:source.url}]}]}).success).toBe(false);
 });
 it('ships three versioned packages with checklists, anchored rubrics and examples',()=>{
  expect(Object.keys(V1_SKILL_PINS)).toHaveLength(3);
  for(const p of Object.values(SKILL_PACKAGES)) {
   expect(p.sha256).toMatch(/^[a-f0-9]{64}$/);
   for(const name of ['SKILL.md','references/checklist.md','references/rubric.json','references/examples.md']) expect(p.text).toContain(name);
  }
 });
 it('keeps new workflows out of production catalogue by default',()=>{
  const old=process.env.OFFICE_PLAN_V1_WORKSPACES;delete process.env.OFFICE_PLAN_V1_WORKSPACES;
  try{expect(catalogForWorkspace('pavutyna').some(p=>p.key==='research_brief')).toBe(false);expect(catalogForWorkspace('sandbox').some(p=>p.key==='research_brief')).toBe(true);}finally{if(old===undefined)delete process.env.OFFICE_PLAN_V1_WORKSPACES;else process.env.OFFICE_PLAN_V1_WORKSPACES=old;}
 });
 it('carries exact skill text into the session request, not only a role label',async()=>{
  const p=SKILL_PACKAGES['creative-challenge@1'];
  try{await new SessionProvider(null).generate({schemaName:'ChallengeReport',schema:ChallengeReportSchema,system:'Review',user:'Task',tier:'strong',skills:[p],stub:()=>ChallengeReportSchema.parse(challenge)});throw new Error('should park');}
  catch(e){expect(e).toBeInstanceOf(AgentNeededError);expect((e as AgentNeededError).request.skills?.[0].sha256).toBe(p.sha256);}
 });
});
