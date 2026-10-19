import {z} from 'zod';
import type {Playbook} from './registry';
import {codeStep} from './util';
export const FileSpikeSchema=z.strictObject({status:z.enum(['ready','blocked']),file_ref:z.string().regex(/^aio_file_[a-f0-9-]{36}$/).nullable(),observations:z.array(z.string().min(1).max(1000)).min(1).max(10)})
 .superRefine((v,c)=>{if(v.status==='ready'&&!v.file_ref)c.addIssue({code:'custom',message:'ready requires an attached file_ref'});});
export const fileSpike:Playbook={
 key:'file_spike',version:1,title:'Тест передачі файла',roles:['orchestrator','graphic_designer'],
 stepTitles:{attach_test:'Передача файла'},schemas:{FileSpike:FileSpikeSchema},
 async execute(ctx,ai){
  if(ctx.workspace.slug!=='sandbox')throw new Error('file spike is isolated to sandbox');
  if(ctx.step.step_key==='intake')return codeStep({output:{sandbox_test:true},next:[{step_key:'attach_test',agent_role:'graphic_designer',executor:'chatgpt'}],activity:'planning',message:'Тест файлового каналу, без виробничої передачі'});
  if(ctx.step.step_key==='attach_test'){
   const r=await ai.generate({schemaName:'FileSpike',schema:FileSpikeSchema,tier:'balanced',system:'Перевір файловий канал AI Office у sandbox. Не вигадуй file_ref або успішних перевірок.',
    user:'Для F1 прикріпи надане власником PNG через office_attach_file з поточними task_id, attempt_id і lease_token. Для F2, якщо доступна генерація зображення в цій сесії, згенеруй просте тестове PNG і прикріпи його так само. Якщо інструмент чи файл недоступний, поверни blocked з точним обмеженням. У result вкажи лише реальний file_ref, повернений office_attach_file, і фактично виконані спостереження.',
    stub:()=>({status:'blocked' as const,file_ref:null,observations:['Шаблон не перевіряє передачу справжнього файла']})});
   return {output:r.output,provider:r.provider,model:r.model,usage:r.usage,artifacts:[{kind:'file_test',title:'Результат файлового тесту',content:r.output}],next_steps:[{step_key:'package',agent_role:'orchestrator'}],run_status:null,activity:'delivering',message:'Файловий тест здано для перевірки власником'};
  }
  if(ctx.step.step_key==='package')return codeStep({output:{sandbox_test:true},artifacts:[{kind:'deliverable',title:'Файловий sandbox-тест',content:{schema_version:'Package.v1',outcome:'blocked',review:null,unsupported_claims:[],sources_used:[],blocking_questions:['Це тест каналу. Виробничу готовність і F1-F7 підтверджують окремо.'],sections:[{kind:'file_test',label:'Файловий тест',version:1,content:ctx.artifacts.filter(a=>a.kind==='file_test').at(-1)?.content??{}}]}}],runStatus:'needs_approval',activity:'waiting_approval',message:'Результат тесту збережено; production не запускається'});
  throw new Error('unknown file spike step');
 }
};
