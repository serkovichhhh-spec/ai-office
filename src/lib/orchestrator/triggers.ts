import type {Sql} from '../db-core';
interface TriggerJob {id:string;step_id:string;channel_ref:string;secret_ref:string;dispatch_token:string;idempotency_key:string;provider_run_id?:string}
interface TriggerOptions {fetch?:typeof fetch;env?:Record<string,string|undefined>;timeBudgetMs?:number;workspace?:string;cron?:boolean;maxDispatch?:number}
const BASE='https://api.chatgpt.com/v1/workspace_agents';
const validChannel=(s:string)=>/^agtch_[A-Za-z0-9_]{1,150}$/.test(s);
const validRun=(s:string)=>/^apirun_[A-Za-z0-9_]{1,150}$/.test(s);
export function triggerCredentials(job:Pick<TriggerJob,'channel_ref'|'secret_ref'>,env:Record<string,string|undefined>):string{
 if(!validChannel(job.channel_ref)||!/^OFFICE_AGENT_[A-Z0-9_]+$/.test(job.secret_ref))throw new Error('invalid_channel');
 const secret=env[job.secret_ref];if(!secret)throw new Error('credential_missing');
 if(secret.startsWith('sk-'))throw new Error('wrong_credential_type');return secret;
}
/** No output is fetched from this API. Generated work must return through the leased MCP callback. */
export async function dispatchTriggers(sql:Sql,opts:TriggerOptions={}){
 const env=opts.env??process.env;
 const report={dispatched:0,accepted:0,failed:0,polled:0,disabled:env.OFFICE_TRIGGER_DISPATCH_ENABLED!=='true'||env.TRIGGERS_DISABLED==='1'||Boolean(opts.cron&&env.OFFICE_TRIGGER_CRON_ENABLED!=='true')};
 if(report.disabled)return report;
 const slugs=(env.OFFICE_TRIGGER_WORKSPACES??'sandbox').split(',').map(s=>s.trim()).filter(s=>/^[a-z0-9-]+$/.test(s)&&(!opts.workspace||s===opts.workspace));
 if(!slugs.length)return report;
 const http=opts.fetch??fetch;const deadline=Date.now()+(opts.timeBudgetMs??18_000);
 const timeout=()=>AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())));
 await sql`select office.trigger_watchdog(${slugs}::text[])`;
 const [{jobs}]=await sql`select office.trigger_poll_jobs(${slugs}::text[]) as jobs`;
 for(const job of jobs as TriggerJob[]){
  if(Date.now()>=deadline)break;
  try{
   const secret=triggerCredentials(job,env);
   if(!job.provider_run_id||!validRun(job.provider_run_id))continue;
   const res=await http(`${BASE}/${job.channel_ref}/runs/${job.provider_run_id}`,{headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:timeout()});
   const data=res.ok?await res.json() as {status?:string}:{};
   await sql`select office.trigger_observe(${job.id}::uuid,${data.status??''},${res.status})`;report.polled++;
  }catch{/* Status polling is best effort; the database watchdog guarantees a bounded fallback. */}
 }
 for(let n=0;n<Math.min(2,opts.maxDispatch??2) && Date.now()<deadline;n++){
  const [{job}]=await sql`select office.trigger_next(${slugs}::text[]) as job`;
  if(!job)break;const j=job as TriggerJob;
  let status=0,providerId:string|null=null,error:string|null=null;
  try{
   const secret=triggerCredentials(j,env);
   const [{allowed}]=await sql`select office.trigger_can_send(${j.id}::uuid,${j.dispatch_token}::uuid) as allowed`;
   if(!allowed||env.TRIGGERS_DISABLED==='1'||env.OFFICE_TRIGGER_DISPATCH_ENABLED!=='true')error='disabled_before_dispatch';
   else{
    report.dispatched++;
    const response=await http(`${BASE}/${j.channel_ref}/trigger`,{method:'POST',redirect:'error',signal:timeout(),
     headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':j.idempotency_key,'OpenAI-Beta':'workspace_agent_runs=v1'},
     body:JSON.stringify({input:`AI Office task ${j.step_id} is ready. Call office_get_task with task_id=${j.step_id}, then claim and submit through AI Office.`,conversation_key:`step-${j.step_id}`})});
    status=response.status;
    if(status===202){report.accepted++;try{const data=await response.json() as {agent_trigger_run_id?:string};providerId=data.agent_trigger_run_id??null;}catch{error='accepted_without_run_id';}}
    else{error=`http_${status}`;report.failed++;}
   }
  }catch(e){error=e instanceof Error&&['credential_missing','wrong_credential_type','invalid_channel'].includes(e.message)?e.message:'network_error';report.failed++;}
  await sql`select office.trigger_finish(${j.id}::uuid,${j.dispatch_token}::uuid,${status},${providerId},${error})`;
 }
 return report;
}
