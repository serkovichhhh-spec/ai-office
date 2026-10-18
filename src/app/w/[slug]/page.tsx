import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { floorState, listHandoffs, listRuns, workspaceBySlug } from "@/lib/queries";
import { PixelAvatar } from "../../components/PixelAvatar";
import { LiveRefresh } from "../../components/LiveRefresh";
import { ACTIVITY, HANDOFF_STATUS, StatusPill, StubBadge, usd, when } from "../../components/ui";
import { BriefForm } from "./BriefForm";

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
  const [floor, runs, handoffs] = await Promise.all([floorState(user.id, ws), listRuns(user.id, ws.id), listHandoffs(user.id, ws.id)]);

  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const waiting = runs.filter((r) => r.status === "needs_approval");
  const canBrief = ws.role !== "viewer";
  const stubMode = process.env.AI_PROVIDER !== "anthropic";

  return (
    <>
      <LiveRefresh active={active} />
      <section className="floor" aria-labelledby="floor-title">
        <div className="floor-head">
          <h2 id="floor-title">Маркетинговий відділ {ws.name}</h2>
          <span className="muted small" style={{ background: "var(--paper)", paddingLeft: 6 }}>
            Витрачено сьогодні {usd(floor.spentToday)} з {usd(ws.daily_budget_usd)} {stubMode && <StubBadge />}
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
              <BriefForm workspaceId={ws.id} slug={ws.slug} idempotencyKey={`brief-${randomUUID()}`} />
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
                      {r.provider === "stub" && <StubBadge />}
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
