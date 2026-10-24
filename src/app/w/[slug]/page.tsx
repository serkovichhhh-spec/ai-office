import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { DATA_CLASS_LABEL, EXECUTOR_LABEL, executors, qaReport, routingState, floorState, listHandoffs, listKnowledge, listRuns, workspaceBySlug } from "@/lib/queries";
import { revokeExecutorAction, setExecutorSeatsAction, setExecutorVerifiedAction } from "../../actions";
import { RoutingPanel } from "./RoutingPanel";
import { PixelAvatar } from "../../components/PixelAvatar";
import { LiveRefresh } from "../../components/LiveRefresh";
import { ACTIVITY, HANDOFF_STATUS, ProviderBadge, StatusPill, StubBadge, usd, when } from "../../components/ui";
import { BriefForm } from "./BriefForm";
import { PLAYBOOK_CATALOG } from "@/lib/orchestrator/registry";

export const dynamic = "force-dynamic";

const WORKING = new Set(["planning", "researching", "drafting", "reviewing"]);
const LEGACY_LABEL: Record<string, string> = {
  analyst: "Аналітик", lead_analyst: "Лід-аналітик", optimizer: "Оптимізатор", scout: "Скаут",
  content: "Контент", chief: "Chief", backup: "Бекап",
};

export default async function OfficePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ws = await workspaceBySlug(user.id, slug);
  if (!ws) notFound();
  const [floor, runs, handoffs, execs, knowledge] = await Promise.all([floorState(user.id, ws), listRuns(user.id, ws.id), listHandoffs(user.id, ws.id), executors(user.id, ws.id), listKnowledge(user.id, ws.id)]);
  const [qa, routing] = ws.role === "owner" ? await Promise.all([qaReport(user.id, ws.id), routingState(user.id, ws.id)]) : [null, null];
  const qaProblems = qa?.checks.filter((c) => c.level === "warn" || c.level === "fail") ?? [];

  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const waiting = runs.filter((r) => r.status === "needs_approval");
  const canBrief = ws.role !== "viewer";
  const providerMode = process.env.AI_PROVIDER ?? "stub";

  return (
    <>
      <LiveRefresh active={active} />
      {(floor.waitingByExecutor.claude_session ?? 0) > 0 && (
        <p className="notice" style={{ marginBottom: 8 }} role="status">
          {floor.waitingByExecutor.claude_session === 1 ? "1 крок чекає" : `${floor.waitingByExecutor.claude_session} кроки чекають`} на Claude.
          {routing?.channels.some((c) => c.adapter === "claude_routine" && c.enabled) ? "Офіс розбудить Claude автоматично." : "Запусти в Claude задачу AI Office вручну або увімкни автозапуск у «Маршрутизація і запуск»."}
        </p>
      )}
      {(floor.waitingByExecutor.chatgpt ?? 0) > 0 && (
        <p className="notice" style={{ marginBottom: 8 }} role="status">
          {floor.waitingByExecutor.chatgpt === 1 ? "1 крок чекає" : `${floor.waitingByExecutor.chatgpt} кроки чекають`} на ChatGPT.
          Відкрий ChatGPT з підключеним AI Office і напиши «візьми задачі AI Office».
        </p>
      )}
      {floor.awaitingAgent > 0 && <div style={{ marginBottom: 8 }} />}
      <section className="floor" aria-labelledby="floor-title">
        <div className="floor-head">
          <h2 id="floor-title">Маркетинговий відділ {ws.name}</h2>
          <span className="muted small" style={{ background: "var(--paper)", paddingLeft: 6 }}>
            Витрачено сьогодні {usd(floor.spentToday)} з {usd(ws.daily_budget_usd)} {providerMode === "stub" && <StubBadge />}{providerMode === "session" && <ProviderBadge provider="session" />}
          </span>
        </div>
        {(["marketing", "production"] as const).map((dept) => {
          const team = floor.agents.filter((a) => a.department === dept);
          if (team.length === 0) return null;
          return (
            <div key={dept} className={`room room-${dept}`}>
              <h3 className="room-title">
                {dept === "marketing" ? "Marketing HQ" : "Production Studio"}
                <span className="muted small"> · {dept === "marketing" ? "працюють онлайн" : "локальний /produce, підключиться через міст"}</span>
              </h3>
              <div className="desks">
                {team.map((a) => {
                  const body = (
                    <>
                      <PixelAvatar role={a.role_key} />
                      <div>
                        <div className="tag">{a.display_name}</div>
                        <div className="doing"><span className="lamp" aria-hidden="true" />{ACTIVITY[a.activity] ?? a.activity}</div>
                        {a.detail && <div className="detail">{a.detail}</div>}
                      </div>
                    </>
                  );
                  const cls = `desk${WORKING.has(a.activity) ? " working" : ""}`;
                  return a.run_id ? (
                    <a key={a.role_key} className={cls} data-activity={a.activity} href={`/w/${ws.slug}/runs/${a.run_id}`}>{body}</a>
                  ) : (
                    <div key={a.role_key} className={cls} data-activity={a.activity}>{body}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <div className="cols">
        <div>
          {canBrief && (
            <section className="panel" aria-labelledby="brief-title">
              <div className="panel-head">
                <h2 id="brief-title">Новий бриф</h2>
                <span className="muted small">Сценарій: концепції та сценарії рілсів</span>
              </div>
              <BriefForm workspaceId={ws.id} slug={ws.slug} idempotencyKey={`brief-${randomUUID()}`} catalog={PLAYBOOK_CATALOG} knowledge={knowledge.filter((k) => k.status === "approved").map((k) => ({ id: k.id, title: k.title, kind: k.kind }))} />
            </section>
          )}
          <section className="panel" aria-labelledby="runs-title">
            <div className="panel-head"><h2 id="runs-title">Запуски</h2></div>
            {runs.length === 0 ? (
              <p className="empty">Поки нічого не запускали. Опишіть задачу в брифі — команда візьметься одразу.</p>
            ) : (
              <ul className="list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <a className="row" href={`/w/${ws.slug}/runs/${r.id}`}>
                      <div className="row-main">
                        <div className="row-title">{r.title}</div>
                        <div className="row-meta">
                          {when(r.created_at)}{r.revision > 1 ? `, версія ${r.revision}` : ""}{r.channel ? `, ${r.channel}` : ""}
                          {r.status === "failed" && r.error_message ? `, ${r.error_message}` : ""}
                        </div>
                      </div>
                      <ProviderBadge provider={r.provider} />
                      <StatusPill status={r.status} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="panel" aria-labelledby="wait-title">
            <div className="panel-head"><h2 id="wait-title">Потребує вашого рішення</h2></div>
            {waiting.length === 0 ? (
              <p className="empty">Нічого не чекає на затвердження.</p>
            ) : (
              <ul className="list">
                {waiting.map((r) => (
                  <li key={r.id}>
                    <a className="row" href={`/w/${ws.slug}/runs/${r.id}`}>
                      <div className="row-main"><div className="row-title">{r.title}</div><div className="row-meta">{when(r.updated_at)}</div></div>
                      <span className="btn secondary">Переглянути</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {qa && (
            <section className="panel" aria-labelledby="qa-title">
              <div className="panel-head">
                <h2 id="qa-title">Стан системи</h2>
                <span className={`pill ${qa.status === "fail" ? "bad" : qa.status === "warn" ? "wait" : "ok"}`}>
                  {qa.status === "fail" ? "є збої" : qa.status === "warn" ? "потребує уваги" : "усе працює"}
                </span>
              </div>
              {qaProblems.length === 0 ? (
                <p className="empty">Перевірок: {qa.checks.length}. Проблем не знайдено.</p>
              ) : (
                <ul className="list">
                  {qaProblems.map((c) => (
                    <li key={c.key} className="row">
                      <div className="row-main">
                        <div className="row-title">{c.detail} <span className={`pill ${c.level === "fail" ? "bad" : "wait"}`}>{c.count}</span></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {routing && <RoutingPanel ws={ws} state={routing} />}

          <section className="panel" aria-labelledby="exec-title">
            <div className="panel-head">
              <h2 id="exec-title">Виконавці</h2>
              <span className="muted small">Підключення через MCP</span>
            </div>
            {execs.length === 0 ? (
              <p className="empty">Ще нікого не підключено. Адреса для ChatGPT і Claude: <code>/api/mcp</code> цього сайту.</p>
            ) : (
              <ul className="list">
                {execs.map((e) => (
                  <li key={e.id} className="row" style={{ alignItems: "flex-start" }}>
                    <div className="row-main">
                      <div className="row-title">
                        {e.label} <span className="pill">{EXECUTOR_LABEL[e.kind] ?? e.kind}</span>{" "}
                        {e.verified_at && <span className="pill ok" title={e.verified_note ?? undefined}>перевірений</span>}
                      </div>
                      <div className="row-meta">
                        {e.allowed_seats.length === 0
                          ? "Ролей не видано — задач не бачить"
                          : `Ролі: ${e.allowed_seats.map((s) => floor.agents.find((a) => a.role_key === s)?.display_name ?? s).join(", ")}`}
                      </div>
                      <div className="row-meta">
                        Дані: {e.max_data_class ? `до рівня «${DATA_CLASS_LABEL[e.max_data_class]}»` : "заборонено політикою"} ·{" "}
                        {e.last_seen_at ? `останнє звернення ${when(e.last_seen_at)}` : "ще не звертався"}
                      </div>
                      {ws.role === "owner" && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="small">Ролі виконавця</summary>
                          <form action={setExecutorSeatsAction} className="form-grid" style={{ marginTop: 6 }}>
                            <input type="hidden" name="executor_id" value={e.id} />
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4 }}>
                              {floor.agents.filter((a) => a.role_key !== "orchestrator").map((a) => (
                                <label key={a.role_key} className="small" style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
                                  <input type="checkbox" name="seats" value={a.role_key} defaultChecked={e.allowed_seats.includes(a.role_key)} />
                                  {a.display_name}
                                </label>
                              ))}
                            </div>
                            <div><button className="btn">Зберегти ролі</button></div>
                          </form>
                        </details>
                      )}
                    </div>
                    {ws.role === "owner" && (
                      <form action={setExecutorVerifiedAction}>
                        <input type="hidden" name="executor_id" value={e.id} />
                        <input type="hidden" name="verified" value={e.verified_at ? "false" : "true"} />
                        <button className="btn link" title="Лише перевірені виконавці можуть підхоплювати чужі кроки">
                          {e.verified_at ? "Зняти «перевірений»" : "Позначити перевіреним"}
                        </button>
                      </form>
                    )}
                    {ws.role === "owner" && (
                      <form action={revokeExecutorAction}>
                        <input type="hidden" name="executor_id" value={e.id} />
                        <button className="btn link">Відключити</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="handoff-title">
            <div className="panel-head">
              <h2 id="handoff-title">Черга в продакшн</h2>
              <span className="muted small">Міст до /produce не підключено</span>
            </div>
            {handoffs.length === 0 ? (
              <p className="empty">Затверджені пакети з’являться тут і чекатимуть на локальний продакшн.</p>
            ) : (
              <ul className="list">
                {handoffs.map((h) => (
                  <li key={h.id}>
                    <a className="row" href={`/w/${ws.slug}/runs/${h.run_id}`}>
                      <div className="row-main"><div className="row-title">{h.title}</div><div className="row-meta">{when(h.created_at)}</div></div>
                      <span className="pill">{HANDOFF_STATUS[h.status] ?? h.status}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {floor.legacy && (
            <section className="panel" aria-labelledby="legacy-title">
              <div className="panel-head">
                <h2 id="legacy-title">Агенти CMO Space</h2>
                <span className="muted small">лише перегляд</span>
              </div>
              {floor.legacy.length === 0 ? (
                <p className="empty">Запусків ще не було.</p>
              ) : (
                <ul className="list">
                  {floor.legacy.map((l) => (
                    <li key={l.id}>
                      <div className="row">
                        <div className="row-main">
                          <div className="row-title">{LEGACY_LABEL[l.agent] ?? l.agent}: {l.summary ?? "без опису"}</div>
                          <div className="row-meta">
                            {when(l.started_at)}{l.stale ? ", без завершення понад 2 години — можливо, сесія обірвалась" : ""}
                          </div>
                        </div>
                        <span className={`pill ${l.stale ? "bad" : l.status === "ok" ? "ok" : l.status === "running" ? "active" : l.status === "failed" ? "bad" : "wait"}`}>
                          {l.stale ? "завис?" : l.status === "ok" ? "готово" : l.status === "running" ? "працює" : l.status === "failed" ? "помилка" : "частково"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
