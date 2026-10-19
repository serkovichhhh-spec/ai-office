/** Generic renderer for Package.v1 (declarative and library playbooks) and their draft artifacts. */

// Order matters: jsonb does not keep key order, so fields are shown in this logical order.
const LABEL: Record<string, string> = {
  title: "Назва", summary: "Підсумок", status: "Статус", kind: "Вид", objective: "Мета", goal: "Ціль", idea: "Ідея",
  concept: "Концепція", big_idea: "Ідея", message: "Меседж", headline: "Заголовок", subline: "Підзаголовок", hook: "Гачок",
  hook_hypothesis: "Гачок (гіпотеза)", insight_hypothesis: "Інсайт (гіпотеза)", audience_insight: "Інсайт аудиторії",
  audience: "Аудиторія", audience_hypothesis: "Аудиторія (гіпотеза)", key_messages: "Ключові меседжі",
  subject: "Тема листа", preheader: "Прехедер", body: "Текст", copy: "Текст", caption: "Підпис", copy_variants: "Варіанти тексту",
  cta: "CTA", destination: "Куди веде", channel: "Канал", placement: "Розміщення", placements: "Розміщення", platform: "Платформа",
  scheduled_at: "Коли", duration_seconds: "Тривалість, с", medium: "Носій",
  visual: "Візуал", visual_direction: "Візуальний напрям", composition: "Композиція", hierarchy: "Ієрархія", design: "Дизайн",
  design_brief: "ТЗ на дизайн", creative: "Креатив", text_overlay_instruction: "Накладання тексту", mascot_use: "Маскот",
  shots: "Кадри", frames: "Кадри", order: "№", start_seconds: "Від, с", end_seconds: "До, с", on_screen_text: "Текст на екрані",
  voiceover: "Озвучення", audio: "Звук", edit_notes: "Монтаж", capture_brief: "ТЗ на зйомку", locations: "Локації", people: "Люди", props: "Реквізит",
  formats: "Формати", format: "Формат", width: "Ширина", height: "Висота", unit: "Одиниці", aspect_ratio: "Пропорції", safe_area: "Безпечна зона",
  export_spec: "Експорт", file_naming: "Назви файлів", adaptation_rules: "Правила адаптації", channel_adaptations: "Адаптації під канали",
  system_rules: "Правила системи", do_not: "Не можна", avoid: "Уникати",
  trim_mm: "Обріз, мм", bleed_mm: "Виліт, мм", safe_margin_mm: "Поле безпеки, мм", color_profile: "Колірний профіль",
  resolution_dpi: "DPI", scale: "Масштаб", finishing: "Обробка", proof_checks: "Перевірка проби", response_tracking: "Відстеження відгуку",
  generation_prompts: "Промпти для генерації", prompt: "Промпт", asset_uses: "Ассети", reference_assets: "Референси",
  rights_checks: "Перевірка прав", accessibility: "Доступність", accessibility_checks: "Перевірки доступності",
  structure: "Структура", campaign_ids: "Кампанії", ad_sets: "Групи оголошень", ads: "Оголошення", budget: "Бюджет",
  share_percent: "Частка, %", amount: "Сума", currency: "Валюта", keywords: "Ключові слова", negative_keywords: "Мінус-слова",
  experiments: "Експерименти", variable: "Що змінюємо", control: "Контроль", variant: "Варіант", metric: "Метрика",
  primary_metric: "Головна метрика", success_metric: "Метрика успіху", decision_rule: "Правило рішення",
  minimum_evidence: "Мінімум даних", spend_guardrail: "Ліміт витрат", measurement: "Вимірювання", approved_target: "Затверджена ціль",
  launch_checklist: "Чекліст запуску", settings_to_verify: "Налаштування до перевірки",
  tasks: "Завдання", action: "Дія", responsible_role: "Роль", depends_on: "Залежить від", deadline: "Строк", rollback: "Відкат",
  findings: "Висновки", classification: "Тип", statement: "Твердження", confidence: "Впевненість", calculations: "Розрахунки",
  formula: "Формула", substituted_expression: "Підстановка", value: "Значення", null_reason: "Чому немає значення",
  actions: "Дії", priority: "Пріоритет", data_quality: "Якість даних", limitations: "Обмеження",
  rows: "Матриця", competitor_id: "Конкурент", dimension: "Критерій", observed_value: "Значення", observed_at: "Дата спостереження",
  ranked_candidates: "Рейтинг", brief_score: "Бриф", distinctiveness_score: "Відмінність", feasibility_score: "Здійсненність",
  evidence_score: "Доказовість", weighted_score: "Зважений бал", selected: "Обрано", reason: "Причина", validation_plan: "Як перевірити",
  directions: "Напрями", recommended_direction_id: "Рекомендований напрям", items: "Елементи", pillar: "Рубрика", topic: "Тема",
  production_needs: "Потреби продакшну", units: "Одиниці", sections: "Секції", support_faq: "FAQ для продажів",
  work_items: "Робочі одиниці", rationale: "Обґрунтування", why_it_works: "Чому спрацює", dependencies: "Залежності",
  constraints: "Обмеження", assumptions: "Припущення", validation: "Перевірка", risks: "Ризики", checklist: "Чекліст",
  production_checklist: "Чекліст продакшну", publishing_checklist: "Чекліст публікації", export_checklist: "Чекліст експорту",
  delivery_checklist: "Чекліст доставки", readiness_checklist: "Чекліст готовності", supplier_questions: "Питання до постачальника",
  purpose: "Призначення", asset_id: "Ассет", version: "Версія", text: "Твердження", needed_evidence: "Потрібне підтвердження",
  disposition: "Стан", needs_owner_approval: "Потрібне рішення власника", production_checks: "Перевірки продакшну", delivery_checks: "Перевірки доставки", permissions: "Дозволи",
  approved_by: "Ким затверджено", success: "Успіх",
  id: "ID",
  // ooh_concepts (v0 spec)
  placement_constraints: "Обмеження носіїв", open_questions: "Відкриті питання", concepts: "Концепції",
  word_count: "Слів на носії", specs: "ТЗ", concept_title: "Концепція", size: "Розмір", layout: "Розкладка", safe_zone: "Безпечна зона",
  typography: "Типографіка", palette: "Палітра", assets_needed: "Потрібні ассети", ai_background_prompt: "Промпт для AI-фону", print_notes: "Друк",
};
// Technical lineage fields stay in the canonical JSON but are not shown to the owner.
const HIDDEN = new Set([
  "claims_needing_source", "_provider", "source_uses", "source_refs", "refs", "budget_knowledge_refs", "supplier_knowledge_refs",
  "brand_knowledge_refs", "geo_knowledge_refs", "rights_knowledge_refs", "target_knowledge_refs", "platform_constraints_knowledge_refs",
  "input_refs", "calculation_ids", "finding_ids", "evidence_pointer", "affected_pointer", "output_pointer", "blocking_questions",
]);
const MONO = new Set(["ai_background_prompt", "prompt", "substituted_expression"]);
const ORDER = Object.keys(LABEL);
const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };
const label = (k: string) => LABEL[k] || k.replaceAll("_", " ");
const STATUS: Record<string, string> = { ready: "готово", blocked: "заблоковано" };

type Obj = Record<string, unknown>;

function Value({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => typeof x !== "object" || x === null)) {
      return <ul className="small">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
    }
    return <div className="cards">{v.map((x, i) => <Card key={i} index={i} obj={x as Obj} />)}</div>;
  }
  if (typeof v === "object") return <Fields obj={v as Obj} />;
  if (typeof v === "boolean") return <p className="small">{v ? "так" : "ні"}</p>;
  if (k === "status") return <p className="small">{STATUS[String(v)] ?? String(v)}</p>;
  if (MONO.has(k)) return <pre className="json prompt">{String(v)}</pre>;
  return <p className="small" style={{ whiteSpace: "pre-line" }}>{String(v)}</p>;
}

function Fields({ obj }: { obj: Obj }) {
  return (
    <dl className="fields">
      {Object.entries(obj).filter(([k]) => !HIDDEN.has(k)).sort((a, b) => rank(a[0]) - rank(b[0])).map(([k, v]) => (
        v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? null : (
          <div key={k}><dt>{label(k)}</dt><dd><Value k={k} v={v} /></dd></div>
        )
      ))}
    </dl>
  );
}

function claimText(c: unknown): string {
  return typeof c === "string" ? c : String((c as Obj)?.text ?? JSON.stringify(c));
}

function Card({ obj, index }: { obj: Obj; index: number }) {
  const titleKey = ["title", "concept_title", "headline", "name", "statement", "message", "format"].find((k) => typeof obj[k] === "string" && obj[k]);
  const title = titleKey ? String(obj[titleKey]) : undefined;
  const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== titleKey));
  const claims = Array.isArray(obj.claims_needing_source) ? obj.claims_needing_source.map(claimText) : [];
  return (
    <article className="script">
      {title && <h3>{index + 1}. {title}</h3>}
      <Fields obj={rest} />
      {claims.length > 0 && <p className="small claims">Потрібно підтвердити: {claims.join("; ")}</p>}
    </article>
  );
}

export function SectionView({ content }: { content: unknown }) {
  if (content && typeof content === "object" && !Array.isArray(content)) return <Fields obj={content as Obj} />;
  return <Value k="" v={content} />;
}

export interface PackageV1 {
  schema_version: "Package.v1";
  outcome?: "ready_for_approval" | "blocked" | "escalated" | "conditional";
  sections: { kind: string; label: string; version: number; content: unknown }[];
  blocking_questions?: string[];
  review: { verdict: string; summary: string; scores: { criterion: string; score: number; comment: string }[];
    open_issues: { target: string; severity: string; criterion: string; problem: string; fix: string }[] } | null;
  unsupported_claims: string[];
  sources_used: { title: string; url: string | null }[];
  handoff?: { to: string; note: string };
}

const VERDICT: Record<string, string> = { pass: "пройдено", revise: "є зауваження", escalate: "ескалація" };
const CRITERION: Record<string, string> = {
  evidence: "Доказовість", brief_fit: "Відповідність брифу", brand: "Бренд", execution: "Виконуваність", specialist: "Фахова якість",
};
// Shown elsewhere (claims and questions blocks) or purely technical.
const SKIP_SECTIONS = new Set(["claims_needing_source", "source_uses", "blocking_questions"]);

export function PackageView({ pkg }: { pkg: PackageV1 }) {
  return (
    <>
      {pkg.outcome === "conditional" && <p className="notice" style={{marginBottom:12}}><b>Умовна концепція.</b> Ідею можна схвалити окремо. Для передачі в продакшн спочатку підтвердьте факти та пройдіть повторне рев’ю.</p>}
      {pkg.outcome === "blocked" && (
        <div className="notice bad" style={{ marginBottom: 12 }}>
          <b>Заблоковано: бракує підтверджених даних.</b> Затвердити такий пакет не можна. Додайте відповіді в «Знання» і натисніть «Доопрацювати» з коментарем.
          {(pkg.blocking_questions ?? []).length > 0 && <ul className="small" style={{ marginTop: 6 }}>{pkg.blocking_questions!.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        </div>
      )}
      {pkg.outcome === "escalated" && (
        <p className="notice bad" style={{ marginBottom: 12 }}>
          <b>Ескалація.</b> Після доопрацювання рев'юер ще бачить критичні зауваження або без вашого рішення їх не виправити. Затвердити не можна — доопрацюйте з коментарем або відхиліть.
        </p>
      )}
      {pkg.sections.filter((s) => !SKIP_SECTIONS.has(s.kind)).map((s) => (
        <section key={s.kind} style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 8 }}>{s.label} <span className="muted small">v{s.version}</span></h3>
          <SectionView content={s.content} />
        </section>
      ))}
      {pkg.review && (
        <section style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 6 }}>Рев'ю: {VERDICT[pkg.review.verdict] ?? pkg.review.verdict}</h3>
          <p className="small">{pkg.review.summary}</p>
          <table className="steps-table small" style={{ marginTop: 8 }}>
            <tbody>
              {pkg.review.scores.map((s, i) => (
                <tr key={i}><td>{CRITERION[s.criterion] ?? s.criterion}</td><td><b>{s.score}/5</b></td><td className="muted">{s.comment}</td></tr>
              ))}
            </tbody>
          </table>
          {pkg.review.open_issues.length > 0 && (
            <ul className="small" style={{ marginTop: 8 }}>
              {pkg.review.open_issues.map((x, i) => <li key={i}>[{x.severity}] {CRITERION[x.criterion] ?? x.criterion}: {x.problem}{x.fix ? ` → ${x.fix}` : ""}</li>)}
            </ul>
          )}
        </section>
      )}
      {pkg.unsupported_claims.length > 0 && (
        <p className="notice" style={{ marginTop: 12 }}>
          <b>Потрібно підтвердити перед публікацією:</b> {pkg.unsupported_claims.join("; ")}
        </p>
      )}
      {pkg.handoff && <p className="small muted" style={{ marginTop: 10 }}>Після затвердження: {pkg.handoff.note}.</p>}
    </>
  );
}
