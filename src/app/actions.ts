"use server";
import { safeNext } from "@/lib/mcp/oauth";
import { PLAYBOOK_CATALOG } from "@/lib/orchestrator/registry";

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
  const pb = PLAYBOOK_CATALOG.find((p) => p.key === String(form.get("playbook_key") ?? "") && p.version === Number(form.get("playbook_version") ?? 0))
    ?? PLAYBOOK_CATALOG.find((p) => p.key === String(form.get("playbook_key") ?? ""));
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
  const decision = z.enum(["approved", "rejected", "revision_requested"]).parse(form.get("decision"));
  const rationale = String(form.get("rationale") ?? "").slice(0, 4000);
  try {
    await asUser(db(), user.id, (tx) => tx`select office.decide(${artifactId}, ${decision}, ${rationale})`);
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
  data_class: z.enum(["public", "internal", "confidential", "personal"]).default("internal"),
});

export async function addKnowledgeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = KnowledgeInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте поля" };
  const v = parsed.data;
  try {
    await asUser(db(), user.id, (tx) => tx`
      insert into office.knowledge_docs (workspace_id, kind, title, body, status, source_url, data_class, created_by)
      values (${v.workspace_id}, ${v.kind}, ${v.title}, ${v.body}, ${v.status}, ${v.source_url || null}, ${v.data_class}, ${user.id})`);
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

/** Owner/editor sets who may receive a knowledge record (enforced per provider policy). */
export async function setKnowledgeClassAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("id"));
  const dataClass = z.enum(["public", "internal", "confidential", "personal"]).parse(form.get("data_class"));
  await asUser(db(), user.id, (tx) => tx`update office.knowledge_docs set data_class = ${dataClass}, updated_at = now() where id = ${id}`);
  revalidatePath("/w", "layout");
}

export async function reviewKnowledgeCandidateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z.object({
    id: z.string().uuid(), decision: z.enum(["approved", "rejected"]),
    review_hash: z.string().regex(/^[a-f0-9]{32}$/),
    valid_until: z.iso.date().or(z.literal("")).default(""), note: z.string().trim().max(2000).default(""),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Перевірте дату та рішення" };
  const v = parsed.data;
  if (v.decision === "approved" && !v.valid_until) return { error: "Вкажіть, до якої дати актуальне знання" };
  if (v.decision === "rejected" && !v.note) return { error: "Вкажіть причину відхилення" };
  try {
    await asUser(db(), user.id, (tx) => tx`select office.review_knowledge_candidate(${v.id}::uuid,${v.decision},${v.valid_until || null}::date,${v.note},${v.review_hash})`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return { error: "Рішення щодо знань може прийняти лише власник" };
    if (code === "55000") return { error: "Запис змінився або вже розглянутий — оновіть сторінку перед рішенням" };
    if (code === "23514") return { error: "Для схвалення потрібні підтверджені джерела та актуальний строк дії" };
    if (code === "42883") return { error: "Перевірка досліджень ще не ввімкнена" };
    return { error: "Не вдалося зберегти рішення. Спробуйте ще раз." };
  }
  revalidatePath("/w", "layout");
  return { ok: true };
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


/** Owner grants seats to an executor explicitly; a new executor has none. */
export async function setExecutorSeatsAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("executor_id"));
  const seats = form.getAll("seats").map(String).filter((s) => /^[a-z_]{2,40}$/.test(s));
  await asUser(db(), user.id, (tx) => tx`select office.set_executor_seats(${id}::uuid, ${seats}::text[])`);
  revalidatePath("/w", "layout");
}

/** Owner disconnects ChatGPT / Claude: all its tokens stop working immediately. */
export async function revokeExecutorAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("executor_id") ?? "");
  await asUser(db(), user.id, (tx) => tx`select office.revoke_executor(${id}::uuid)`);
  revalidatePath("/w", "layout");
}
