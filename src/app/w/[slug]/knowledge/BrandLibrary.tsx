import manifest from "../../../../../public/brand/pavutyna/manifest.json";

/** Brand asset library: files every agent gets with stable asset_id + version (also in knowledge «Бібліотека бренд-ассетів»). */
export function BrandLibrary() {
  const files = manifest.assets.filter((a) => a.kind === "asset");
  const refs = manifest.assets.filter((a) => a.kind === "ref");
  return (
    <section className="panel" aria-labelledby="brand-title" style={{ gridColumn: "1 / -1" }}>
      <div className="panel-head">
        <h2 id="brand-title">Бренд-ассети</h2>
        <span className="muted small">Агенти отримують їх у кожній задачі автоматично — прикріплювати не треба</span>
      </div>
      <div className="brand-grid">
        {files.map((a) => (
          <figure key={a.id} className="brand-tile">
            <a href={a.url} target="_blank" rel="noreferrer" className="brand-img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/brand/pavutyna/${a.file}`} alt={a.title} loading="lazy" />
            </a>
            <figcaption><b>{a.title}</b><code>{a.id}</code></figcaption>
          </figure>
        ))}
      </div>
      <details className="quiet">
        <summary>Еталонні макети ({refs.length})</summary>
        <div className="brand-grid refs">
          {refs.map((a) => (
            <figure key={a.id} className="brand-tile">
              <a href={a.url} target="_blank" rel="noreferrer" className="brand-img photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/pavutyna/${a.file}`} alt={a.title} loading="lazy" />
              </a>
              <figcaption><b>{a.title.replace(/^Еталон: /, "")}</b></figcaption>
            </figure>
          ))}
        </div>
      </details>
      <p className="small muted" style={{ marginTop: 10 }}>
        Шрифт: {manifest.fonts.brand_font} → {manifest.fonts.substitute}. Оригінали — <a href={manifest.drive_originals} target="_blank" rel="noreferrer">Google Drive, pavutyna_design</a>.
        Новий файл додається в бібліотеку через CTO (стабільний asset_id і версія).
      </p>
    </section>
  );
}
