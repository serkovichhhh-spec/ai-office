/** Generic renderer for Package.v1 (declarative and library playbooks) and their draft artifacts. */
import { creativesFrom } from "@/lib/ui/package-view-model";
import { CreativeGallery } from "./CreativeGallery";
import { SectionView } from "./SectionView";
export { SectionView };

export interface PackageV1 {
  schema_version: "Package.v1";
  outcome?: "ready_for_approval" | "blocked" | "escalated";
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
// Shown in the owner checklist or purely technical.
const SKIP_SECTIONS = new Set(["claims_needing_source", "source_uses", "blocking_questions"]);
// Production details: useful for the designer, not for the decision — collapsed.
const PRODUCTION = /checklist|assumptions|checks|rules|naming|constraints|risks|dependencies/;

/** The result itself: summary first, creatives as visual previews, everything for production collapsed. */
export function PackageView({ pkg }: { pkg: PackageV1 }) {
  const sections = pkg.sections.filter((s) => !SKIP_SECTIONS.has(s.kind));
  const lead = sections.filter((s) => typeof s.content === "string");
  const production = sections.filter((s) => typeof s.content !== "string" && PRODUCTION.test(s.kind));
  const main = sections.filter((s) => typeof s.content !== "string" && !PRODUCTION.test(s.kind));
  return (
    <>
      {lead.map((s) => {
        const t = String(s.content);
        const cut = t.split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
        return cut.length < t.length - 20
          ? <details key={s.kind} className="lead-more"><summary className="lead">{cut} <span className="more">Детальніше</span></summary><p className="lead">{t.slice(cut.length).trim()}</p></details>
          : <p key={s.kind} className="lead">{t}</p>;
      })}
      {main.map((s) => {
        const creatives = creativesFrom(s.content);
        return (
          <section key={s.kind} className="pkg-section">
            <h3>{s.label}{creatives ? <span className="muted small"> · {creatives.length}</span> : null}</h3>
            {creatives ? <CreativeGallery items={creatives} /> : <SectionView content={s.content} />}
          </section>
        );
      })}
      {production.length > 0 && (
        <details className="quiet pkg-section">
          <summary>Для продакшну: {production.map((s) => s.label.toLowerCase()).join(", ")}</summary>
          {production.map((s) => (
            <section key={s.kind} style={{ marginTop: 12 }}>
              <h4>{s.label}</h4>
              <SectionView content={s.content} />
            </section>
          ))}
        </details>
      )}
      {pkg.handoff && <p className="small muted" style={{ marginTop: 14 }}>Після затвердження: {pkg.handoff.note}.</p>}
    </>
  );
}

/** A draft artifact: visual when it has creatives, generic otherwise. */
export function DraftView({ content }: { content: Record<string, unknown> }) {
  const arr = Object.values(content).find((v) => creativesFrom(v));
  const creatives = arr ? creativesFrom(arr) : null;
  return creatives ? <CreativeGallery items={creatives} /> : <SectionView content={content} />;
}

/** Reviewer scores — for the technical details block. */
export function ReviewDetails({ review }: { review: NonNullable<PackageV1["review"]> }) {
  return (
    <>
      <p className="small"><b>Рецензія: {VERDICT[review.verdict] ?? review.verdict}.</b> {review.summary}</p>
      <table className="steps-table small" style={{ marginTop: 8 }}>
        <tbody>
          {review.scores.map((s, i) => (
            <tr key={i}><td>{CRITERION[s.criterion] ?? s.criterion}</td><td><b>{s.score}/5</b></td><td className="muted">{s.comment}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
