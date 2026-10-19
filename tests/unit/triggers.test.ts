import {describe,it,expect,vi} from 'vitest';
import type {Sql} from '@/lib/db-core';
import {dispatchTriggers,triggerCredentials} from '@/lib/orchestrator/triggers';
const job={id:'00000000-0000-4000-8000-000000000070',step_id:'00000000-0000-4000-8000-000000000071',channel_ref:'agtch_sandbox',secret_ref:'OFFICE_AGENT_TEST',dispatch_token:'00000000-0000-4000-8000-000000000072',idempotency_key:'same-key'};
const env={OFFICE_TRIGGER_DISPATCH_ENABLED:'true',OFFICE_TRIGGER_WORKSPACES:'sandbox',OFFICE_AGENT_TEST:'test-workspace-access'};
function database(allowed=true){let reserved=false;const sql=vi.fn(async(parts:TemplateStringsArray,...values:unknown[])=>{
 const query=parts.join('?');if(query.includes('trigger_poll_jobs'))return[{jobs:[]}];
 if(query.includes('trigger_next')){const result=reserved?null:job;reserved=true;return[{job:result}];}
 if(query.includes('trigger_can_send'))return[{allowed}];return[];
 });return{sql:sql as unknown as Sql,spy:sql};}
describe('optional trigger dispatcher',()=>{
 it('does no database or network work unless explicitly enabled',async()=>{
  const {sql,spy}=database();const http=vi.fn();const r=await dispatchTriggers(sql,{env:{},fetch:http});expect(r.disabled).toBe(true);expect(spy).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
 });
 it('sends only task ID with a stable idempotency key; credits work only through MCP',async()=>{
  const {sql,spy}=database();const http=vi.fn(async()=>Response.json({agent_trigger_run_id:'apirun_test',conversation_url:'https://chatgpt.com/c/example'},{status:202}));
  const r=await dispatchTriggers(sql,{env,fetch:http as typeof fetch});expect(r.accepted).toBe(1);
  const [url,opts]=http.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://api.chatgpt.com/v1/workspace_agents/agtch_sandbox/trigger');
  expect(JSON.parse(String(opts.body))).toEqual({conversation_key:`step-${job.step_id}`,input:expect.stringContaining(job.step_id)});
  expect(opts.headers).toMatchObject({'Idempotency-Key':'same-key','OpenAI-Beta':'workspace_agent_runs=v1'});
  expect(String(opts.body)).not.toContain(env.OFFICE_AGENT_TEST);
  const finish=spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'));expect(finish?.slice(1)).toContain('apirun_test');
 });
 it('checks the kill switch immediately before HTTP and marks the unsent event skipped',async()=>{
  const {sql,spy}=database(false);const http=vi.fn();await dispatchTriggers(sql,{env,fetch:http});expect(http).not.toHaveBeenCalled();
  expect(spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'))?.slice(1)).toContain('disabled_before_dispatch');
 });
 it('rejects missing, platform or arbitrary environment credentials before HTTP',()=>{
  expect(()=>triggerCredentials(job,{})).toThrow('credential_missing');
  expect(()=>triggerCredentials(job,{OFFICE_AGENT_TEST:'sk-test-not-a-workspace-token'})).toThrow('wrong_credential_type');
  expect(()=>triggerCredentials({...job,secret_ref:'DATABASE_URL'},env)).toThrow('invalid_channel');
  expect(()=>triggerCredentials({...job,channel_ref:'../other'},env)).toThrow('invalid_channel');
 });
 it('records authentication failure for channel pausing without leaking token or response body',async()=>{
  const {sql,spy}=database();const http=vi.fn(async()=>new Response('provider-private-details',{status:401}));
  const r=await dispatchTriggers(sql,{env,fetch:http as typeof fetch});expect(r.failed).toBe(1);
  const finish=spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'));expect(finish?.slice(1)).toContain('http_401');
  expect(JSON.stringify(finish)).not.toContain('provider-private-details');expect(JSON.stringify(r)).not.toContain(env.OFFICE_AGENT_TEST);
 });
 it('keeps cron disabled until its separate acceptance gate is enabled',async()=>{
  const {sql,spy}=database();const http=vi.fn();expect((await dispatchTriggers(sql,{env,fetch:http,cron:true})).disabled).toBe(true);expect(spy).not.toHaveBeenCalled();
 });
 it('honors the emergency environment kill switch and workspace allowlist',async()=>{
  const {sql,spy}=database();const http=vi.fn();await dispatchTriggers(sql,{env:{...env,TRIGGERS_DISABLED:'1'},fetch:http});
  await dispatchTriggers(sql,{env,fetch:http,workspace:'foreign-office'});expect(spy).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
 });
 it.each([409,429,500])('records HTTP %i for deterministic SQL retry or fallback',async status=>{
  const {sql,spy}=database();const http=vi.fn(async()=>new Response(null,{status}));
  await dispatchTriggers(sql,{env,fetch:http as typeof fetch});const finish=spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'));
  expect(finish?.slice(1)).toContain(status);expect(finish?.slice(1)).toContain(`http_${status}`);
 });
 it('records network timeout without exposing provider errors',async()=>{
  const {sql,spy}=database();const http=vi.fn(async()=>{throw new Error('private timeout payload');});await dispatchTriggers(sql,{env,fetch:http as typeof fetch});
  const finish=spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'));expect(finish?.slice(1)).toContain('network_error');expect(JSON.stringify(finish)).not.toContain('private timeout');
 });
 it('does not retry an accepted 202 just because its JSON body is malformed',async()=>{
  const {sql,spy}=database();const http=vi.fn(async()=>new Response('invalid',{status:202}));const r=await dispatchTriggers(sql,{env,fetch:http as typeof fetch});
  expect(r.accepted).toBe(1);expect(r.failed).toBe(0);expect(spy.mock.calls.find(([p])=>p.join('').includes('trigger_finish'))?.slice(1)).toContain('accepted_without_run_id');
 });
});
