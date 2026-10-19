/** Generic renderer for Package.v1 (declarative playbooks) and their draft artifacts. */

const LABEL: Record<string, string> = {
  summary: "Підсумок", audience_insight: "Інсайт аудиторії", key_messages: "Ключові меседжі", message: "Меседж",
  rationale: "Чому", evidence: "Джерела", placement_constraints: "Обмеження носіїв", open_questions: "Відкриті питання",
  concepts: "Концепції", title: "Назва", big_idea: "Ідея", headline: "Заголовок", subline: "Підзаголовок", cta: "CTA",
  word_count: "Слів на носії", visual: "Візуал", composition: "Композиція", mascot_use: "Маскот", why_it_works: "Чому спрацює",
  risks: "Ризики", specs: "ТЗ", concept_title: "Концепція", formats: "Формати", format: "Формат", size: "Розмір",
  layout: "Розкладка", safe_zone: "Безпечна зона", typography: "Типографіка", palette: "Палітра", assets_needed: "Потрібні ассети",
  ai_background_prompt: "Промпт для AI-фону", print_notes: "Друк", checklist: "Чекліст перевірки",
};
const HIDDEN = new Set(["claims_needing_source", "_provider"]);
const MONO = new Set(["ai_background_prompt"]);
// Postgres jsonb does not keep key order, so fields are shown in this logical order.
const ORDER = Object.keys(LABEL);
const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };
const label = (k: string) => LABEL[k] ?? k.replaceAll("_", " ");

function Value({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => typeof x !== "object")) {
      return <ul className="small">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
    }
    return <div className="cards">{v.map((x, i) => <Card key={i} index={i} obj={x as Record<string, unknown>} />)}</div>;
  }
  if (typeof v === "object") return <Fields obj={v as Record<string, unknown>} />;
  if (MONO.has(k)) return <pre className="json prompt">{String(v)}</pre>;
  return <p className="small">{String(v)}</p>;
}

function Fields({ obj }: { obj: Record<string, unknown> }) {
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

function Card({ obj, index }: { obj: Record<string, unknown>; index: number }) {
  const title = (obj.title ?? obj.concept_title ?? obj.message ?? obj.format) as string | undefined;
  const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => !["title", "concept_title"].includes(k) && !(k === "message" && title === obj.message)));
  const claims = Array.isArray(obj.claims_needing_source) ? (obj.claims_needing_source as string[]) : [];
  return (
    <article className="script">
      {title && <h3>{index + 1}. {title}</h3>}
      <Fields obj={rest} />
      {claims.length > 0 && <p className="small claims">Потрібно підтвердити: {claims.join("; ")}</p>}
    </article>
  );
}

export function SectionView({ content }: { content: Record<string, unknown> }) {
  return <Fields obj={content} />;
}

export interface PackageV1 {
  schema_version: "Package.v1";
  sections: { kind: string; label: string; version: number; content: Record<string, unknown> }[];
  review: { verdict: string; summary: string; scores: { criterion: string; score: number; comment: string }[];
    open_issues: { target: string; severity: string; criterion: string; problem: string; fix: string }[] } | null;
  unsupported_claims: string[];
  sources_used: { title: string; url: string | null }[];
  handoff?: { to: string; note: string };
}

export function PackageView({ pkg }: { pkg: PackageV1 }) {
  return (
    <>
      {pkg.sections.map((s) => (
        <section key={s.kind} style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 8 }}>{s.label} <span className="muted small">v{s.version}</span></h3>
          <SectionView content={s.content} />
        </section>
      ))}
      {pkg.review && (
        <section style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 6 }}>Рев'ю: {pkg.review.verdict === "pass" ? "пройдено" : "є зауваження"}</h3>
          <p className="small">{pkg.review.summary}</p>
          <table className="steps-table small" style={{ marginTop: 8 }}>
            <tbody>
              {pkg.review.scores.map((s, i) => (
                <tr key={i}><td>{s.criterion}</td><td><b>{s.score}/5</b></td><td className="muted">{s.comment}</td></tr>
              ))}
            </tbody>
          </table>
          {pkg.review.open_issues.length > 0 && (
            <ul className="small" style={{ marginTop: 8 }}>
              {pkg.review.open_issues.map((x, i) => <li key={i}>[{x.severity}] {x.target} · {x.criterion}: {x.problem}{x.fix ? ` → ${x.fix}` : ""}</li>)}
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
