import type { OwnerItem, OwnerState } from "@/lib/ui/package-view-model";

export interface ChainStep { key: string; label: string; state: "done" | "active" | "wait" | "bad" }

const SEV: Record<OwnerItem["severity"], string> = { critical: "Критично", question: "Питання", major: "Важливо", minor: "Дрібниця" };

/** Top of the run page: one sentence about what the owner has to do, plus the progress chain. */
export function OwnerBanner({ state, chain }: { state: OwnerState; chain: ChainStep[] }) {
  const tone = state.kind === "approve" ? "go" : state.kind === "answer" ? "ask" : state.kind === "done" ? "ok" : state.kind === "stopped" ? "bad" : "work";
  const title = { working: "Зараз працює команда", approve: "Потрібне твоє рішення", answer: "Потрібні твої відповіді", done: "Готово", stopped: "Зупинено" }[state.kind];
  return (
    <section className={`owner-banner ${tone}`} aria-live="polite">
      <div>
        <p className="owner-kicker">{title}</p>
        <p className="owner-text">{state.text}</p>
      </div>
      {chain.length > 0 && (
        <ol className="chain" aria-label="Етапи">
          {chain.map((c) => <li key={c.key} className={c.state}><span aria-hidden="true" />{c.label}</li>)}
        </ol>
      )}
    </section>
  );
}

export function OwnerChecklist({ items, excluded, reviewSummary }: { items: OwnerItem[]; excluded: string[]; reviewSummary?: string }) {
  if (!items.length && !excluded.length) return null;
  const top = items.slice(0, 6);
  const rest = items.slice(6);
  const row = (x: OwnerItem, i: number) => (
    <li key={i} className={`todo ${x.severity}`}>
      <span className="sev">{SEV[x.severity]}</span>
      <div><span className="muted small">{x.area}</span><p>{x.text}</p></div>
    </li>
  );
  return (
    <section className="panel" aria-labelledby="todo-title">
      <div className="panel-head"><h2 id="todo-title">Що від тебе потрібно</h2>{items.length > 0 && <span className="muted small">{items.length} пунктів</span>}</div>
      {reviewSummary && <p className="small muted" style={{ marginBottom: 10 }}>Рецензент: {reviewSummary}</p>}
      {top.length > 0 && <ol className="todos">{top.map(row)}</ol>}
      {rest.length > 0 && (
        <details className="quiet"><summary>Ще {rest.length}</summary><ol className="todos">{rest.map((x, i) => row(x, i + 6))}</ol></details>
      )}
      {excluded.length > 0 && (
        <details className="quiet">
          <summary>Прибрано з текстів, поки не підтвердиш ({excluded.length})</summary>
          <ul className="small">{excluded.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p className="small muted">Якщо щось із цього правда — напиши в коментарі, і команда поверне це в тексти.</p>
        </details>
      )}
    </section>
  );
}
