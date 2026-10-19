export const RUN_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "У черзі", tone: "active" },
  running: { label: "Працюють", tone: "active" },
  needs_input: { label: "Потрібні дані", tone: "wait" },
  needs_approval: { label: "Чекає рішення", tone: "wait" },
  approved: { label: "Затверджено", tone: "ok" },
  handoff_queued: { label: "Передано в продакшн", tone: "ok" },
  failed: { label: "Помилка", tone: "bad" },
  cancelled: { label: "Скасовано", tone: "" },
};

export const STEP_STATUS: Record<string, { label: string; tone: string }> = {
  ready: { label: "в черзі", tone: "" },
  running: { label: "виконується", tone: "active" },
  awaiting_agent: { label: "чекає на виконавця", tone: "wait" },
  succeeded: { label: "готово", tone: "ok" },
  failed: { label: "помилка", tone: "bad" },
  cancelled: { label: "скасовано", tone: "" },
};

export const HANDOFF_STATUS: Record<string, string> = {
  queued: "Чекає на продакшн-міст",
  claimed: "Забрано продакшном",
  in_production: "У виробництві",
  review: "На перевірці",
  done: "Готово",
  failed: "Помилка",
  cancelled: "Скасовано",
};

export const ACTIVITY: Record<string, string> = {
  idle: "Вільний",
  off: "Вимкнений",
  queued: "Чекає на чергу",
  planning: "Планує",
  researching: "Досліджує",
  drafting: "Пише",
  reviewing: "Перевіряє",
  waiting_approval: "Чекає на ваше рішення",
  unassigned: "Ще без задач",
  awaiting_agent: "Чекає на виконавця",
  awaiting_bridge: "Чекає на міст",
  blocked: "Заблокований",
};

export const ROLE_LABEL: Record<string, string> = {
  orchestrator: "Шеф-маркетолог",
  creative: "Креативник",
  smm: "SMM-менеджер",
  content_maker: "Контент-мейкер",
  designer: "Дизайнер",
  graphic_designer: "Графічний дизайнер",
  print_designer: "Дизайнер поліграфії",
  video_editor: "Монтажер",
  strategist: "Стратег",
  research_analyst: "Аналітик",
  performance_analyst: "Перформанс-аналітик",
  creative_director: "Арт-директор",
  copywriter: "Копірайтер",
  reviewer: "QA-рев'юер",
  scriptwriter: "Сценарист",
  ads_specialist: "Таргетолог",
};

export function StatusPill({ status, map = RUN_STATUS }: { status: string; map?: Record<string, { label: string; tone: string }> }) {
  const s = map[status] ?? { label: status, tone: "" };
  return <span className={`pill ${s.tone}`}>{s.label}</span>;
}

export function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  if (provider === "session") {
    return <span className="pill" title="Тексти пишуть Claude і ChatGPT у сесіях, які запускає власник">Claude / ChatGPT</span>;
  }
  if (provider === "stub") return <StubBadge />;
  return null;
}

/** Who produced a step: code, a model API, or an external executor through the gateway. */
export function modelLabel(provider: string | null, model: string | null): string {
  if (provider === "code") return "код";
  if (model === "claude-session") return "Claude";
  if (model === "chatgpt") return "ChatGPT";
  return model ?? "—";
}

export function StubBadge() {
  return (
    <span className="stub-badge" title="Текст створено шаблоном, а не моделлю. Черга, кроки й затвердження — справжні.">
      STUB — без AI
    </span>
  );
}

const fmt = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" });
const fmtTime = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Kyiv" });

export function when(d: string | Date | null | undefined): string {
  return d ? fmt.format(new Date(d)) : "—";
}
export function clock(d: string | Date): string {
  return fmtTime.format(new Date(d));
}
export function usd(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n === 0 ? "$0" : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

export function Logo() {
  // A web drawn on the pixel grid: the office of PAVUTYNA's marketing team.
  return (
    <svg width="26" height="26" viewBox="0 0 13 13" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="13" height="13" rx="2" fill="var(--ink)" />
      <path d="M6.5 1.5v10M1.5 6.5h10M3 3l7 7M10 3l-7 7" stroke="var(--paper)" strokeWidth="0.7" />
      <rect x="4.5" y="4.5" width="4" height="4" fill="none" stroke="var(--lamp)" strokeWidth="0.7" />
    </svg>
  );
}
