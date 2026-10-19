/** Full session/MCP pipeline on isolated embedded PostgreSQL. Models, HTTPS bytes and Storage are fixtures.
 * This checks the real orchestration, contracts, RLS, leases and audit, not real provider capabilities.
 */
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {embeddedSql} from '../tests/embedded-db';
import {asUser} from '../src/lib/db-core';
import {SessionProvider} from '../src/lib/ai/session';
import {tick} from '../src/lib/orchestrator/worker';
import {playbookFor} from '../src/lib/orchestrator/registry';
import {handleMcpBody,hashToken,type McpContext} from '../src/lib/mcp/server';
import {blockedBriefStub} from '../src/lib/orchestrator/marketing-brief';
import type {StepContext} from '../src/lib/orchestrator/types';
import type {GenerateRequest} from '../src/lib/ai/types';
const database=new PGlite();const su=embeddedSql(database),app=embeddedSql(database,'office_app');
const OWNER='11111111-1111-4111-8111-111111111111';let passed=0,rpcId=0;
function check(name:string,condition:unknown){if(!condition)throw new Error('FAIL '+name);console.log('PASS '+name);passed++;}
type Obj=Record<string,any>;
async function rpc(ctx:McpContext,name:string,args:Obj={}){
 const response=await handleMcpBody(ctx,{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}}) as Obj;
 if(response.error)throw new Error(JSON.stringify(response.error));return response.result as Obj;
}
const answerFixture=(context:StepContext,request:GenerateRequest<unknown>,conditional=false)=>{
 const source=context.knowledge.find(k=>k.title==='Research candidate 1')??context.knowledge[0];
 const ref={record_id:source.id!,version:source.version!,pointer:'/body'};
 let output:any=request.schemaName==='WorkPlan'?{}:request.stub();
 if(request.schemaName==='BriefDiagnosis')output={real_task:context.brief.objective,audience_tension:'Availability uncertainty in a synthetic test',what_we_know:[{statement:'Synthetic approved product input',refs:[ref]}],what_we_dont_know:[],questions_to_owner:[],recommended_depth:'light'};
 if(request.schemaName==='MarketingBrief'){
  const b=blockedBriefStub({prepare:'creative_director',build:'print_designer',review:'reviewer'});
  output={...b,status:'ready',summary:'Synthetic complete context for a local campaign',business_goal:'Collect enquiries from the defined area',
   topics:b.topics.map(t=>({...t,status:'verified',summary:'Synthetic approved product passport covers this topic',refs:[ref],limitations:[]})),
   strategic_choice:{target_segment:'Residents of the defined buildings',need_and_barrier:'Need a connection but do not know address availability',value_proposition:'The documented local product offer',reason_to_believe:'Approved product passport',main_message:'Check availability at your address',cta_and_customer_path:'Open the documented address check and send an enquiry',rationale:'The message matches the declared test objective'},
   assignments:b.assignments.map(a=>({...a,task:'Develop the material from the approved product passport',deliverable:'A complete material for this step contract',acceptance_criteria:['Use sourced facts and the specified medium']})),gaps:[],blocking_questions:[]};
 }
 const repair=(value:any):void=>{if(Array.isArray(value)){value.forEach(repair);return;}if(!value||typeof value!=='object')return;
  if('record_id'in value&&'version'in value&&'pointer'in value)Object.assign(value,ref);
  if('output_pointer'in value)value.output_pointer='/summary';Object.values(value).forEach(repair);};
 if(!['BriefDiagnosis','MarketingBrief'].includes(request.schemaName))repair(output);
 if(request.schemaName==='ChallengeReport'&&conditional){output.recommendation='rethink';output.concepts[0].needs_fact=['Synthetic autonomy claim has not been verified'];}
 if(request.schemaName==='KnowledgeCandidates')output={status:'ready',summary:'Synthetic research fixtures, not external research',candidates:[1,2,3].map(i=>({kind:'fact',title:`Research candidate ${i}`,claim:`Synthetic bounded research fact ${i}`,confidence:'verified',sources:[{url:`https://example.org/source-${i}`,title:`Fixture source ${i}`,accessed_at:'2026-10-19'}],valid_until:null,why_it_matters:'Input to the next brief',owner_question:''})),blocking_questions:[]};
 if(request.schemaName==='WorkPlan')output={diagnosis:{real_task:context.brief.objective,audience_tension:'Synthetic audience need',what_we_know:[{statement:'Approved context',refs:[ref]}],what_we_dont_know:[],questions_to_owner:[],recommended_depth:'light'},depth:'light',workstreams:[{id:'ws1',playbook:'owned_media_copy@2',purpose:'Prepare address communication',inputs:{title:'Address message',objective:'Explain the address availability check',audience:'Local residents',channel:'email',deliverable_count:1,deadline:'2026-10-30',acceptance_criteria:['Approved product facts only'],references:[],copy_kind:'email',message_knowledge_ids:[source.id],delivery_spec_knowledge_id:source.id},depends_on:[]}],owner_gates:[],success_criteria:['One complete source-backed message'],open_questions:[]};
 return request.schema.parse(output);
};
async function main(){
 for(const p of ['tests/sql/00_supabase_shim.sql',...(await readdir('supabase/migrations')).filter(p=>p.endsWith('.sql')).sort().map(p=>'supabase/migrations/'+p)])await su.unsafe(await readFile(p,'utf8'));
 await su`insert into auth.users(id,email) values(${OWNER},'owner@example.test')`;
 const [{id:sourceWs}]=await su`select id from office.workspaces where slug='pavutyna'`;
 await su`insert into office.workspace_members(workspace_id,user_id,role) values(${sourceWs},${OWNER},'owner')`;
 const [{id:ws}]=await asUser(app,OWNER,tx=>tx`select office.create_sandbox(${sourceWs}::uuid) as id`);
 const [{n}]=await su`select count(*)::int n from office.agents where workspace_id=${ws}`;check('sandbox automatically provisions all 16 professional roles',n===16);
 const [{n:copied}]=await su`select count(*)::int n from office.knowledge_docs where workspace_id=${ws}`;check('sandbox starts without copied business knowledge',copied===0);
 await su`insert into office.knowledge_docs(workspace_id,kind,title,body,status) values(${ws},'fact','Synthetic product passport','Synthetic test fixture covering product, terms, area, audience, brand and measurement. Not business evidence.','approved')`;
 const token=async(name:string,kind:string)=>{const [{t}]=await su`select office.create_executor('sandbox',${kind},${name}) as t`;return{sql:app,tokenHash:hashToken(String(t))} satisfies McpContext;};
 const cmo=await token('CMO fixture','chatgpt'),creative=await token('Creative fixture','chatgpt'),fact=await token('Fact gate fixture','claude_session');
 for(const [ctx,label,seats,caps] of [[cmo,'test_cmo',['orchestrator','research_analyst','reviewer'],{web_research:{verified_at:'2026-01-01',evidence:'isolated fixture'}}],[creative,'test_creative',['creative_director','print_designer','graphic_designer'],{}],[fact,'test_fact',['reviewer'],{}]] as const){
  const [{who}]=await app`select office.gateway_whoami(${ctx.tokenHash}) as who`;
  await asUser(app,OWNER,tx=>tx`select office.configure_executor(${(who as Obj).executor_id}::uuid,${label},${[...seats]}::text[],${tx.json(caps)},'interactive')`);
 }
 const newRun=async(key:string,version:number)=>asUser(app,OWNER,async tx=>{
  const [{b}]=await tx`select office.create_brief(${ws}::uuid,${tx.json({title:'Synthetic '+key,objective:'Exercise the real runtime using synthetic model fixtures',audience:'Fixture audience',channel:'OOH',deliverable_count:1,deadline:'2026-10-30',playbook_key:key,playbook_version:version,fields:{medium:'billboard'}})}) as b`;
  const [{r}]=await tx`select office.submit_brief(${b}::uuid,${'fixture:'+key+':'+crypto.randomUUID()}) as r`;return String(r);
 });
 const drive=async(run:string,conditional=false)=>{
  const trail:string[]=[];
  for(let guard=0;guard<14;guard++){
   await tick(app,new SessionProvider(null),{workerId:'intelligence-e2e',maxSteps:20});
   const [state]=await su`select status,error_message from office.runs where id=${run}`;
   if(state.status==='needs_approval')return trail;
   if(state.status==='failed')throw new Error(String(state.error_message));
   const [s]=await su`select id,step_key from office.steps where run_id=${run} and status='awaiting_agent'`;
   if(!s)throw new Error('expected an awaiting step');trail.push(String(s.step_key));
   const who=['diagnosis','marketing_brief','challenge','research','work_plan'].includes(String(s.step_key))?cmo:s.step_key==='review'?fact:creative;
   if(s.step_key==='review'){
    const denied=await rpc(creative,'office_claim_task',{task_id:s.id});check('actual creative author cannot claim factual review',denied.isError&&denied.structuredContent.error==='forbidden');
   }
   const claim=await rpc(who,'office_claim_task',{task_id:s.id});const data=claim.structuredContent;
   check(`${s.step_key}: concrete executor claims the expected step`,data.claimed===true);
   if(['diagnosis','marketing_brief','challenge'].includes(String(s.step_key)))check(`${s.step_key}: envelope carries pinned procedure, rubric and hash`,data.envelope.skills?.[0]?.sha256?.length===64&&data.envelope.skills[0].text.includes('references/rubric.json'));
   const [{ctx}]=await su`select office.worker_context(${s.id}) as ctx`;const context=ctx as StepContext;
   let answer:unknown;
   await playbookFor(context.run.playbook_key,context.run.playbook_version).execute(context,{name:'session',async generate(req){answer=answerFixture(context,req,conditional);return{output:answer as never,provider:'session',model:'synthetic-fixture',usage:{tokens_in:0,tokens_out:0,cost_usd:0}};}});
   const result=await rpc(who,'office_submit_result',{task_id:s.id,attempt_id:data.attempt_id,lease_token:data.lease_token,result:answer});
   check(`${s.step_key}: MCP accepts structurally valid fixture`,result.structuredContent.accepted===true);
  }
  throw new Error('fixture graph did not terminate');
 };
 const outdoor=await newRun('outdoor_print_pack',2);const trail=await drive(outdoor,true);
 check('CMO diagnosis and brief precede authors and independent gates',trail.join('>')==='diagnosis>marketing_brief>prepare>build>review>challenge');
 const [pkg]=await su`select id,content from office.artifacts where run_id=${outdoor} and kind='deliverable'`;
 check('rethink reaches owner with conditional release status',(pkg.content as Obj).outcome==='conditional');
 let blocked=false;try{await asUser(app,OWNER,tx=>tx`select office.decide(${pkg.id},'approved','release')`);}catch{blocked=true;}check('conditional cannot be approved for production through owner RPC',blocked);
 await asUser(app,OWNER,tx=>tx`select office.approve_concept(${pkg.id},'Concept only')`);
 const [{status}]=await su`select status from office.runs where id=${outdoor}`;check('concept approval preserves needs_approval',status==='needs_approval');
 const research=await newRun('research_brief',1);await drive(research);
 const candidates=await su`select id,status from office.knowledge_docs where origin_run_id=${research}`;check('research materializes three drafts with provenance',candidates.length===3&&candidates.every(c=>c.status==='draft'));
 await asUser(app,OWNER,tx=>tx`update office.knowledge_docs set status='approved' where origin_run_id=${research}`);
 const followup=await newRun('research_brief',1);await drive(followup);
 const [diagnosis]=await su`select content from office.artifacts where run_id=${followup} and kind='diagnosis'`;
 check('next run cites the owner-approved research record and exact version',candidates.some(c=>c.id===(diagnosis.content as Obj).what_we_know[0].refs[0].record_id));
 const shadow=await newRun('program',1);await drive(shadow);
 const [{n:before}]=await su`select count(*)::int n from office.runs where program_id is not null`;check('shadow plan creates no child runs',before===0);
 const [plan]=await su`select id from office.artifacts where run_id=${shadow} and kind='work_plan'`;
 await asUser(app,OWNER,tx=>tx`select office.set_program_engine(${ws}::uuid,true)`);
 const [{id:program}]=await asUser(app,OWNER,tx=>tx`select office.start_program(${plan.id},1,3) as id`);
 const [{n:children}]=await su`select count(*)::int n from office.runs where program_id=${program}`;check('owner approval creates one bounded program child',children===1);
 await asUser(app,OWNER,tx=>tx`select office.cancel_program(${program}::uuid)`);
 const [{cancelled}]=await su`select bool_and(status='cancelled') cancelled from office.runs where program_id=${program}`;check('program cancellation stops every child',cancelled===true);
 // Actual MCP file tools, with only the external byte transport and private Storage replaced.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=','base64');
 const objects=new Map<string,Uint8Array>();
 const files:McpContext={...creative,filesEnabled:true,downloadDeps:{resolve:async()=>[{address:'93.184.216.34',family:4}],request:async()=>({status:200,body:(async function*(){yield png;})()})},fileStore:{put:async(path,bytes)=>{objects.set(path,bytes);},get:async path=>objects.get(path)!,signedUrl:async path=>'https://storage.example/'+path}};
 const spike=await newRun('file_spike',1);await tick(app,new SessionProvider(null),{workerId:'file-e2e',maxSteps:20});
 const [step]=await su`select id from office.steps where run_id=${spike} and status='awaiting_agent'`;
 const lease=(await rpc(files,'office_claim_task',{task_id:step.id})).structuredContent;
 const args={task_id:step.id,attempt_id:lease.attempt_id,lease_token:lease.lease_token,purpose:'Synthetic PNG reference',file:{download_url:'https://files.example/image',file_id:'file_fixture',mime_type:'text/html',file_name:'../../fixture.png'}};
 const uploaded=(await rpc(files,'office_attach_file',args)).structuredContent;
 check('MCP saves real bytes by signature with hash and dimensions',uploaded.mime_type==='image/png'&&uploaded.sha256===createHash('sha256').update(png).digest('hex')&&uploaded.width===1&&uploaded.height===1);
 check('duplicate upload returns the same file_ref',(await rpc(files,'office_attach_file',args)).structuredContent.deduplicated===true);
 const fetched=await rpc(files,'office_get_file',{file_ref:uploaded.file_ref,task_id:step.id});
 check('authorized read returns image-content plus a ten-minute URL',fetched.content.some((c:Obj)=>c.type==='image'&&c.data===png.toString('base64'))&&fetched.structuredContent.expires_in===600);
 const invalid=await rpc(files,'office_submit_result',{task_id:step.id,attempt_id:lease.attempt_id,lease_token:lease.lease_token,result:{status:'ready',file_ref:'aio_file_00000000-0000-4000-8000-000000000999',observations:['Synthetic unknown reference']}});
 check('unknown file reference is rejected without consuming lease',invalid.structuredContent.reason==='unknown_file_ref');
 const valid=await rpc(files,'office_submit_result',{task_id:step.id,attempt_id:lease.attempt_id,lease_token:lease.lease_token,result:{status:'ready',file_ref:uploaded.file_ref,observations:['Transport and hash checked on fixture bytes']}});
 check('same lease can submit the valid attached file',valid.structuredContent.accepted===true);
 await tick(app,new SessionProvider(null),{workerId:'file-e2e',maxSteps:20});
 const me=(await rpc(files,'office_get_team_status')).structuredContent;
 check('only observed file_attach capability is attested, not image generation',Boolean(me.you.capabilities.file_attach?.verified_at)&&!me.you.capabilities.image_generation);
 console.log(`Intelligence/MCP E2E: ${passed} passed; synthetic providers only`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}).finally(()=>database.close());
