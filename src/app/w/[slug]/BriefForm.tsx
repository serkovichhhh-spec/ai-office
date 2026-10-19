"use client";
import { useActionState, useState } from "react";
import type { CatalogEntry } from "@/lib/orchestrator/catalog";
import { submitBriefAction, type ActionState } from "../../actions";

export interface KnowledgeOption { id: string; title: string; kind: string }

const TITLE_HINT: Record<string, string> = {
  reels_concepts: "3 рілси про стабільний вечірній інтернет",
  outdoor_print_pack: "Білборди для нових районів підключення",
  graphic_design_pack: "Банери для акції «Вигідний перехід»",
  paid_media_campaign: "Meta-кампанія на нові будинки Позняків",
  smm_content_plan: "Контент-план Instagram на листопад",
};
const CRITERIA_HINT: Record<string, string> = {
  reels_concepts: "Хук у перші 2 секунди\nCTA «Перевірити покриття»",
  outdoor_print_pack: "Заголовок читається з дороги\nОдин запам'ятовуваний контакт",
};
const PRIORITY_LABEL: Record<string, string> = { P1: "основні", P2: "ще", P3: "експериментальні" };

export function BriefForm({ workspaceId, slug, idempotencyKey, catalog, knowledge }: {
  workspaceId: string; slug: string; idempotencyKey: string; catalog: CatalogEntry[]; knowledge: KnowledgeOption[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitBriefAction, {});
  const [key, setKey] = useState(catalog[0].key);
  const pb = catalog.find((p) => p.key === key) ?? catalog[0];
  const groups = [...new Set(catalog.map((p) => p.group))];
  const maxCount = Math.min(pb.maxCount, 30);
  return (
    <form action={action} className="form-grid">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="slug" value={slug} />
      {/* Same key on a double click or retry → the same run, never a duplicate. */}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="playbook_version" value={pb.version} />
      <label>
        Тип задачі
        <select name="playbook_key" value={key} onChange={(e) => setKey(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {catalog.filter((p) => p.group === g).map((p) => (
                <option key={p.key} value={p.key}>{p.label}{p.priority && p.priority !== "P1" ? ` (${PRIORITY_LABEL[p.priority]})` : ""}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="hint">{pb.description}</span>
      </label>
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
        <label>Канал<input name="channel" maxLength={200} placeholder="Instagram, сайт, білборди…" /></label>
      </div>
      <div className="form-row">
        <label>
          Скільки результатів
          <input name="deliverable_count" type="number" min={1} max={maxCount} defaultValue={Math.min(3, maxCount)} key={`n-${key}`} />
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
        <Field key={`${key}-${f.key}`} f={f} knowledge={knowledge} />
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

function Field({ f, knowledge }: { f: CatalogEntry["fields"][number]; knowledge: KnowledgeOption[] }) {
  const name = `f_${f.key}`;
  const head = <>{f.label}{f.required ? " *" : ""} {f.hint && f.type !== "select" && <span className="hint">{f.hint}</span>}</>;
  if (f.type === "knowledge" || f.type === "knowledge_multi") {
    return (
      <fieldset className="kpick">
        <legend>{head}</legend>
        {knowledge.length === 0 ? (
          <p className="hint">У «Знаннях» ще немає затверджених документів. Можна передати бриф — команда поверне точні питання, що додати.</p>
        ) : (
          knowledge.map((k) => (
            <label key={k.id} className="check">
              <input type={f.type === "knowledge" ? "radio" : "checkbox"} name={name} value={k.id} />
              <span>{k.title} <span className="hint">{k.kind}</span></span>
            </label>
          ))
        )}
      </fieldset>
    );
  }
  if (f.type === "select") {
    return (
      <label>{head}
        <select name={name} defaultValue={f.required ? f.options?.[0]?.value : ""}>
          {!f.required && <option value="">—</option>}
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (f.type === "textarea" || f.type === "list") {
    return (
      <label>{head}{f.type === "list" && <span className="hint"> · кожен з нового рядка</span>}
        <textarea name={name} rows={3} maxLength={f.type === "list" ? 4000 : f.maxLength ?? 2000} required={f.required} placeholder={f.placeholder} />
      </label>
    );
  }
  const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text";
  return (
    <label>{head}
      <input name={name} type={type} min={f.min} max={f.max} maxLength={type === "text" ? f.maxLength ?? 500 : undefined} required={f.required} placeholder={f.placeholder} />
    </label>
  );
}
