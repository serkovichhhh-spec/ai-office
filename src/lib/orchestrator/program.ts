import {z} from 'zod';
import type {Playbook} from './registry';
import {PLAYBOOKS} from './registry';
import {WorkPlanSchema,workPlanErrors} from './work-plan';
import {BriefDiagnosisSchema} from './intelligence-contracts';
import {briefText,composeSystem,dataBlock,knowledgeText,feedbackParts} from './prompting';
import {codeStep,latestArtifact} from './util';
import {diagnoseBrief} from './research';
import {V1_SKILL_PINS} from './skills';
import briefSchemas from './library/brief-schemas.json';
export const program:Playbook={
 key:'program',version:1,title:'План робіт CMO (shadow)',roles:['orchestrator'],
 catalog:{key:'program',version:1,title:'План робіт CMO (shadow)',label:'План робіт CMO (shadow)',description:'Планує роботу за зареєстрованими процесами; сам нічого не запускає',priority:'P2',group:'Планування',maxCount:6,fields:[]},
 stepTitles:{diagnosis:'Діагноз',work_plan:'План робіт'},schemas:{WorkPlan:WorkPlanSchema,BriefDiagnosis:BriefDiagnosisSchema},
 async execute(ctx,ai){
  const k=ctx.step.step_key;
  if(k==='intake'||k==='revision_intake')return {...codeStep({output:{shadow_mode:true},next:[{step_key:'diagnosis',agent_role:'orchestrator',executor:'chatgpt',input:ctx.step.input}],activity:'planning',message:'Планування без автоматичного запуску робіт'}),skill_pins:V1_SKILL_PINS};
  if(k==='diagnosis')return diagnoseBrief(ctx,ai,'work_plan');
  if(k==='work_plan'){
   const schema=WorkPlanSchema.superRefine((v,c)=>{for(const m of workPlanErrors(v,PLAYBOOKS))c.addIssue({code:'custom',message:m});});
   const r=await ai.generate({schemaName:'WorkPlan',schema,jsonSchema:z.toJSONSchema(WorkPlanSchema,{target:'draft-7'}) as Record<string,unknown>,tier:'strong',
    system:composeSystem(ctx.agent?.system_prompt,'Ти - CMO. Склади скінченний план лише з відомих плейбуків. Цей крок не запускає виконавців.','orchestrator'),
    user:[dataBlock('brief',briefText(ctx.brief)),dataBlock('knowledge',knowledgeText(ctx.knowledge)),
     dataBlock('artifact',JSON.stringify(latestArtifact(ctx,'diagnosis')?.content)),dataBlock('feedback',feedbackParts(ctx.step.input).join('\n')),
     `Дозволені плейбуки і brief contracts:\n${JSON.stringify(Object.fromEntries(Object.values(PLAYBOOKS).filter(p=>p.catalog && p.key in briefSchemas.$defs).map(p=>[`${p.key}@${p.version}`,briefSchemas.$defs[p.key as keyof typeof briefSchemas.$defs]])))}`,
     'inputs містить повний плоский бриф дочірнього плейбука, включно з конкретним deadline. depends_on - DAG; light <=2, standard <=4, deep <=6. program@* заборонений. owner_gates явно вказують рішення власника. Якщо даних не вистачає, збережи open_questions; не вигадуй факти або ідентифікатори знань.'
    ].join('\n\n'),
    // Deliberately invalid placeholder: a stub must never impersonate a reviewed executable plan.
    stub:()=>{throw new Error('program requires a real CMO session; no executable stub plan');}});
   const out=schema.parse(r.output);
   return {output:{shadow_mode:true},provider:r.provider,model:r.model,usage:r.usage,artifacts:[{kind:'work_plan',title:'WorkPlan.v1',content:{...out,_provider:r.provider}}],next_steps:[{step_key:'package',agent_role:'orchestrator'}],run_status:null,activity:'planning',message:'План валідний; дочірні runs не створено'};
  }
  if(k==='package'){
   const plan=latestArtifact(ctx,'work_plan');if(!plan)throw new Error('work plan missing');
   return codeStep({output:{shadow_mode:true,children_started:0},artifacts:[{kind:'deliverable',title:'План робіт: '+ctx.brief.title,content:{schema_version:'Package.v1',outcome:'blocked',shadow_mode:true,review:null,unsupported_claims:[],sources_used:[],blocking_questions:['План збережено для оцінки власником. Автоматичний запуск вимкнений.'],sections:[{kind:'work_plan',label:'План робіт',version:plan.version,content:plan.content}]}}],runStatus:'needs_approval',activity:'waiting_approval',message:'Shadow-план чекає оцінки власника'});
  }
  throw new Error('unknown program step: '+k);
 }
};
