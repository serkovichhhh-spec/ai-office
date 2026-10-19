import { ProgramStart } from "./ProgramStart";
import { planV1Enabled,programEngineEnabledForWorkspace } from "@/lib/orchestrator/rollout";
import { approveProgramGateAction,cancelProgramAction } from "../../../../actions";
import { FileUpload } from "./FileUpload";
import { filesEnabledForWorkspace } from "@/lib/orchestrator/rollout";
import { asUser,db } from "@/lib/db";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { listKnowledge, runDetail, stepLabel, workspaceBySlug, type RunDetail } from "@/lib/queries";
import { LiveRefresh } from "../../../../components/LiveRefresh";
import { HANDOFF_STATUS, ROLE_LABEL, STEP_STATUS, ProviderBadge, StatusPill, StubBadge, clock, modelLabel, usd, when } from "../../../../components/ui";
import { EXECUTOR_LABEL } from "@/lib/queries";
import { cancelRunAction } from "../../../../actions";
import { DecisionPanel } from "./DecisionPanel";
import { PackageView, SectionView, type PackageV1 } from "./PackageView";
import { PLAYBOOKS } from "@/lib/orchestrator/registry";
import { ENUM_LABEL } from "@/lib/orchestrator/catalog";

export const dynamic = "force-dynamic";

interface Angle { title: string; insight: string; hook_idea: string; why_it_works: string; evidence: string[] }
interface Script {
  title: string; angle: string; duration_sec: number; hook: string; cta: string;
  scenes: { shot: string; on_screen_text: string; voiceover: string }[]; claims_needing_source: string[];
}

const EVENT_TEXT: Record<string, (e: RunDetail["events"][number]) => string> = {
  "run.created": () => "Бриф передано команді",
  "step.started": (e) => `${role(e.agent_role)} почав: ${stepLabel(String(e.payload.step))}${Number(e.payload.attempt) > 1 ? ` (спроба ${e.payload.attempt})` : ""}`,
  "step.succeeded": (e) => `${role(e.agent_role)}: ${String(e.payload.message ?? "готово")}`,
  "artifact.created": (e) => `Нова версія: ${kindLabel(String(e.payload.kind))} v${e.payload.version}`,
  "step.retry_scheduled": (e) => `${role(e.agent_role)}: збій, повторна спроба (${String(e.payload.error ?? "")})`,
  "step.lease_expired": (e) => `${role(e.agent_role)}: воркер не відповів, крок повернуто в чергу`,
  "step.dead_lettered": (e) => `${role(e.agent_role)}: спроби вичерпано — ${String(e.payload.error ?? e.payload.reason ?? "")}`,
  "run.needs_approval": () => "Пакет чекає на ваше рішення",
  "approval.recorded": (e) => `Рішення: ${DECISION[String(e.payload.decision)] ?? e.payload.decision} (v${e.payload.version})`,
  "handoff.queued": () => "Передано в чергу продакшну",
  "run.cancelled": () => "Запуск скасовано",
  "run.budget_exceeded": () => "Зупинено: вичерпано бюджет",
  "run.max_steps": () => "Зупинено: забагато кроків",
  "step.awaiting_agent": (e) => `${role(e.agent_role)}: ${stepLabel(String(e.payload.step))} чекає на ${who(e.payload.executor)}${e.payload.note ? " (повтор: відповідь не пройшла перевірку)" : ""}`,
  "attempt.claimed": (e) => `${role(e.agent_role)}: ${String(e.payload.executor_name ?? who(e.payload.executor))} взяв у роботу — ${stepLabel(String(e.payload.step))}, оренда до ${clock(String(e.payload.lease_expires_at))}`,
  "attempt.saved_as_proposal": (e) => `${role(e.agent_role)}: результат від ${who(e.payload.executor)} збережено як пропозицію, не застосовано (${PROPOSAL[String(e.payload.reason)] ?? e.payload.reason})`,
  "step.agent_submitted": (e) => `${role(e.agent_role)}: ${String(e.payload.executor_name ?? who(e.payload.executor))} передав результат — ${stepLabel(String(e.payload.step))}`,
};
const PROPOSAL: Record<string, string> = { lease_expired: "оренда минула", task_no_longer_waiting: "задача вже неактуальна", inputs_changed: "вхідні дані змінилися" };
const who = (k: unknown) => EXECUTOR_LABEL[String(k ?? "claude_session")] ?? String(k);
const DECISION: Record<string, string> = { approved: "затверджено", rejected: "відхилено", revision_requested: "на доопрацювання" };
const KIND: Record<string, string> = { strategy: "стратегія", scripts: "сценарії", review: "рев'ю", deliverable: "пакет" };
const role = (r: string | null) => (r ? ROLE_LABEL[r] ?? r : "Система");
const kindLabel = (k: string) => KIND[k] ?? k;

function dotTone(kind: string) {
  if (kind.includes("dead") || kind.includes("budget") || kind === "run.cancelled") return "bad";
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
  const filesEnabled=filesEnabledForWorkspace(ws.slug);
  const files=filesEnabled?await asUser(db(),user.id,tx=>tx`select id,original_name,purpose,mime_type,byte_size,width,height from office.artifact_files where run_id=${d.run.id}::uuid order by created_at`):[];
  const workPlan=d.artifacts.filter(a=>a.kind==="work_plan").at(-1);
  const programFeature=planV1Enabled(ws.slug);
  const programs=programFeature?await asUser(db(),user.id,tx=>tx`select p.*,coalesce((select sum(cost_usd) from office.runs where program_id=p.id),0) as spent
    from office.programs p where p.parent_run_id=${d.run.id}::uuid or p.id=(select program_id from office.runs where id=${d.run.id}::uuid) order by p.approved_at desc limit 1`):[];
  const programInfo=programs[0];
  const programChildren=programInfo?await asUser(db(),user.id,tx=>tx`select i.item_key,i.run_id,i.depends_on,b.title,r.status from office.program_items i join office.runs r on r.id=i.run_id join office.briefs b on b.id=r.brief_id where i.program_id=${programInfo.id}::uuid order by i.item_key`):[];
  const programGates=programInfo?await asUser(db(),user.id,tx=>tx`select after_item,question,approved_at from office.program_gates where program_id=${programInfo.id}::uuid order by after_item`):[];
  const pkgV1 = latest && (latest.content as { schema_version?: string }).schema_version === "Package.v1" ? (latest.content as unknown as PackageV1) : null;
  const specDraft = !latest && pb?.stepTitles && d.brief.playbook_key !== "reels_concepts" || (!latest && (d.run.playbook_version ?? 1) > 1)
    ? Object.entries(pb?.stepTitles ?? {}).map(([key, title]) => ({ s: { key, title }, a: d.artifacts.filter((a) => a.kind === key).at(-1) })).filter((x) => x.a).at(-1)
    : undefined;
  const content = (pkgV1 ? null : latest?.content ?? null) as null | {
    strategy_summary: string; angles: Angle[]; scripts: Script[];
    review: { verdict: string; summary: string; open_issues: { script_index: number; severity: string; issue: string }[] } | null;
    unsupported_claims: string[]; sources_used: { title: string; url: string | null }[];
  };

  return (
    <>
      <LiveRefresh active={active} intervalMs={2500} />
      <p className="small" style={{ marginBottom: 10 }}><a href={`/w/${ws.slug}`}>← Офіс</a></p>
      <div className="run-head">
        <h1>{d.brief.title}</h1>
        <div className="meta">
          {isStub ? <StubBadge /> : <ProviderBadge provider={d.run.provider} />}
          <StatusPill status={d.run.status} />
          {canCancel && (
            <form action={cancelRunAction}>
              <input type="hidden" name="run_id" value={d.run.id} />
              <button className="btn danger">Скасувати</button>
            </form>
          )}
        </div>
      </div>
      <div className="facts">
        <div className="fact"><b>{usd(d.run.cost_usd)}</b><span>витрати з {usd(d.run.budget_usd)}</span></div>
        <div className="fact"><b>{Number(d.run.tokens_in) + Number(d.run.tokens_out)}</b><span>токенів</span></div>
        <div className="fact"><b>{d.steps.filter((s) => s.status === "succeeded").length}/{d.steps.length}</b><span>кроків виконано</span></div>
        <div className="fact"><b>v{d.run.revision}</b><span>версія пакета</span></div>
        <div className="fact"><b>{when(d.run.created_at)}</b><span>створено</span></div>
      </div>

      {isStub && (
        <p className="notice" style={{ marginTop: 16 }}>
          Модель не підключена: тексти нижче — шаблони, щоб перевірити процес. Черга, кроки, версії, затвердження й передача в продакшн — справжні.
        </p>
      )}
      {awaitingAgent && (
        <p className="notice" style={{ marginTop: 16 }} role="status">
          {awaitingExecutor === "chatgpt"
            ? "Наступний крок чекає на ChatGPT. Відкрий ChatGPT з підключеним AI Office і напиши «візьми задачі AI Office» — сторінка оновиться сама."
            : "Наступний крок чекає на Claude. Запусти задачу «AI Office: відпрацювати чергу» в Claude або напиши в чаті «запусти офіс» — сторінка оновиться сама."}
        </p>
      )}
      {d.run.status === "failed" && (
        <p className="notice bad" style={{ marginTop: 16 }}>Запуск зупинився: {d.run.error_message ?? d.run.error_code}</p>
      )}

      <div className="cols">
        <div>
          {canDecide && latest && (
            <div className="mobile-first-decision">
              <DecisionPanel artifactId={latest.id} version={latest.version} canApproveConcept={ws.role === "owner" && pkgV1?.outcome === "conditional"} canApprove={!pkgV1?.outcome || pkgV1.outcome === "ready_for_approval"} />
            </div>
          )}

          {programFeature&&(workPlan||programInfo)&&<section className="panel" aria-labelledby="program-title">
            <h2 id="program-title">План і програма робіт</h2>
            {programInfo&&<><p>Стан: {String(programInfo.status)}{programInfo.blocked_reason?` · ${programInfo.blocked_reason}`:""} · витрати {String(programInfo.spent)} з {String(programInfo.budget_usd)} USD</p>
              <ul>{programChildren.map(c=><li key={String(c.run_id)}><a href={`/w/${ws.slug}/runs/${c.run_id}`}>{String(c.item_key)}: {String(c.title)}</a> · {String(c.status)}{(c.depends_on as string[]).length?` · після ${(c.depends_on as string[]).join(", ")}`:""}</li>)}</ul>
              {programGates.map(g=><div key={String(g.after_item)} style={{marginTop:12}}><b>{String(g.after_item)}: {String(g.question)}</b><p>{g.approved_at?"Схвалено":"Чекає рішення власника після затвердження результату"}</p>
                {!g.approved_at&&ws.role==="owner"&&programInfo.status==="active"&&<form action={approveProgramGateAction}><input type="hidden" name="program_id" value={String(programInfo.id)}/><input type="hidden" name="after" value={String(g.after_item)}/><input name="note" placeholder="Коментар до рішення" maxLength={4000}/><button className="btn secondary">Погодити перехід далі</button></form>}
              </div>)}
              {ws.role==="owner"&&["active","blocked"].includes(String(programInfo.status))&&<form action={cancelProgramAction} style={{marginTop:12}}><input type="hidden" name="program_id" value={String(programInfo.id)}/><button className="btn danger">Скасувати програму та всі дочірні задачі</button></form>}
            </>}
            {workPlan&&ws.role==="owner"&&d.run.status==="needs_approval"&&(!programInfo||(!["active","blocked"].includes(String(programInfo.status))&&programInfo.plan_artifact_id!==workPlan.id))&&
              (programEngineEnabledForWorkspace(ws.slug)?<ProgramStart artifactId={workPlan.id} budget={String(d.run.budget_usd)}/>:<p className="notice">План збережено для оцінки. Виконання програм для цього офісу ще не ввімкнено.</p>)}
          </section>}
          {filesEnabled && <section className="panel" aria-labelledby="files-title">
            <h2 id="files-title">Файли задачі</h2>
            {files.map(f=><div key={String(f.id)} style={{marginBottom:12}}>
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{String(f.original_name)}</a>
              <p className="small muted">{String(f.purpose)} · {Math.ceil(Number(f.byte_size)/1024)} КБ{f.width?` · ${f.width} × ${f.height}`:""}</p>
              {String(f.mime_type).startsWith("image/")&&<img src={`/api/files/${f.id}`} alt={String(f.purpose)} style={{maxWidth:"100%",maxHeight:300,objectFit:"contain"}}/>}
            </div>)}
            {ws.role==="owner"&&<FileUpload runId={d.run.id}/>}
          </section>}
          <section className="panel" aria-labelledby="deliv-title">
            <div className="panel-head">
              <h2 id="deliv-title">{latest ? `Пакет v${latest.version}` : "Результат"}</h2>
              {latest && <span className="muted small">хеш {latest.content_hash.slice(0, 10)}</span>}
            </div>
            {pkgV1 && <PackageView pkg={pkgV1} />}
            {specDraft?.a && (
              <>
                <p className="muted small" style={{ marginBottom: 10 }}>Проміжний результат «{specDraft.s.title}», ще не пройшов рев'ю:</p>
                <SectionView content={specDraft.a.content as Record<string, unknown>} />
              </>
            )}
            {!content && !pkgV1 && !specDraft && !draftScripts && <p className="empty">{active ? "Команда працює — результат з’явиться тут." : "Результату немає."}</p>}
            {!content && draftScripts?.scripts && (
              <>
                <p className="muted small" style={{ marginBottom: 10 }}>Чернетка сценаріїв, ще не пройшла рев'ю:</p>
                {draftScripts.scripts.map((s, i) => <ScriptCard key={i} s={s} i={i} />)}
              </>
            )}
            {content && (
              <>
                <h3>Стратегія</h3>
                <p style={{ marginTop: 6 }}>{content.strategy_summary}</p>
                <div style={{ marginTop: 8 }}>
                  {content.angles.map((a, i) => (
                    <div className="angle" key={i}>
                      <b>{a.title}</b>
                      <p className="small">{a.insight}</p>
                      <p className="small muted">Хук: {a.hook_idea}. {a.why_it_works}</p>
                      {a.evidence.length > 0 && <p className="small muted">Джерела: {a.evidence.join(", ")}</p>}
                    </div>
                  ))}
                </div>
                <h3 style={{ margin: "18px 0 10px" }}>Сценарії</h3>
                {content.scripts.map((s, i) => <ScriptCard key={i} s={s} i={i} />)}
                {content.review && (
                  <>
                    <h3 style={{ margin: "18px 0 6px" }}>Рев'ю</h3>
                    <p className="small">{content.review.summary}</p>
                    {content.review.open_issues.length > 0 && (
                      <ul className="small">{content.review.open_issues.map((x, i) => <li key={i}>#{x.script_index + 1} [{x.severity}] {x.issue}</li>)}</ul>
                    )}
                  </>
                )}
                {content.unsupported_claims.length > 0 && (
                  <p className="notice" style={{ marginTop: 12 }}>
                    <b>Потрібно підтвердити перед публікацією:</b> {content.unsupported_claims.join("; ")}
                  </p>
                )}
                {content.sources_used.length > 0 && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    Знання workspace, доступні команді: {content.sources_used.map((s) => s.title).join(", ")}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="steps-title">
            <div className="panel-head"><h2 id="steps-title">Кроки</h2></div>
            <div className="scroll-x">
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
          </section>
        </div>

        <div>
          {canDecide && latest && <div className="desktop-decision"><DecisionPanel artifactId={latest.id} version={latest.version} canApproveConcept={ws.role === "owner" && pkgV1?.outcome === "conditional"} canApprove={!pkgV1?.outcome || pkgV1.outcome === "ready_for_approval"} /></div>}

          {d.handoff && (
            <section className="panel">
              <div className="panel-head"><h2>Продакшн</h2><span className="pill ok">{HANDOFF_STATUS[d.handoff.status]}</span></div>
              <p className="small muted">Пакет у черзі з контрактом handoff.v1. Локальний /produce забере його, коли буде підключено міст.</p>
              <details style={{ marginTop: 10 }}>
                <summary>Дані передачі</summary>
                <pre className="json">{JSON.stringify({ ...d.handoff.payload, approved_artifact: { ...(d.handoff.payload.approved_artifact as object), content: "…" } }, null, 2)}</pre>
              </details>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Бриф</h2></div>
            <p>{d.brief.objective}</p>
            <dl className="small" style={{ marginTop: 10, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
              {d.brief.audience && (<><dt className="muted">Аудиторія</dt><dd style={{ margin: 0 }}>{d.brief.audience}</dd></>)}
              {d.brief.channel && (<><dt className="muted">Канал</dt><dd style={{ margin: 0 }}>{d.brief.channel}</dd></>)}
              <dt className="muted">Варіантів</dt><dd style={{ margin: 0 }}>{d.brief.deliverable_count}</dd>
              {d.brief.deadline && (<><dt className="muted">Дедлайн</dt><dd style={{ margin: 0 }}>{d.brief.deadline}</dd></>)}
              {spec && (<><dt className="muted">Тип задачі</dt><dd style={{ margin: 0 }}>{spec.label}</dd></>)}
              {spec?.fields.map((f) => d.brief.fields?.[f.key] !== undefined && d.brief.fields[f.key] !== "" ? (
                <Fragment key={f.key}><dt className="muted">{f.label}</dt><dd style={{ margin: 0, whiteSpace: "pre-line" }}>{showField(d.brief.fields[f.key])}</dd></Fragment>
              ) : null)}
            </dl>
            {d.brief.acceptance_criteria.length > 0 && (
              <ul className="small" style={{ marginTop: 8 }}>{d.brief.acceptance_criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
            )}
          </section>

          {d.approvals.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Рішення</h2></div>
              <ul className="list">
                {d.approvals.map((a) => (
                  <li key={a.id} className="row" style={{ display: "block" }}>
                    <b>{DECISION[a.decision]}</b> <span className="muted small">{when(a.created_at)}, {a.by_me ? "ви" : "учасник команди"}</span>
                    {a.rationale && <p className="small">{a.rationale}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="tl-title">
            <div className="panel-head"><h2 id="tl-title">Хронологія</h2></div>
            <ol className="timeline">
              {d.events.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.created_at}>{clock(e.created_at)}</time>
                  <span className={`dot ${dotTone(e.kind)}`} aria-hidden="true" />
                  <span>{EVENT_TEXT[e.kind]?.(e) ?? e.kind}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
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
