# Бібліотека бренду

Бренд-ассети живуть у репозиторії: `public/brand/<бренд>/` і віддаються сайтом за постійними URL
(`https://ai-office-red.vercel.app/brand/pavutyna/...`). Агенти отримують їх через затверджене знання
«Бібліотека бренд-ассетів ПАВУТИНИ» в кожній задачі, без прикріплення до брифу.

- `assets/` — маскот, лого, локапи, іконки, світіння (прозорі PNG, обрізані).
- `refs/` — еталонні макети (стиль, не тексти й ціни).
- `fonts/` — Montserrat Italic як заміна Geometria.
- `manifest.json` — стабільні `asset_id` і `version` (перші 12 символів sha256 файлу).
- `knowledge.txt`, `brandbook.txt` — тексти знань для агентів.

Додати чи замінити файл: покласти в `assets/` або `refs/` → додати рядок у `META` в `scripts/brand-manifest.py` →
`python3 scripts/brand-manifest.py pavutyna` → оновити знання «Бібліотека бренд-ассетів» текстом із `knowledge.txt`.
Новий файл = нова `version`, тож старі пакети посилаються на попередню версію чесно.

Оригінали (RAR, PDF, PSD) — Google Drive власника, папка `pavutyna_design`.
