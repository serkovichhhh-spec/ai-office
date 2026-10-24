import type { RoutingState } from "@/lib/queries";
import { EXECUTOR_LABEL } from "@/lib/queries";
import { channelConfigured, requiredEnv } from "@/lib/triggers/adapters";
import {
  clearProviderLimitAction, resumeChannelAction, setChannelEnabledAction, setProviderLimitAction, setTriggersEnabledAction,
} from "../../actions";
import { when } from "../../components/ui";

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude (Anthropic)", openai: "ChatGPT (OpenAI)" };
const ADAPTER_LABEL: Record<string, string> = {
  claude_routine: "Claude routine (API-тригер)",
  chatgpt_agent: "ChatGPT workspace agent",
  manual_notify: "Сповіщення власнику",
};
const PAUSE_REASON: Record<string, string> = {
  circuit_breaker: "3 невдалі запуски поспіль",
  rate_limited: "ліміт запусків провайдера",
  auth: "помилка доступу (токен)",
  fatal: "помилка налаштування",
};
const EVENT_LABEL: Record<string, string> = {
  trigger_requested: "запит надіслано",
  trigger_accepted: "прийнято, чекаємо взяття",
  task_claimed: "задачу взято",
  artifact_submitted: "результат здано",
  task_completed: "виконано",
  trigger_failed: "запуск не вдався",
  trigger_expired: "ніхто не взяв за 10 хв",
  trigger_skipped: "пропущено",
  owner_notified: "власника сповіщено",
};
const REASON: Record<string, string> = { no_verified_executor: "немає перевіреного виконавця" };

/** Owner panel: provider limits, wake-up channels and steps that need a human decision. */
export function RoutingPanel({ ws, state }: { ws: { id: string; slug: string }; state: RoutingState }) {
  const limited = new Map(state.providers.map((p) => [p.provider, p]));
  return (
    <section className="panel" aria-labelledby="routing-title">
      <div className="panel-head">
        <h2 id="routing-title">Маршрутизація і запуск</h2>
        <form action={setTriggersEnabledAction}>
          <input type="hidden" name="workspace_id" value={ws.id} />
          <input type="hidden" name="enabled" value={state.triggers_enabled ? "false" : "true"} />
          <button className="btn link small">{state.triggers_enabled ? "Автозапуск увімкнено · вимкнути" : "Автозапуск вимкнено · увімкнути"}</button>
        </form>
      </div>

      {state.attention.length > 0 && (
        <ul className="list" aria-label="Потребує уваги">
          {state.attention.map((a) => (
            <li key={a.step_id}>
              <a className="row" href={`/w/${ws.slug}/runs/${a.run_id}`}>
                <div className="row-main">
                  <div className="row-title">{a.brief_title}: {a.step}</div>
                  <div className="row-meta">
                    Чекає на {EXECUTOR_LABEL[a.executor] ?? a.executor}
                    {a.routed_from ? ` (замість ${EXECUTOR_LABEL[a.routed_from] ?? a.routed_from})` : ""} з {when(a.since)}
                    {a.route_blocked ? ` · ${REASON[a.route_blocked] ?? a.route_blocked}` : ""}
                  </div>
                </div>
                <span className={`pill ${a.route_blocked ? "bad" : "wait"}`}>{a.route_blocked ? "зупинено" : "чекає"}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <h3 className="small" style={{ margin: "10px 0 4px" }}>Ліміти сервісів</h3>
      <ul className="list">
        {(["anthropic", "openai"] as const).map((p) => {
          const l = limited.get(p);
          return (
            <li key={p} className="row" style={{ alignItems: "center" }}>
              <div className="row-main">
                <div className="row-title">{PROVIDER_LABEL[p]}</div>
                <div className="row-meta">
                  {l ? `Ліміт вичерпано${l.limited_until ? ` до ${when(l.limited_until)}` : ""} — нові кроки йдуть перевіреному резерву або чекають` : "Працює"}
                </div>
              </div>
              {l ? (
                <form action={clearProviderLimitAction}>
                  <input type="hidden" name="workspace_id" value={ws.id} />
                  <input type="hidden" name="provider" value={p} />
                  <button className="btn link">Ліміт відновлено</button>
                </form>
              ) : (
                <form action={setProviderLimitAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="workspace_id" value={ws.id} />
                  <input type="hidden" name="provider" value={p} />
                  <select name="hours" defaultValue="5" aria-label="На скільки годин">
                    <option value="1">1 год</option>
                    <option value="5">5 год</option>
                    <option value="24">добу</option>
                    <option value="72">3 дні</option>
                    <option value="168">тиждень</option>
                  </select>
                  <button className="btn link">Ліміт вичерпано</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="small" style={{ margin: "10px 0 4px" }}>Канали запуску</h3>
      <ul className="list">
        {state.channels.map((c) => {
          const configured = channelConfigured(c.adapter, { env_prefix: c.env_prefix ?? undefined }, process.env);
          const status = !c.enabled ? "вимкнено"
            : !configured ? "немає секретів"
            : c.paused ? `пауза${c.paused_until && !c.paused_manual ? ` до ${when(c.paused_until)}` : ""}`
            : c.quiet_now ? "тиха година (CMO Space)" : "працює";
          return (
            <li key={c.id} className="row" style={{ alignItems: "flex-start" }}>
              <div className="row-main">
                <div className="row-title">{ADAPTER_LABEL[c.adapter]}{c.executor_label ? ` → ${c.executor_label}` : ""}</div>
                <div className="row-meta">
                  Сьогодні {c.today} з {c.daily_cap}
                  {c.last ? ` · останній: ${EVENT_LABEL[c.last.event] ?? c.last.event}, ${when(c.last.at)}` : ""}
                  {c.paused && c.paused_reason ? ` · ${PAUSE_REASON[c.paused_reason] ?? c.paused_reason}` : ""}
                </div>
                {c.enabled && !configured && (
                  <div className="row-meta">Додайте у Vercel змінні: {requiredEnv(c.adapter, { env_prefix: c.env_prefix ?? undefined }).map((n) => <code key={n} style={{ marginRight: 4 }}>{n}</code>)}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className={`pill ${status === "працює" ? "ok" : status === "вимкнено" ? "" : "wait"}`}>{status}</span>
                {c.paused && (
                  <form action={resumeChannelAction}>
                    <input type="hidden" name="channel_id" value={c.id} />
                    <button className="btn link">Зняти паузу</button>
                  </form>
                )}
                <form action={setChannelEnabledAction}>
                  <input type="hidden" name="channel_id" value={c.id} />
                  <input type="hidden" name="enabled" value={c.enabled ? "false" : "true"} />
                  <button className="btn link">{c.enabled ? "Вимкнути" : "Увімкнути"}</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small" style={{ marginTop: 6 }}>
        Резерв: Claude ↔ ChatGPT, лише перевірені виконавці. Grok і платні сервіси автоматично не підключаються.
        Якщо перевіреного виконавця немає, крок зупиняється і з’являється тут.
      </p>
    </section>
  );
}
