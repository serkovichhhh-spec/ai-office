"use server";
import { safeNext } from "@/lib/mcp/oauth";
import { catalogForWorkspace } from "@/lib/orchestrator/registry";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asUser, db } from "@/lib/db";
import { requireUser, supabaseServer } from "@/lib/supabase";
import { providerFromEnv } from "@/lib/ai";
import { tick } from "@/lib/orchestrator/worker";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

const BriefInput = z.object({
  workspace_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  idempotency_key: z.string().min(8).max(200),
  title: z.string().trim().min(3, "Назва — щонайменше 3 символи").max(200),
  objective: z.string().trim().min(10, "Опишіть мету хоча б одним реченням").max(4000),
  audience: z.string().trim().max(2000),
  channel: z.string().trim().max(200),
  deliverable_count: z.coerce.number().int().min(1).max(100),
  deadline: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  priority: z.enum(["low", "medium", "high"]),
});

/** Creates a brief and starts its run in one step. Re-submitting the same form is idempotent. */
export async function submitBriefAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = BriefInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте поля брифу" };
  const v = parsed.data;
  const [workspace] = await asUser(db(),user.id,tx => tx`select slug from office.workspaces where id=${v.workspace_id}`);
  if (!workspace || workspace.slug !== v.slug) return {error:"Workspace не знайдено"};
  const catalog = catalogForWorkspace(String(workspace.slug));
  const pb = catalog.find((p) => p.key === String(form.get("playbook_key") ?? "") && p.version === Number(form.get("playbook_version") ?? 0))
    ?? catalog.find((p) => p.key === String(form.get("playbook_key") ?? ""));
  if (pb?.key === "program" && !v.deadline) return {error:"Для плану CMO вкажіть дедлайн, щоб розподілити роботу в часі"};
  if (!pb) return { error: "Невідомий тип задачі" };
  if (v.deliverable_count > pb.maxCount) return { error: `Для цього типу задачі — не більше ${pb.maxCount} результатів` };
  const fields: Record<string, string | number | string[]> = {};
  for (const f of pb.fields) {
    const name = `f_${f.key}`;
    if (f.type === "knowledge_multi" || f.type === "knowledge") {
      // Missing knowledge never blocks the form: the team returns precise questions instead.
      const ids = form.getAll(name).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 30);
      if (ids.length) fields[f.key] = f.type === "knowledge" ? ids[0] : ids;
      continue;
    }
    const raw = String(form.get(name) ?? "").trim().slice(0, f.type === "list" ? 4000 : f.maxLength ?? 2000);
    if (f.required && !raw) return { error: `Заповніть поле «${f.label}»` };
    if (!raw) continue;
    if (f.type === "select" && !f.options?.some((o) => o.value === raw)) return { error: `Невірне значення: ${f.label}` };
    if (f.type === "number") {
      const num = Number(raw);
      if (!Number.isFinite(num) || (f.min !== undefined && num < f.min) || (f.max !== undefined && num > f.max)) return { error: `Невірне число: ${f.label}` };
      fields[f.key] = num;
    } else if (f.type === "datetime") fields[f.key] = `${raw} (Europe/Kyiv)`;
    else fields[f.key] = f.type === "list" ? lines(raw) : raw;
  }
  let runId: string;
  try {
    runId = await asUser(db(), user.id, async (tx) => {
      // Same idempotency key → the brief from the first attempt is reused.
      const existing = await tx<{ id: string }[]>`select id from office.runs where idempotency_key = ${v.idempotency_key}`;
      if (existing[0]) return existing[0].id;
      const [{ id: briefId }] = await tx<{ id: string }[]>`select office.create_brief(${v.workspace_id}, ${tx.json({
        title: v.title,
        objective: v.objective,
        audience: v.audience,
        channel: v.channel,
        deliverable_count: v.deliverable_count,
        deadline: v.deadline,
        priority: v.priority,
        acceptance_criteria: lines(form.get("acceptance_criteria")),
        references: lines(form.get("references")),
        playbook_key: pb.key,
        playbook_version: pb.version,
        fields,
      })}) as id`;
      const [{ id }] = await tx<{ id: string }[]>`select office.submit_brief(${briefId}, ${v.idempotency_key}) as id`;
      return id;
    });
  } catch (e) {
    return { error: friendly(e) };
  }
  kickWorker();
  redirect(`/w/${v.slug}/runs/${runId}`);
}

export async function decideAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const artifactId = z.string().uuid().parse(form.get("artifact_id"));
  const decision = z.enum(["approved", "rejected", "revision_requested", "concept_approved"]).parse(form.get("decision"));
  const rationale = String(form.get("rationale") ?? "").slice(0, 4000);
  try {
    await asUser(db(), user.id, (tx) => decision === "concept_approved"
      ? tx`select office.approve_concept(${artifactId},${rationale})`
      : tx`select office.decide(${artifactId}, ${decision}, ${rationale})`);
  } catch (e) {
    return { error: friendly(e) };
  }
  if (decision === "revision_requested") kickWorker();
  revalidatePath("/w", "layout");
  return { ok: true };
}

export async function cancelRunAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const runId = z.string().uuid().parse(form.get("run_id"));
  await asUser(db(), user.id, (tx) => tx`select office.cancel_run(${runId})`);
  revalidatePath("/w", "layout");
}

const KnowledgeInput = z.object({
  workspace_id: z.string().uuid(),
  kind: z.enum(["brand", "fact", "audience", "offer", "decision", "other"]),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(20000),
  status: z.enum(["draft", "approved"]),
  source_url: z.string().trim().url().or(z.literal("")),
});

export async function addKnowledgeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = KnowledgeInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте поля" };
  const v = parsed.data;
  try {
    await asUser(db(), user.id, (tx) => tx`
      insert into office.knowledge_docs (workspace_id, kind, title, body, status, source_url, created_by)
      values (${v.workspace_id}, ${v.kind}, ${v.title}, ${v.body}, ${v.status}, ${v.source_url || null}, ${user.id})`);
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath("/w", "layout");
  return { ok: true };
}

export async function setKnowledgeStatusAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("id"));
  const status = z.enum(["draft", "approved", "archived"]).parse(form.get("status"));
  await asUser(db(), user.id, (tx) => tx`update office.knowledge_docs set status = ${status}, updated_at = now() where id = ${id}`);
  revalidatePath("/w", "layout");
}

export async function signInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Введіть email і пароль" };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Невірний email або пароль" };
  redirect(safeNext(form.get("next")));
}

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Run the worker right after the response is sent, so a new brief starts without waiting for cron. */
function kickWorker() {
  after(async () => {
    try {
      await tick(db(), providerFromEnv(), { workerId: `kick-${randomUUID().slice(0, 8)}`, timeBudgetMs: 50_000, maxSteps: 10 });
    } catch (e) {
      console.error("worker kick failed", e);
    }
  });
}

function friendly(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/not allowed|permission denied/i.test(msg)) return "Недостатньо прав для цієї дії";
  if (/active run/.test(msg)) return "Для цього брифу вже йде запуск";
  if (/not waiting for approval/.test(msg)) return "Запуск уже не чекає на рішення — оновіть сторінку";
  if (/not the latest version/.test(msg)) return "Є новіша версія — оновіть сторінку";
  if (/needs a comment/.test(msg)) return "Напишіть, що саме доопрацювати";
  if (/not active/.test(msg)) return "Workspace призупинений";
  console.error(e);
  return "Не вдалося виконати дію. Спробуйте ще раз.";
}


/** Owner disconnects ChatGPT / Claude: all its tokens stop working immediately. */
export async function revokeExecutorAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("executor_id") ?? "");
  await asUser(db(), user.id, (tx) => tx`select office.revoke_executor(${id}::uuid)`);
  revalidatePath("/w", "layout");
}

/** Owner attests capabilities with evidence; this endpoint is not offered through MCP. */
export async function configureExecutorAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const seats = String(form.get("seats") ?? "").split(",").map(s=>s.trim()).filter(Boolean);
  const capabilities = JSON.parse(String(form.get("capabilities") ?? "{}"));
  await asUser(db(),user.id,tx => tx`select office.configure_executor(
    ${String(form.get("executor_id"))}::uuid, ${String(form.get("label"))},
    ${seats}::text[], ${tx.json(capabilities)}, ${String(form.get("mode"))})`);
  revalidatePath("/w", "layout");
}

/** Phone fallback: bounded direct upload, with owner authorization checked before Storage. */
export async function uploadRunFileAction(_previous:ActionState,form:FormData):Promise<ActionState>{
  const user=await requireUser();
  const id=z.string().uuid().parse(form.get("run_id"));
  const purpose=String(form.get("purpose")??"").trim().slice(0,500);
  const file=form.get("file");
  if(!(file instanceof File)||!purpose)return {error:"Оберіть файл і вкажіть його призначення"};
  if(file.size>4*1024*1024)return {error:"З телефона можна завантажити до 4 МБ. Більший файл передайте з чату."};
  try{
    const [run]=await asUser(db(),user.id,tx=>tx`select r.id,r.workspace_id,w.slug from office.runs r join office.workspaces w on w.id=r.workspace_id
      where r.id=${id}::uuid and office.has_role(r.workspace_id,array['owner'])`);
    if(!run)return {error:"Недостатньо прав"};
    const {filesEnabledForWorkspace}=await import("@/lib/orchestrator/rollout");
    if(!filesEnabledForWorkspace(String(run.slug)))return {error:"Передачу файлів для цього офісу ще не ввімкнено"};
    const {inspectFile,safeFileName}=await import("@/lib/mcp/files");
    const {fileStore}=await import("@/lib/mcp/file-store");
    const bytes=new Uint8Array(await file.arrayBuffer());const meta=inspectFile(bytes);
    await fileStore().put(`${run.workspace_id}/${run.id}/${meta.sha256}.${meta.extension}`,bytes,meta.mime_type);
    await asUser(db(),user.id,tx=>tx`select office.owner_attach_file(${id}::uuid,${tx.json({...meta,original_name:safeFileName(file.name),purpose})})`);
    revalidatePath("/w","layout");return {ok:true};
  }catch(e){
    const code=(e as {code?:string}).code;
    if(code==='unsupported_type')return {error:"Потрібен справжній PNG, JPEG, WebP або PDF"};
    if(code==='files_not_configured')return {error:"Сховище файлів ще не налаштовано"};
    return {error:friendly(e)};
  }
}

export async function setAutomationAction(form:FormData):Promise<void>{
 const user=await requireUser();const ws=z.string().uuid().parse(form.get("workspace_id"));
 await asUser(db(),user.id,tx=>tx`select office.set_automation(${ws}::uuid,${form.get("enabled")==="true"})`);
 revalidatePath("/w","layout");
}
/** Owner-only manual sandbox invocation; cron has a separate default-off gate. */
export async function dispatchAgentAction(form:FormData):Promise<void>{
 const user=await requireUser();const id=z.string().uuid().parse(form.get("workspace_id"));
 const [ws]=await asUser(db(),user.id,tx=>tx`select slug from office.workspaces where id=${id}::uuid and office.has_role(id,array['owner'])`);
 if(!ws)throw new Error("Недостатньо прав");
 const {dispatchTriggers}=await import("@/lib/orchestrator/triggers");
 await dispatchTriggers(db(),{workspace:String(ws.slug),maxDispatch:1,timeBudgetMs:15_000});
 revalidatePath("/w","layout");
}
export async function configureTriggerChannelAction(form:FormData):Promise<void>{
 const user=await requireUser();const f=(key:string)=>String(form.get(key)??"");
 const ws=z.string().uuid().parse(f("workspace_id"));const executor=z.string().uuid().parse(f("executor_id"));
 const limits={max_runs_per_day:Number(f("max_runs_per_day")),max_concurrent:Number(f("max_concurrent")),max_credits_per_month:Number(f("max_credits_per_month")),est_credits_per_run:Number(f("est_credits_per_run")),price_evidence:f("price_evidence").slice(0,1000)};
 const seats=f("seats").split(",").map(s=>s.trim()).filter(Boolean);
 await asUser(db(),user.id,tx=>tx`select office.configure_trigger_channel(${ws}::uuid,${executor}::uuid,${f("channel_ref")},${f("secret_ref")},${seats}::text[],${tx.json(limits)},${form.get("enabled")==="on"})`);
 revalidatePath("/w","layout");
}
export async function pauseTriggerChannelAction(form:FormData):Promise<void>{
 const user=await requireUser();const id=z.string().uuid().parse(form.get("channel_id"));
 await asUser(db(),user.id,tx=>tx`select office.pause_trigger_channel(${id}::uuid)`);revalidatePath("/w","layout");
}

export async function startProgramAction(_previous:ActionState,form:FormData):Promise<ActionState>{
 const user=await requireUser();
 try{
  const artifact=z.string().uuid().parse(form.get("plan_artifact_id"));const budget=z.coerce.number().finite().positive().parse(form.get("budget_usd"));
  const cap=z.coerce.number().int().min(1).max(50).parse(form.get("max_triggers"));
  const [a]=await asUser(db(),user.id,tx=>tx`select a.content,a.step_id,w.slug from office.artifacts a join office.workspaces w on w.id=a.workspace_id
   where a.id=${artifact}::uuid and a.kind='work_plan' and office.has_role(w.id,array['owner'])`);
  if(!a)return {error:"План не знайдено або недостатньо прав"};
  const {programEngineEnabledForWorkspace}=await import("@/lib/orchestrator/rollout");
  if(!programEngineEnabledForWorkspace(String(a.slug)))return {error:"Запуск програм для цього офісу ще не ввімкнено"};
  const {WorkPlanSchema,workPlanErrors}=await import("@/lib/orchestrator/work-plan");
  const {PLAYBOOKS}=await import("@/lib/orchestrator/registry");
  const {_provider,...raw}=a.content as Record<string,unknown>;void _provider;
  const plan=WorkPlanSchema.parse(raw);
  if(!a.step_id)return {error:"План не має підтвердженого походження з робочого кроку"};
  const [{ctx}]=await db()`select office.worker_context(${a.step_id}::uuid) as ctx`;
  const context=ctx as import("@/lib/orchestrator/types").StepContext;
  const {evidenceErrors}=await import("@/lib/orchestrator/marketing-brief");
  const errors=[...workPlanErrors(plan,PLAYBOOKS,new Set(context.knowledge.flatMap(k=>k.id?[k.id]:[]))),...evidenceErrors(plan,context)];
  if(errors.length)return {error:errors.slice(0,3).join("; ")};
  await asUser(db(),user.id,tx=>tx`select office.start_program(${artifact}::uuid,${budget},${cap})`);
  revalidatePath("/w","layout");kickWorker();return {ok:true};
 }catch(e){return {error:friendly(e)};}
}
export async function approveProgramGateAction(form:FormData):Promise<void>{
 const user=await requireUser();const id=z.string().uuid().parse(form.get("program_id"));
 const after=z.string().regex(/^ws[0-9]+$/).parse(form.get("after"));const note=String(form.get("note")??"").slice(0,4000);
 await asUser(db(),user.id,tx=>tx`select office.approve_program_gate(${id}::uuid,${after},${note})`);revalidatePath("/w","layout");kickWorker();
}
export async function cancelProgramAction(form:FormData):Promise<void>{
 const user=await requireUser();const id=z.string().uuid().parse(form.get("program_id"));
 await asUser(db(),user.id,tx=>tx`select office.cancel_program(${id}::uuid)`);revalidatePath("/w","layout");
}
export async function setProgramEngineAction(form:FormData):Promise<void>{
 const user=await requireUser();const ws=z.string().uuid().parse(form.get("workspace_id"));
 await asUser(db(),user.id,tx=>tx`select office.set_program_engine(${ws}::uuid,${form.get("enabled")==="true"})`);revalidatePath("/w","layout");
}

export async function createSandboxAction(form:FormData):Promise<void>{
 const user=await requireUser();const ws=z.string().uuid().parse(form.get("workspace_id"));
 await asUser(db(),user.id,tx=>tx`select office.create_sandbox(${ws}::uuid)`);revalidatePath("/w","layout");redirect("/w/sandbox");
}

export async function startFileSpikeAction(form:FormData):Promise<void>{
 const user=await requireUser();const ws=z.string().uuid().parse(form.get("workspace_id"));
 const {filesEnabledForWorkspace}=await import("@/lib/orchestrator/rollout");
 if(!filesEnabledForWorkspace("sandbox"))throw new Error("files disabled");
 const run=await asUser(db(),user.id,async tx=>{
  const [w]=await tx`select id from office.workspaces where id=${ws}::uuid and slug='sandbox' and office.has_role(id,array['owner'])`;
  if(!w)throw new Error("not allowed");
  const [{id:b}]=await tx`select office.create_brief(${ws}::uuid,${tx.json({title:"Тест передачі PNG/PDF",objective:"Перевірити F1/F2 файлової передачі у sandbox, без виробничого запуску",playbook_key:"file_spike",playbook_version:1,deliverable_count:1})}) as id`;
  const [{id:r}]=await tx`select office.submit_brief(${b}::uuid,${"file-spike:"+randomUUID()}) as id`;return String(r);
 });kickWorker();redirect(`/w/sandbox/runs/${run}`);
}
