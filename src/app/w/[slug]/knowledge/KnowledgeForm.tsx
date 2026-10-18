"use client";
import { useActionState, useEffect, useRef } from "react";
import { addKnowledgeAction, type ActionState } from "../../../actions";

export function KnowledgeForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addKnowledgeAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="form-grid">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div className="form-row">
        <label>
          Тип
          <select name="kind" defaultValue="fact">
            <option value="brand">Бренд</option><option value="fact">Факт</option><option value="audience">Аудиторія</option>
            <option value="offer">Пропозиція</option><option value="decision">Рішення</option><option value="other">Інше</option>
          </select>
        </label>
        <label>
          Статус
          <select name="status" defaultValue="draft">
            <option value="draft">Чернетка</option><option value="approved">Затверджено</option>
          </select>
        </label>
      </div>
      <label>Назва<input name="title" required maxLength={200} placeholder="Тон бренду" /></label>
      <label>Зміст<textarea name="body" required rows={6} maxLength={20000} /></label>
      <label>Джерело <span className="hint">посилання, необов’язково</span><input name="source_url" type="url" /></label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="success" role="status">Додано</p>}
      <div><button className="btn" disabled={pending}>{pending ? "Зберігаємо…" : "Додати"}</button></div>
    </form>
  );
}
