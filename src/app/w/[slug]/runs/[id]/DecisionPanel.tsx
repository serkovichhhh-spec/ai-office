"use client";
import { useActionState, useState } from "react";
import { decideAction, type ActionState } from "../../../../actions";

export function DecisionPanel({ artifactId, version }: { artifactId: string; version: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideAction, {});
  const [comment, setComment] = useState("");
  return (
    <section className="panel decision" aria-labelledby={`decide-${artifactId}`}>
      <h2 id={`decide-${artifactId}`} style={{ marginBottom: 6 }}>Ваше рішення щодо v{version}</h2>
      <p className="small muted">Після затвердження пакет іде в чергу продакшну. Затвердити можна лише цю, останню версію.</p>
      <form action={action}>
        <input type="hidden" name="artifact_id" value={artifactId} />
        <label style={{ marginTop: 12 }}>
          Коментар <span className="hint">обов’язковий для доопрацювання</span>
          <textarea name="rationale" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
        </label>
        {state.error && <p className="error" role="alert" style={{ marginTop: 8 }}>{state.error}</p>}
        <div className="actions">
          <button className="btn approve" name="decision" value="approved" disabled={pending}>Затвердити</button>
          <button className="btn secondary" name="decision" value="revision_requested" disabled={pending || !comment.trim()}>
            Доопрацювати
          </button>
          <button className="btn danger" name="decision" value="rejected" disabled={pending}>Відхилити</button>
        </div>
      </form>
    </section>
  );
}
