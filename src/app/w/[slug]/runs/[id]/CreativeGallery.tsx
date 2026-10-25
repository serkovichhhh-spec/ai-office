"use client";
import { useState } from "react";
import type { CopyView, CreativeView, FormatView } from "@/lib/ui/package-view-model";
import { SectionView } from "./SectionView";

/** Schematic layout preview at the real aspect ratio. Not a final design: no generated images yet. */
function Mockup({ f, c }: { f: FormatView; c?: CopyView }) {
  const tall = f.h / f.w > 1.4;
  const box = f.w >= f.h ? { width: 188 } : { height: 228, width: Math.round((228 * f.w) / f.h) };
  return (
    <figure className="mock-wrap">
      <div className={`mock${tall ? " tall" : ""}`} style={{ ...box, aspectRatio: `${f.w} / ${f.h}` }} aria-label={`Схема макета ${f.ratio}`}>
        {tall && <div className="mock-safe" aria-hidden="true" />}
        <div className="mock-in">
        <div className="mock-brand" aria-hidden="true"><span className="mock-dot" />PAVUTYNA</div>
        <div className="mock-text">
          <b>{c?.headline ?? "Заголовок"}</b>
          {c?.body && <span>{c.body}</span>}
        </div>
        <div className="mock-foot">
          {c?.cta ? <div className="mock-cta">{c.cta}</div> : <span />}
          <div className="mock-mascot" aria-hidden="true">маскот</div>
        </div>
        {f.isVideo && <div className="mock-play" aria-hidden="true">▶</div>}
        </div>
      </div>
      <figcaption>
        <b>{f.ratio}</b>{f.px ? ` · ${f.px}` : ""}
        {f.placement && <span className="muted"> · {f.placement}</span>}
      </figcaption>
    </figure>
  );
}

function Creative({ cr, n }: { cr: CreativeView; n: number }) {
  const [v, setV] = useState(0);
  const copy = cr.copy[v];
  return (
    <article className="creative">
      <header className="creative-head">
        <span className="creative-n">{n}</span>
        <div>
          <h3>{cr.title}</h3>
          {cr.idea && <p className="small muted">{cr.idea}</p>}
        </div>
      </header>

      {cr.copy.length > 1 && (
        <div className="variant-tabs" role="tablist" aria-label="Варіанти тексту">
          {cr.copy.map((c, i) => (
            <button key={i} role="tab" aria-selected={i === v} className={i === v ? "on" : ""} onClick={() => setV(i)} type="button">
              Варіант {String.fromCharCode(65 + i)}
            </button>
          ))}
        </div>
      )}

      <div className="mock-row">{cr.formats.map((f) => <Mockup key={f.key} f={f} c={copy} />)}</div>

      {copy && (
        <dl className="copy-lines">
          <div><dt>Заголовок</dt><dd>{copy.headline}</dd></div>
          {copy.body && <div><dt>Текст</dt><dd>{copy.body}</dd></div>}
          {copy.cta && <div><dt>Кнопка</dt><dd>{copy.cta}</dd></div>}
          {copy.destination && <div><dt>Куди веде</dt><dd>{copy.destination}</dd></div>}
        </dl>
      )}

      <details className="quiet">
        <summary>ТЗ для дизайнера</summary>
        {cr.visual && <p className="small" style={{ margin: "8px 0" }}><b>Візуал:</b> {cr.visual}</p>}
        <SectionView content={cr.details} />
      </details>
    </article>
  );
}

export function CreativeGallery({ items }: { items: CreativeView[] }) {
  return (
    <div className="gallery">
      {items.map((cr, i) => <Creative key={cr.key} cr={cr} n={i + 1} />)}
      <p className="small muted">Це схеми розкладки в реальних пропорціях, а не фінальний дизайн. Готові зображення зʼявляться, коли підключимо генерацію картинок.</p>
    </div>
  );
}
