"use client";
import { useActionState, useState } from "react";
import { decideAction, type ActionState } from "../../../../actions";

export function DecisionPanel({ artifactId, version, canApprove = true, template }: { artifactId: string; version: number; canApprove?: boolean; template?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideAction, {});
  const [comment, setComment] = useState("");
  return (
    <section className="panel decision" aria-labelledby={`decide-${artifactId}`}>
      <h2 id={`decide-${artifactId}`} style={{ marginBottom: 6 }}>Твоє рішення <span className="muted small">версія {version}</span></h2>
      <p className="small muted">
        {canApprove
          ? "«Затвердити» — пакет іде в CMO Space на виконання. «Доопрацювати» — команда переробить з урахуванням коментаря."
          : "Затвердити поки не можна. Дай відповіді в коментарі й натисни «Доопрацювати» — команда переробить пакет."}
      </p>
      <form action={action}>
        <input type="hidden" name="artifact_id" value={artifactId} />
        <label style={{ marginTop: 12 }}>
          Коментар {!canApprove && <span className="hint">відповіді на пункти зліва</span>}
          <textarea name="rationale" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000}
            placeholder={canApprove ? "Необовʼязково для затвердження" : "1. … 2. …"} />
        </label>
        {template && !comment && (
          <button type="button" className="btn link small" onClick={() => setComment(template)}>Вставити шаблон відповідей</button>
        )}
        {state.error && <p className="error" role="alert" style={{ marginTop: 8 }}>{state.error}</p>}
        <div className="actions">
          {canApprove && <button className="btn approve" name="decision" value="approved" disabled={pending}>Затвердити</button>}
          <button className={`btn ${canApprove ? "secondary" : "approve"}`} name="decision" value="revision_requested" disabled={pending || !comment.trim()}>
            Доопрацювати
          </button>
          <button className="btn danger" name="decision" value="rejected" disabled={pending}>Відхилити</button>
        </div>
      </form>
    </section>
  );
}
