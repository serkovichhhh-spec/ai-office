"use client";
import { useActionState } from "react";
import { reviewKnowledgeCandidateAction } from "../../../actions";

export function CandidateReview({ id, confidence, validUntil, reviewHash }: { id: string; confidence: string; validUntil: string | null; reviewHash: string }) {
  const [state, action, pending] = useActionState(reviewKnowledgeCandidateAction, {});
  return <form action={action} className="form-grid" style={{ marginTop: 12 }}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="review_hash" value={reviewHash} />
    <label>Актуально до<input type="date" name="valid_until" defaultValue={validUntil ?? ""} /></label>
    <label>Коментар<textarea name="note" maxLength={2000} rows={2} placeholder="Для відхилення вкажіть причину" /></label>
    {confidence === "assumption" && <p className="small muted">Спершу потрібне придатне першоджерело. Попросіть уточнення в дослідника або відхиліть припущення.</p>}
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn" name="decision" value="approved" disabled={pending || confidence === "assumption"}>Схвалити й додати до знань</button>
      <button className="btn link" name="decision" value="rejected" disabled={pending}>Відхилити</button>
    </div>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.ok && <p className="success" role="status">Рішення збережено</p>}
  </form>;
}
