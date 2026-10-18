import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { listKnowledge, workspaceBySlug } from "@/lib/queries";
import { when } from "../../../components/ui";
import { setKnowledgeStatusAction } from "../../../actions";
import { KnowledgeForm } from "./KnowledgeForm";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { brand: "Бренд", fact: "Факт", audience: "Аудиторія", offer: "Пропозиція", decision: "Рішення", other: "Інше" };

export default async function KnowledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ws = await workspaceBySlug(user.id, slug);
  if (!ws) notFound();
  const docs = await listKnowledge(user.id, ws.id);
  const canEdit = ws.role === "owner" || ws.role === "editor";
  return (
    <div className="cols" style={{ marginTop: 0 }}>
      <section className="panel" aria-labelledby="k-title">
        <div className="panel-head">
          <h2 id="k-title">Знання {ws.name}</h2>
          <span className="muted small">Агенти бачать лише затверджене</span>
        </div>
        {docs.length === 0 ? (
          <p className="empty">Поки порожньо. Додайте тон бренду, ключові факти й пропозиції — без них агенти не використовуватимуть жодних фактів.</p>
        ) : (
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id} style={{ padding: "12px 2px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <h3>{d.title} <span className="muted small">{KIND[d.kind]}</span></h3>
                  <span className={`pill ${d.status === "approved" ? "ok" : "wait"}`}>{d.status === "approved" ? "затверджено" : "чернетка"}</span>
                </div>
                <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{d.body}</p>
                <p className="small muted" style={{ marginTop: 4 }}>
                  Оновлено {when(d.updated_at)}{d.source_url ? <>, <a href={d.source_url} rel="noreferrer" target="_blank">джерело</a></> : null}
                </p>
                {canEdit && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <form action={setKnowledgeStatusAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="status" value={d.status === "approved" ? "draft" : "approved"} />
                      <button className="btn link">{d.status === "approved" ? "Повернути в чернетки" : "Затвердити"}</button>
                    </form>
                    <form action={setKnowledgeStatusAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="status" value="archived" />
                      <button className="btn link">В архів</button>
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
    </div>
  );
}
