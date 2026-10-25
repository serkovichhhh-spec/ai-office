import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { DATA_CLASS_LABEL, listKnowledge, listKnowledgeCandidates, workspaceBySlug } from "@/lib/queries";
import { when } from "../../../components/ui";
import { setKnowledgeClassAction, setKnowledgeStatusAction } from "../../../actions";
import { KnowledgeForm } from "./KnowledgeForm";
import { ResearchCandidates } from "./ResearchCandidates";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { brand: "Бренд", fact: "Факт", audience: "Аудиторія", offer: "Пропозиція", decision: "Рішення", other: "Інше" };

export default async function KnowledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ws = await workspaceBySlug(user.id, slug);
  if (!ws) notFound();
  const [docs, candidates] = await Promise.all([
    listKnowledge(user.id, ws.id),
    slug === "pavutyna" ? listKnowledgeCandidates(user.id, ws.id) : Promise.resolve({ enabled: false, rows: [] }),
  ]);
  const canEdit = ws.role === "owner" || ws.role === "editor";
  // Drafts first: they need the owner's decision, agents don't see them yet.
  const ordered = [...docs].sort((a, b) => Number(a.status === "approved") - Number(b.status === "approved"));
  const drafts = docs.filter((d) => d.status !== "approved").length;
  return (
    <div className="cols" style={{ marginTop: 0 }}>
      <section className="panel" aria-labelledby="k-title">
        <div className="panel-head">
          <h2 id="k-title">Знання {ws.name}</h2>
          <span className="muted small">Агенти бачать лише затверджене й лише свій рівень доступу</span>
        </div>
        {canEdit && drafts > 0 && (
          <p className="notice" style={{ marginBottom: 12 }}>
            <b>Чекають твого затвердження: {drafts}.</b> Поки запис у чернетці, агенти його не бачать. Натисни зелену кнопку «Затвердити» під записом.
          </p>
        )}
        {docs.length === 0 ? (
          <p className="empty">Поки порожньо. Додайте тон бренду, ключові факти й пропозиції — без них агенти не використовуватимуть жодних фактів.</p>
        ) : (
          <ul className="list">
            {ordered.map((d) => (
              <li key={d.id} style={{ padding: "12px 2px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <h3>{d.title} <span className="muted small">{KIND[d.kind]}</span></h3>
                  <span className={`pill ${d.status === "approved" && !d.expired ? "ok" : "wait"}`}>{d.expired ? "строк дії минув — агенти не використовують" : d.status === "approved" ? "затверджено" : "чернетка"}</span>
                </div>
                {d.body.length > 400 ? (
                  <details className="quiet" style={{ marginTop: 6 }}>
                    <summary>{d.body.slice(0, 160).replace(/\s+/g, " ")}… — показати повністю</summary>
                    <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{d.body}</p>
                  </details>
                ) : <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{d.body}</p>}
                <p className="small muted" style={{ marginTop: 4 }}>
                  Доступ: {DATA_CLASS_LABEL[d.data_class] ?? d.data_class} · Оновлено {when(d.updated_at)}{d.source_url ? <>, <a href={d.source_url} rel="noreferrer" target="_blank">джерело</a></> : null}
                  {d.valid_until ? ` · Актуально до ${d.valid_until}` : ""}
                </p>
                {canEdit && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <form action={setKnowledgeStatusAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="status" value={d.status === "approved" ? "draft" : "approved"} />
                      <button className={d.status === "approved" ? "btn link" : "btn approve"}>{d.status === "approved" ? "Повернути в чернетки" : "Затвердити"}</button>
                    </form>
                    <form action={setKnowledgeStatusAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="status" value="archived" />
                      <button className="btn link">В архів</button>
                    </form>
                    <form action={setKnowledgeClassAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="id" value={d.id} />
                      <select name="data_class" defaultValue={d.data_class} aria-label="Рівень доступу">
                        {Object.entries(DATA_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button className="btn link">Змінити доступ</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && (
        <section className="panel" aria-labelledby="k-add">
          <div className="panel-head"><h2 id="k-add">Додати знання</h2></div>
          <KnowledgeForm workspaceId={ws.id} />
        </section>
      )}
      {candidates.enabled && <ResearchCandidates rows={candidates.rows} isOwner={ws.role === "owner"} slug={slug} />}
    </div>
  );
}
