"use client";
import { useActionState, useState } from "react";
import type { PLAYBOOK_CATALOG } from "@/lib/orchestrator/registry";
import { submitBriefAction, type ActionState } from "../../actions";

type Catalog = typeof PLAYBOOK_CATALOG;

const CRITERIA_HINT: Record<string, string> = {
  reels_concepts: "Хук у перші 2 секунди\nCTA «Перевірити покриття»",
  ooh_concepts: "Заголовок читається з 50 м\nНе більше 7 слів у заголовку",
};

const TITLE_HINT: Record<string, string> = {
  reels_concepts: "3 рілси про стабільний вечірній інтернет",
  ooh_concepts: "Білборди для нових районів підключення",
};

export function BriefForm({ workspaceId, slug, idempotencyKey, catalog }: { workspaceId: string; slug: string; idempotencyKey: string; catalog: Catalog }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitBriefAction, {});
  const [key, setKey] = useState(catalog[0].key);
  const pb = catalog.find((p) => p.key === key) ?? catalog[0];
  return (
    <form action={action} className="form-grid">
      <fieldset className="playbook-pick">
        <legend>Тип задачі</legend>
        {catalog.map((p) => (
          <label key={p.key} className={p.key === key ? "on" : ""}>
            <input type="radio" name="playbook_key" value={p.key} checked={p.key === key} onChange={() => setKey(p.key)} />
            <b>{p.label}</b>
            <span className="hint">{p.description}</span>
          </label>
        ))}
      </fieldset>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="slug" value={slug} />
      {/* Same key on a double click or retry → the same run, never a duplicate. */}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label>
        Що зробити
        <input name="title" required maxLength={200} placeholder={TITLE_HINT[key] ?? "Що потрібно зробити"} />
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
      {pb.fields.map((f) => (
        <label key={`${key}-${f.key}`}>
          {f.label}{f.required ? " *" : ""} {f.hint && <span className="hint">{f.hint}</span>}
          {f.type === "textarea" || f.type === "list" ? (
            <textarea name={`f_${f.key}`} rows={3} maxLength={f.maxLength ?? 2000} required={f.required} placeholder={f.placeholder} />
          ) : f.type === "select" ? (
            <select name={`f_${f.key}`} defaultValue={f.options?.[0]?.value}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input name={`f_${f.key}`} maxLength={f.maxLength ?? 500} required={f.required} placeholder={f.placeholder} />
          )}
        </label>
      ))}
      <label>
        Критерії приймання <span className="hint">кожен з нового рядка</span>
        <textarea name="acceptance_criteria" rows={3} placeholder={CRITERIA_HINT[key] ?? ""} />
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
