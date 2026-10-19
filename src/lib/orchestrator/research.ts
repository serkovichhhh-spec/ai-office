import type { Playbook } from './registry';
import { BriefDiagnosisSchema,KnowledgeCandidatesSchema } from './intelligence-contracts';
import { briefText,composeSystem,dataBlock,knowledgeText,feedbackParts } from './prompting';
import { codeStep,latestArtifact } from './util';
import { V1_SKILL_PINS } from './skills';
import { evidenceErrors } from './marketing-brief';
import type { AiProvider } from '../ai/types';
import type { StepContext,StepResult } from './types';
export async function diagnoseBrief(ctx:StepContext,ai:AiProvider,next='marketing_brief'):Promise<StepResult> {
  const schema=BriefDiagnosisSchema.superRefine((v,c)=>{for(const m of evidenceErrors(v,ctx)) c.addIssue({code:'custom',message:m});});
  const r=await ai.generate({schemaName:'BriefDiagnosis',schema,tier:'strong',
    system:composeSystem(ctx.agent?.system_prompt,'Ти - CMO. Спочатку діагностуй задачу та прогалини, не створюй концепції.','orchestrator'),
    user:[dataBlock('brief',briefText(ctx.brief)),dataBlock('knowledge',knowledgeText(ctx.knowledge)),
      dataBlock('feedback',feedbackParts(ctx.step.input).join('\n')),
      'Визнач реальну задачу, напругу аудиторії, відомі факти з record_id/version/pointer, невідоме й до п’яти питань власнику. Для локального білборда уточни площину; для теми відключень - автономність і живлення обладнання; для військової теми - позицію власника. Не вигадуй відповідей.'
    ].join('\n\n'),stub:()=>({real_task:ctx.brief.objective,audience_tension:'Потребує дослідження аудиторії',what_we_know:[],what_we_dont_know:['Не виконано діагностику живим виконавцем'],questions_to_owner:['Які дані підтверджують головну продуктову обіцянку?'],recommended_depth:'standard' as const})});
  const out=schema.parse(r.output);
  return {output:out,provider:r.provider,model:r.model,usage:r.usage,
    artifacts:[{kind:'diagnosis',title:'Діагноз брифу',content:{...out,_provider:r.provider}}],
    next_steps:[{step_key:next,agent_role:next==='research'?'research_analyst':'orchestrator',executor:'chatgpt',input:ctx.step.input,depends_on:['diagnosis'],...(next==='research'?{requires:['web_research']}: {})}],
    run_status:null,activity:'planning',message:'Сформовано діагноз і питання до власника'};
}
export const researchBrief:Playbook={
 key:'research_brief',version:1,title:'Дослідження брифу',roles:['orchestrator','research_analyst'],
 catalog:{key:'research_brief',version:1,title:'Дослідження брифу',label:'Дослідження брифу',description:'Діагноз, джерела та кандидати знань для затвердження власником',group:'Аналітика',priority:'P1',maxCount:12,fields:[]},
 stepTitles:{diagnosis:'Діагноз брифу',research:'Дослідження',candidates:'Кандидати знань'},
 schemas:{BriefDiagnosis:BriefDiagnosisSchema,KnowledgeCandidates:KnowledgeCandidatesSchema},
 async execute(ctx,ai){
  const k=ctx.step.step_key;
  if(k==='intake'||k==='revision_intake') return {...codeStep({output:{plan:['diagnosis','research','candidates','package']},next:[{step_key:'diagnosis',agent_role:'orchestrator',executor:'chatgpt',input:ctx.step.input}],activity:'planning',message:'Заплановано дослідження'}),skill_pins:V1_SKILL_PINS};
  if(k==='diagnosis') return diagnoseBrief(ctx,ai,'research');
  if(k==='research'){
   const r=await ai.generate({schemaName:'KnowledgeCandidates',schema:KnowledgeCandidatesSchema,tier:'strong',
    system:composeSystem(ctx.agent?.system_prompt,'Ти - дослідник. Знайди первинні джерела, не затверджуй власні висновки.','research_analyst'),
    user:[dataBlock('brief',briefText(ctx.brief)),dataBlock('knowledge',knowledgeText(ctx.knowledge)),dataBlock('artifact',JSON.stringify(latestArtifact(ctx,'diagnosis')?.content)),
      dataBlock('feedback',feedbackParts(ctx.step.input).join('\n')),'Збери щонайменше три різні корисні кандидати з HTTPS-джерелами та датою доступу. Якщо доказів немає, status=blocked з питаннями; не вигадуй джерел. Для припущення обов’язкове owner_question.'].join('\n\n'),
    stub:()=>({status:'blocked' as const,summary:'Шаблон не виконує досліджень',candidates:[],blocking_questions:['Потрібен дослідник із перевіреним доступом до пошуку']})});
   const out=KnowledgeCandidatesSchema.parse(r.output);
   return {output:out,provider:r.provider,model:r.model,usage:r.usage,artifacts:[{kind:'research',title:'Результати дослідження',content:{...out,_provider:r.provider}}],next_steps:[{step_key:'candidates',agent_role:'orchestrator',input:ctx.step.input}],run_status:null,activity:'researching',message:'Джерела зібрано для формування кандидатів'};
  }
  if(k==='candidates'){
   const r=latestArtifact<Record<string,unknown>>(ctx,'research');if(!r) throw new Error('research artifact missing');
   const {_provider,...data}=r.content;const out=KnowledgeCandidatesSchema.parse(data);
   return codeStep({output:{count:out.candidates.length},artifacts:[{kind:'knowledge_candidates',title:'Кандидати знань: лише чернетки',content:{...out,_provider}}],next:[{step_key:'package',agent_role:'orchestrator',input:ctx.step.input}],activity:'planning',message:'Підготовлено чернетки для рішення власника'});
  }
  if(k==='package'){
   const r=latestArtifact<Record<string,unknown>>(ctx,'knowledge_candidates');
   return codeStep({output:{candidates_ready:true},artifacts:[{kind:'deliverable',title:'Дослідження: '+ctx.brief.title,content:{schema_version:'Package.v1',outcome:'blocked',review:null,unsupported_claims:[],sources_used:[],blocking_questions:['Перегляньте й затвердіть потрібні записи у розділі знань; цей пакет не передається в продакшн.'],sections:[{kind:'diagnosis',label:'Діагноз',version:1,content:latestArtifact(ctx,'diagnosis')?.content},{kind:'knowledge_candidates',label:'Кандидати знань',version:r?.version??1,content:r?.content}]}}],runStatus:'needs_approval',activity:'waiting_approval',message:'Кандидати знань чекають рішення власника'});
  }
  throw new Error('unknown research step: '+k);
 }
};
