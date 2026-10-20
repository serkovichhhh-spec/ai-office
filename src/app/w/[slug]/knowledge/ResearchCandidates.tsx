import Link from "next/link";
import type { KnowledgeCandidateRow } from "@/lib/queries";
import { DATA_CLASS_LABEL } from "@/lib/queries";
import { CandidateReview } from "./CandidateReview";

const STATUS: Record<string,string> = { candidate: "Чекає рішення", approved: "Додано до знань", rejected: "Відхилено" };
const CONFIDENCE: Record<string,string> = { verified: "Дослідник перевірив", reported: "За повідомленням джерела", assumption: "Припущення" };

export function ResearchCandidates({ rows, isOwner, slug }: { rows: KnowledgeCandidateRow[]; isOwner: boolean; slug: string }) {
  return <section className="panel" aria-labelledby="research-title" style={{ gridColumn: "1 / -1" }}>
    <div className="panel-head"><h2 id="research-title">Дослідження на перевірці</h2>
      <span className="muted small">Лише після рішення власника факт потрапляє до знань агентів</span></div>
    {rows.length === 0 ? <p className="empty">Нових пропозицій від дослідників поки немає.</p> :
      <ul className="list">{rows.map(c => <li key={c.id} style={{ padding: "14px 2px" }}>
        <h3>{c.title} <span className={`pill ${c.status === "approved" ? "ok" : "wait"}`}>{STATUS[c.status] ?? c.status}</span></h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{c.claim}</p>
        <p className="muted small">{CONFIDENCE[c.confidence]} · Доступ: {DATA_CLASS_LABEL[c.data_class]}{c.valid_until ? ` · Актуально до ${c.valid_until}` : ""}</p>
        <p className="small">{c.why_it_matters}</p>
        {c.owner_question && <p className="small">Питання: {c.owner_question}</p>}
        <ul>{c.sources.map((source,i) => <li key={i} className="small">
          {/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> : <span>{source.title}</span>}
          {source.accessed_at ? ` · Перевірено ${source.accessed_at}` : ""}
          {source.quote && <blockquote>{source.quote}</blockquote>}
        </li>)}</ul>
        <Link href={`/w/${slug}/runs/${c.run_id}`} className="small">Відкрити дослідження й оригінальні джерела</Link>
        {c.review_note && <p className="small">Рішення власника: {c.review_note}</p>}
        {c.status === "candidate" && (isOwner ? <CandidateReview id={c.id} confidence={c.confidence} validUntil={c.valid_until} reviewHash={c.review_hash} /> : <p className="muted small">Очікує рішення власника.</p>)}
      </li>)}</ul>}
  </section>;
}
