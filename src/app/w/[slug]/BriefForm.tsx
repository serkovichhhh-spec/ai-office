"use client";
import { useActionState } from "react";
import { submitBriefAction, type ActionState } from "../../actions";

export function BriefForm({ workspaceId, slug, idempotencyKey }: { workspaceId: string; slug: string; idempotencyKey: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitBriefAction, {});
  return (
    <form action={action} className="form-grid">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="slug" value={slug} />
      {/* Same key on a double click or retry → the same run, never a duplicate. */}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label>
        Що зробити
        <input name="title" required maxLength={200} placeholder="3 рілси про стабільний вечірній інтернет" />
      </label>
      <label>
        Мета
        <textarea name="objective" required maxLength={4000} placeholder="Чого маємо досягти і чому саме зараз" />
      </label>
      <div className="form-row">
        <label>Аудиторія<input name="audience" maxLength={2000} placeholder="Сім’ї в приватному секторі" /></label>
        <label>Канал<input name="channel" maxLength={200} placeholder="Instagram Reels" /></label>
      </div>
      <div className="form-row">
        <label>
          Скільки варіантів
          <select name="deliverable_count" defaultValue="3">
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Дедлайн<input name="deadline" type="date" /></label>
        <label>
          Пріоритет
          <select name="priority" defaultValue="medium">
            <option value="low">Низький</option>
            <option value="medium">Середній</option>
            <option value="high">Високий</option>
          </select>
        </label>
      </div>
      <label>
        Критерії приймання <span className="hint">кожен з нового рядка</span>
        <textarea name="acceptance_criteria" rows={3} placeholder={"Хук у перші 2 секунди\nCTA «Перевірити покриття»"} />
      </label>
      <label>
        Референси <span className="hint">посилання або опис, кожен з нового рядка</span>
        <textarea name="references" rows={2} />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div>
        <button className="btn" disabled={pending}>{pending ? "Передаємо команді…" : "Передати команді"}</button>
      </div>
    </form>
  );
}
