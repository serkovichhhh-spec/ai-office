import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { listKnowledge, runDetail, stepLabel, workspaceBySlug, type RunDetail } from "@/lib/queries";
import { LiveRefresh } from "../../../../components/LiveRefresh";
import { HANDOFF_STATUS, ROLE_LABEL, STEP_STATUS, ProviderBadge, StatusPill, StubBadge, clock, modelLabel, usd, when } from "../../../../components/ui";
import { EXECUTOR_LABEL } from "@/lib/queries";
import { cancelRunAction } from "../../../../actions";
import { DecisionPanel } from "./DecisionPanel";
import { DraftView, PackageView, ReviewDetails, type PackageV1 } from "./PackageView";
import { OwnerBanner, OwnerChecklist, type ChainStep } from "./OwnerPanel";
import { answerTemplate, excludedClaims, ownerChecklist, ownerState } from "@/lib/ui/package-view-model";
import { PLAYBOOKS } from "@/lib/orchestrator/registry";
import { ENUM_LABEL } from "@/lib/orchestrator/catalog";

export const dynamic = "force-dynamic";

interface Angle { title: string; insight: string; hook_idea: string; why_it_works: string; evidence: string[] }
interface Script {
  title: string; angle: string; duration_sec: number; hook: string; cta: string;
  scenes: { shot: string; on_screen_text: string; voiceover: string }[]; claims_needing_source: string[];
}

const EXEC: Record<string, string> = { claude_session: "Claude", chatgpt: "ChatGPT", grok: "Grok", human: "людині" };
const ROUTE_REASON: Record<string, string> = {
  provider_limit: "вичерпано ліміт сервісу",
  channel_paused: "канал запуску на паузі",
  data_policy: "політика даних",
  no_executor_for_seat: "ніхто не має цієї ролі",
  not_independent: "потрібен незалежний рецензент",
};
const EVENT_TEXT: Record<string, (e: RunDetail["events"][number]) => string> = {
  "run.created": () => "Бриф передано команді",
  "step.started": (e) => `${role(e.agent_role)} почав: ${stepLabel(String(e.payload.step))}${Number(e.payload.attempt) > 1 ? ` (спроба ${e.payload.attempt})` : ""}`,
  "step.succeeded": (e) => `${role(e.agent_role)}: ${String(e.payload.message ?? "готово")}`,
  "artifact.created": (e) => `Нова версія: ${kindLabel(String(e.payload.kind))} v${e.payload.version}`,
  "step.retry_scheduled": (e) => `${role(e.agent_role)}: збій, повторна спроба (${String(e.payload.error ?? "")})`,
  "step.lease_expired": (e) => `${role(e.agent_role)}: воркер не відповів, крок повернуто в чергу`,
  "step.knowledge_expired": (e) => `${role(e.agent_role)}: строк дії знання минув — задача повернута на підготовку без простроченого запису`,
  "step.dead_lettered": (e) => `${role(e.agent_role)}: спроби вичерпано — ${String(e.payload.error ?? e.payload.reason ?? "")}`,
  "run.needs_approval": () => "Пакет чекає на ваше рішення",
  "approval.recorded": (e) => `Рішення: ${DECISION[String(e.payload.decision)] ?? e.payload.decision} (v${e.payload.version})`,
  "handoff.queued": () => "Передано в чергу продакшну",
  "cmo_sync.done": () => "Задачу створено в CMO Space («Виконання»)",
  "cmo_import.created": (e) => `Задачу взято з CMO Space (${e.payload.cmo_task_id}), сценарій ${e.payload.playbook}`,
  "attempt.resumed": (e) => `${e.payload.executor_label} продовжив свою задачу з новою орендою`,
  "gateway.lease_fallback": (e) => `${e.payload.executor_label} здав результат без коректного ключа оренди — прийнято за власною орендою`,
  "route.fallback": (e) => `Крок «${e.payload.step}» передано ${EXEC[String(e.payload.to)] ?? e.payload.to} замість ${EXEC[String(e.payload.from)] ?? e.payload.from}: ${ROUTE_REASON[String(e.payload.reason)] ?? e.payload.reason}`,
  "route.restored": (e) => `Крок «${e.payload.step}» повернуто ${EXEC[String(e.payload.to)] ?? e.payload.to}`,
  "route.blocked": (e) => `Крок «${e.payload.step}» зупинено: немає перевіреного виконавця (${ROUTE_REASON[String(e.payload.reason)] ?? e.payload.reason})`,
  "route.unblocked": (e) => `Крок «${e.payload.step}» знову може виконуватись`,
  "trigger.accepted": (e) => `Автозапуск: ${e.payload.channel} прийняв задачу`,
  "trigger.completed": (e) => `Автозапуск: ${e.payload.channel} виконав задачу`,
  "trigger.failed": (e) => `Автозапуск не вдався (${e.payload.channel}: ${e.payload.code ?? "помилка"})`,
  "trigger.expired": (e) => `Автозапуск: ${e.payload.channel} не взяв задачу за 10 хв`,
  "owner.attention": () => "Потрібна ваша увага: автоматично розбудити виконавця не вийшло",
  "cmo_sync.failed": (e) => `Не вдалося передати в CMO Space: ${String(e.payload.error ?? "")} — QA-агент повідомить`,
  "run.cancelled": () => "Запуск скасовано",
  "run.budget_exceeded": () => "Зупинено: вичерпано бюджет",
  "run.max_steps": () => "Зупинено: забагато кроків",
  "step.awaiting_agent": (e) => `${role(e.agent_role)}: ${stepLabel(String(e.payload.step))} чекає на ${who(e.payload.executor)}${e.payload.note ? " (повтор: відповідь не пройшла перевірку)" : ""}`,
  "attempt.claimed": (e) => `${role(e.agent_role)}: ${String(e.payload.executor_label ?? e.payload.executor_name ?? who(e.payload.executor))} взяв у роботу — ${stepLabel(String(e.payload.step))}, оренда до ${clock(String(e.payload.lease_expires_at))}`,
  "attempt.saved_as_proposal": (e) => `${role(e.agent_role)}: результат від ${who(e.payload.executor)} збережено як пропозицію, не застосовано (${PROPOSAL[String(e.payload.reason)] ?? e.payload.reason})`,
  "step.agent_submitted": (e) => `${role(e.agent_role)}: ${String(e.payload.executor_label ?? e.payload.executor_name ?? who(e.payload.executor))} передав результат — ${stepLabel(String(e.payload.step))}`,
};
const PROPOSAL: Record<string, string> = { lease_expired: "оренда минула", task_no_longer_waiting: "задача вже неактуальна", inputs_changed: "вхідні дані змінилися", knowledge_expired: "знання прострочене", data_class_above_provider_policy: "рівень даних вищий за дозволений виконавцю" };
const who = (k: unknown) => EXECUTOR_LABEL[String(k ?? "claude_session")] ?? String(k);
const DECISION: Record<string, string> = { approved: "затверджено", rejected: "відхилено", revision_requested: "на доопрацювання" };
const KIND: Record<string, string> = { strategy: "стратегія", scripts: "сценарії", review: "рев'ю", deliverable: "пакет" };
const role = (r: string | null) => (r ? ROLE_LABEL[r] ?? r : "Система");
const kindLabel = (k: string) => KIND[k] ?? k;

function dotTone(kind: string) {
  if (kind.includes("dead") || kind.includes("budget") || kind.includes("failed") || kind === "run.cancelled") return "bad";
  if (kind === "step.started") return "active";
  if (kind.includes("succeeded") || kind.includes("artifact") || kind.includes("handoff") || kind.includes("approval")) return "ok";
  return "";
}

export default async function RunPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await requireUser();
  const [ws, d] = await Promise.all([workspaceBySlug(user.id, slug), runDetail(user.id, id)]);
  if (!ws || !d || d.run.workspace_id !== ws.id) notFound();

  const active = ["queued", "running"].includes(d.run.status);
  const awaitingAgent = d.steps.some((s) => s.status === "awaiting_agent");
  const awaitingExecutor = d.steps.find((s) => s.status === "awaiting_agent")?.executor ?? "claude_session";
  const deliverables = d.artifacts.filter((a) => a.kind === "deliverable");
  const latest = deliverables.at(-1) ?? null;
  const isStub = d.artifacts.some((a) => a.provider === "stub") || d.run.provider === "stub";
  const canDecide = d.run.status === "needs_approval" && (ws.role === "owner" || ws.role === "approver");
  const canCancel = ["queued", "running", "needs_input", "needs_approval"].includes(d.run.status) && ws.role !== "viewer";
  const draftScripts = !latest ? (d.artifacts.filter((a) => a.kind === "scripts").at(-1)?.content as { scripts?: Script[] } | undefined) : undefined;
  const pb = PLAYBOOKS[`${d.brief.playbook_key}@${d.run.playbook_version ?? 1}`];
  const spec = pb?.catalog;
  const kTitles = new Map((spec?.fields.some((f) => f.type.startsWith("knowledge")) ? await listKnowledge(user.id, ws.id) : []).map((k) => [k.id, k.title]));
  const showField = (v: unknown): string => (Array.isArray(v) ? v.map(showField).join(", ") : kTitles.get(String(v)) ?? ENUM_LABEL[String(v)] ?? String(v));
  const pkgV1 = latest && (latest.content as { schema_version?: string }).schema_version === "Package.v1" ? (latest.content as unknown as PackageV1) : null;
  const specDraft = !latest && pb?.stepTitles && d.brief.playbook_key !== "reels_concepts" || (!latest && (d.run.playbook_version ?? 1) > 1)
    ? Object.entries(pb?.stepTitles ?? {}).map(([key, title]) => ({ s: { key, title }, a: d.artifacts.filter((a) => a.kind === key).at(-1) })).filter((x) => x.a).at(-1)
    : undefined;
  const content = (pkgV1 ? null : latest?.content ?? null) as null | {
    strategy_summary: string; angles: Angle[]; scripts: Script[];
    review: { verdict: string; summary: string; open_issues: { script_index: number; severity: string; issue: string }[] } | null;
    unsupported_claims: string[]; sources_used: { title: string; url: string | null }[];
  };

  const checklist = pkgV1 ? ownerChecklist(pkgV1) : [];
  const excluded = pkgV1 ? excludedClaims(pkgV1) : [];
  const waiting = d.steps.find((s) => s.status === "awaiting_agent" || s.status === "running");
  const workingText = waiting
    ? waiting.status === "awaiting_agent"
      ? awaitingExecutor === "chatgpt"
        ? `«${stepLabel(waiting.step_key)}» чекає на ChatGPT. Відкрий ChatGPT з AI Office і напиши «візьми задачі AI Office».`
        : `«${stepLabel(waiting.step_key)}» чекає на Claude — він запуститься автоматично.`
      : `${role(waiting.agent_role)} працює: ${stepLabel(waiting.step_key)}.`
    : undefined;
  const state = ownerState(d.run.status, pkgV1?.outcome, checklist.length, workingText);
  const steps = new Map<string, ChainStep>();
  for (const s of d.steps) {
    const st: ChainStep["state"] = s.status === "succeeded" ? "done" : s.status === "running" || s.status === "awaiting_agent" ? "active" : s.status === "failed" ? "bad" : "wait";
    steps.set(s.step_key, { key: s.step_key, label: stepLabel(s.step_key), state: st });
  }
  const chain = [...steps.values(), { key: "_owner", label: "Твоє рішення", state: d.run.status === "needs_approval" ? "active" : ["approved", "handoff_queued"].includes(d.run.status) ? "done" : "wait" } as ChainStep];
  const decide = canDecide && latest
    ? { artifactId: latest.id, version: latest.version, canApprove: !pkgV1?.outcome || pkgV1.outcome === "ready_for_approval", template: checklist.length ? answerTemplate(checklist) : undefined }
    : null;

  return (
    <>
      <LiveRefresh active={active} intervalMs={2500} />
      <p className="small" style={{ marginBottom: 10 }}><a href={`/w/${ws.slug}`}>← Офіс</a></p>
      <div className="run-head">
        <div>
          <h1>{d.brief.title}</h1>
          <p className="small muted">{spec?.label ?? d.brief.playbook_key} · {when(d.run.created_at)}{latest ? ` · версія ${latest.version}` : ""}</p>
        </div>
        <div className="meta">
          {isStub && <StubBadge />}
          <StatusPill status={d.run.status} />
          {canCancel && (
            <form action={cancelRunAction}>
              <input type="hidden" name="run_id" value={d.run.id} />
              <button className="btn link">Скасувати</button>
            </form>
          )}
        </div>
      </div>

      <OwnerBanner state={state} chain={chain} />
      {isStub && <p className="notice" style={{ marginTop: 12 }}>Модель не підключена: тексти — шаблони для перевірки процесу.</p>}

      <div className="cols">
        <div>
          {decide && <div className="mobile-first-decision"><DecisionPanel {...decide} /></div>}
          <OwnerChecklist items={checklist} excluded={excluded} reviewSummary={pkgV1?.review?.summary} />

          <section className="panel" aria-labelledby="deliv-title">
            <div className="panel-head"><h2 id="deliv-title">{latest ? "Результат" : "Чернетка"}</h2></div>
            {pkgV1 && <PackageView pkg={pkgV1} />}
            {specDraft?.a && (
              <>
                <p className="muted small" style={{ marginBottom: 10 }}>Проміжний результат «{specDraft.s.title}», ще не пройшов рецензію.</p>
                <DraftView content={specDraft.a.content as Record<string, unknown>} />
              </>
            )}
            {!content && !pkgV1 && !specDraft && !draftScripts && <p className="empty">{active ? "Команда працює — результат зʼявиться тут." : "Результату немає."}</p>}
            {!content && draftScripts?.scripts && (
              <>
                <p className="muted small" style={{ marginBottom: 10 }}>Чернетка сценаріїв, ще не пройшла рецензію.</p>
                {draftScripts.scripts.map((s, i) => <ScriptCard key={i} s={s} i={i} />)}
              </>
            )}
            {content && (
              <>
                <p className="lead">{content.strategy_summary}</p>
                <h3 style={{ margin: "18px 0 10px" }}>Сценарії</h3>
                {content.scripts.map((s, i) => <ScriptCard key={i} s={s} i={i} />)}
                {content.unsupported_claims.length > 0 && (
                  <p className="notice" style={{ marginTop: 12 }}><b>Підтвердь перед публікацією:</b> {content.unsupported_claims.join("; ")}</p>
                )}
                <details className="quiet">
                  <summary>Стратегія й кути ({content.angles.length})</summary>
                  {content.angles.map((a, i) => (
                    <div className="angle" key={i}>
                      <b>{a.title}</b>
                      <p className="small">{a.insight}</p>
                      <p className="small muted">Хук: {a.hook_idea}. {a.why_it_works}</p>
                    </div>
                  ))}
                </details>
              </>
            )}
          </section>
        </div>

        <aside>
          {decide && <div className="desktop-decision"><DecisionPanel {...decide} /></div>}
          {d.handoff && (
            <section className="panel">
              <div className="panel-head"><h2>Передано</h2><span className="pill ok">{HANDOFF_STATUS[d.handoff.status]}</span></div>
              <p className="small muted">Задача в CMO Space → «Виконання».</p>
            </section>
          )}
          <section className="panel">
            <details className="quiet" open={!latest}>
              <summary>Бриф</summary>
              <p style={{ marginTop: 8 }}>{d.brief.objective}</p>
              <dl className="small brief-dl">
                {d.brief.audience && (<><dt className="muted">Аудиторія</dt><dd>{d.brief.audience}</dd></>)}
                {d.brief.channel && (<><dt className="muted">Канал</dt><dd>{d.brief.channel}</dd></>)}
                {d.brief.deadline && (<><dt className="muted">Дедлайн</dt><dd>{d.brief.deadline}</dd></>)}
                {spec?.fields.map((f) => d.brief.fields?.[f.key] !== undefined && d.brief.fields[f.key] !== "" ? (
                  <Fragment key={f.key}><dt className="muted">{f.label}</dt><dd style={{ whiteSpace: "pre-line" }}>{showField(d.brief.fields[f.key])}</dd></Fragment>
                ) : null)}
              </dl>
              {d.brief.acceptance_criteria.length > 0 && (
                <ul className="small" style={{ marginTop: 8 }}>{d.brief.acceptance_criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
              )}
            </details>
          </section>
          {d.approvals.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Твої рішення</h2></div>
              <ul className="list">
                {d.approvals.map((a) => (
                  <li key={a.id} className="row" style={{ display: "block" }}>
                    <b>{DECISION[a.decision]}</b> <span className="muted small">{when(a.created_at)}{a.by_me ? "" : ", учасник команди"}</span>
                    {a.rationale && <p className="small" style={{ whiteSpace: "pre-line" }}>{a.rationale}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <details className="panel tech">
        <summary>Технічні деталі: кроки, витрати, хронологія</summary>
        <div className="facts" style={{ marginTop: 12 }}>
          <div className="fact"><b>{usd(d.run.cost_usd)}</b><span>витрати з {usd(d.run.budget_usd)}</span></div>
          <div className="fact"><b>{Number(d.run.tokens_in) + Number(d.run.tokens_out)}</b><span>токенів</span></div>
          <div className="fact"><b>{d.steps.filter((s) => s.status === "succeeded").length}/{d.steps.length}</b><span>кроків</span></div>
          <div className="fact"><b><ProviderBadge provider={d.run.provider} /></b><span>модель</span></div>
        </div>
        {d.run.status === "failed" && <p className="notice bad" style={{ marginTop: 12 }}>Помилка: {d.run.error_message ?? d.run.error_code}</p>}
        {pkgV1?.review && <div style={{ marginTop: 14 }}><ReviewDetails review={pkgV1.review} /></div>}
        <div className="scroll-x" style={{ marginTop: 14 }}>
          <table className="steps-table">
            <thead><tr><th>Крок</th><th>Агент</th><th>Статус</th><th>Модель</th><th>Витрати</th><th>Час</th></tr></thead>
            <tbody>
              {d.steps.map((s) => (
                <tr key={s.id}>
                  <td>{stepLabel(s.step_key)}{s.cycle > 1 ? ` #${s.cycle}` : ""}{s.attempt > 1 ? <span className="muted"> (спроба {s.attempt}/{s.max_attempts})</span> : null}
                    {s.error && <div className="error small">{s.error}</div>}</td>
                  <td>{role(s.agent_role)}</td>
                  <td><StatusPill status={s.status} map={STEP_STATUS} /></td>
                  <td>{modelLabel(s.provider, s.model)}</td>
                  <td>{s.provider === "code" ? "—" : usd(s.cost_usd)}</td>
                  <td className="muted">{s.started_at ? clock(s.started_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ margin: "16px 0 8px" }}>Хронологія</h3>
        <ol className="timeline">
          {d.events.map((e) => (
            <li key={e.id}>
              <time dateTime={e.created_at}>{clock(e.created_at)}</time>
              <span className={`dot ${dotTone(e.kind)}`} aria-hidden="true" />
              <span>{EVENT_TEXT[e.kind]?.(e) ?? e.kind}</span>
            </li>
          ))}
        </ol>
        {d.handoff && (
          <details style={{ marginTop: 10 }}>
            <summary>Дані передачі (handoff.v1)</summary>
            <pre className="json">{JSON.stringify({ ...d.handoff.payload, approved_artifact: { ...(d.handoff.payload.approved_artifact as object), content: "…" } }, null, 2)}</pre>
          </details>
        )}
        {latest && <p className="small muted" style={{ marginTop: 10 }}>Хеш версії {latest.content_hash.slice(0, 10)}</p>}
      </details>
    </>
  );
}

function ScriptCard({ s, i }: { s: Script; i: number }) {
  return (
    <article className="script">
      <h3>{i + 1}. {s.title}</h3>
      <p className="small muted">{s.angle}, ~{s.duration_sec} с</p>
      <p style={{ marginTop: 6 }}><b>Хук:</b> {s.hook}</p>
      <ol className="small">
        {s.scenes.map((sc, j) => (
          <li key={j}>
            {sc.shot}
            {sc.on_screen_text && <> <span className="muted">Текст:</span> «{sc.on_screen_text}»</>}
            {sc.voiceover && <> <span className="muted">Голос:</span> {sc.voiceover}</>}
          </li>
        ))}
      </ol>
      <p className="small" style={{ marginTop: 6 }}><b>CTA:</b> {s.cta}</p>
      {s.claims_needing_source.length > 0 && <p className="small claims">Потрібно підтвердити: {s.claims_needing_source.join("; ")}</p>}
    </article>
  );
}
