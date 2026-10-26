/**
 * Turns a canonical Package.v1 (or a draft artifact) into what the owner needs to see first:
 * what to decide, what is missing, and the creatives as visual previews. Pure functions — unit-tested.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export interface FormatView { key: string; label: string; w: number; h: number; ratio: string; px?: string; placement?: string; isVideo: boolean }
export interface CopyView { headline: string; body?: string; cta?: string; destination?: string }
export interface CreativeView {
  key: string;
  title: string;
  idea?: string;
  visual?: string;
  copy: CopyView[];
  formats: FormatView[];
  /** Everything else, for the designer (shown collapsed). */
  details: Obj;
}

function ratioOf(f: Obj): { w: number; h: number; ratio: string } | null {
  const ar = str(f.aspect_ratio);
  const m = ar?.match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/);
  if (m) return { w: Number(m[1]), h: Number(m[2]), ratio: ar! };
  const w = Number(f.width), h = Number(f.height);
  if (w > 0 && h > 0) {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const d = g(Math.round(w), Math.round(h)) || 1;
    return { w, h, ratio: `${Math.round(w) / d}:${Math.round(h) / d}` };
  }
  return null;
}

function copyOf(o: Obj): CopyView | null {
  const headline = str(o.headline) ?? str(o.hook) ?? str(o.title);
  if (!headline) return null;
  return { headline, body: str(o.body) ?? str(o.copy) ?? str(o.caption) ?? str(o.subline), cta: str(o.cta), destination: str(o.destination) };
}

/** Recognises creative-like items (graphic packs, social posts, OOH concepts). Returns null when the section is not visual. */
export function creativesFrom(content: unknown): CreativeView[] | null {
  if (!Array.isArray(content) || content.length === 0 || !content.every(isObj)) return null;
  const out: CreativeView[] = [];
  content.forEach((item: Obj, i) => {
    const design = isObj(item.design) ? item.design : item;
    const concept = isObj(design.concept) ? design.concept : isObj(item.concept) ? (item.concept as Obj) : {};
    const copies = (Array.isArray(design.copy) ? design.copy : Array.isArray(item.copy_variants) ? item.copy_variants : [design])
      .filter(isObj).map(copyOf).filter((c): c is CopyView => !!c);
    const rawFormats = (Array.isArray(design.formats) ? design.formats : Array.isArray(item.formats) ? item.formats : []).filter(isObj);
    const formats: FormatView[] = rawFormats.map((f, j): FormatView | null => {
      const r = ratioOf(f);
      if (!r) return null;
      const placement = str(f.placement) ?? str(f.channel);
      const px = Number(f.width) > 0 && Number(f.height) > 0 ? `${Number(f.width)}×${Number(f.height)}` : undefined;
      return { key: String(f.id ?? j), label: placement ? `${r.ratio} · ${placement}` : r.ratio, placement, px, isVideo: Number(f.duration_seconds) > 0, ...r };
    }).filter((f): f is FormatView => f !== null);
    if (copies.length === 0 && formats.length === 0) return;
    const title = str(concept.title) ?? str(item.title) ?? str(item.concept_title) ?? copies[0]?.headline ?? `Креатив ${i + 1}`;
    const { copy: _c, formats: _f, concept: _k, id: _i, ...rest } = design;
    void _c; void _f; void _k; void _i;
    out.push({
      key: String(item.id ?? i),
      title,
      idea: str(concept.idea) ?? str(item.idea) ?? str(item.big_idea),
      visual: str(concept.visual_direction) ?? str(design.composition) ?? str(item.visual),
      copy: copies,
      formats: formats.length ? formats : [{ key: "default", label: "1:1", w: 1, h: 1, ratio: "1:1", isVideo: false }],
      details: { ...rest, ...(design !== item ? Object.fromEntries(Object.entries(item).filter(([k]) => k !== "design" && k !== "id")) : {}) },
    });
  });
  return out.length ? out : null;
}

export type Severity = "critical" | "major" | "minor" | "question";
export interface OwnerItem {
  severity: Severity;
  /** Short topic title («Трекінг-коди»), or the reviewer criterion for items without a topic. */
  area: string;
  /** One short line: what is missing. */
  text: string;
  /** Proposed answers, the first is the default used by the template. */
  answers: string[];
  /** How many raw questions/issues were merged into this item. */
  merged: number;
}

const CRITERION: Record<string, string> = {
  evidence: "Доказовість", brief_fit: "Відповідність брифу", brand: "Бренд", execution: "Виконуваність", specialist: "Фахова якість",
};

/** Recurring owner topics with ready answers. Order matters: the first match wins. */
export const TOPICS: { key: string; title: string; match: RegExp; answers: string[] }[] = [
  { key: "specs", title: "Специфікації форматів", match: /специфікац|pinned|safe.?area|офіційн\S* вимог/i,
    answers: ["Бери затверджені знання «Специфікації форматів Meta» і «Google Ads і TikTok». Для Telegram офіційних вимог немає — адаптуй із 9:16."] },
  { key: "assets", title: "Лого й маскот", match: /лого|маскот|asset/i,
    answers: ["Файли є в знанні «Бібліотека бренд-ассетів ПАВУТИНИ»: pavutyna.logo.white і pavutyna.mascot з їхніми версіями. Права підтверджую."] },
  { key: "tracking", title: "Трекінг-коди", match: /трекінг|l\.pavutyna|\bкод/i,
    answers: ["Залиш l.pavutyna.com/s/<код> як заглушку — коди проставимо при запуску. Не блокер.", "Коди: "] },
  { key: "promo", title: "Чинність акцій", match: /чинн|діють|актуальн|флайт|промо/i,
    answers: ["Акції чинні за знанням «Тарифи й акції (жовтень–грудень 2026)». Фінальна перевірка — перед запуском, не блокер.", "Акцію «…» не використовувати."] },
  { key: "legal", title: "Юридичний текст", match: /юрид|юрист|юрблок|кегль|умов/i,
    answers: ["На креативі коротка виноска «*Умови акції — на pavutyna.ua», повні умови — на посадковій сторінці.", "Повні умови на креативі, мінімальний кегль — "] },
  { key: "geo", title: "Гео", match: /гео|таргетинг|київ/i, answers: ["Київ і Київська область, лише адреси в зоні покриття."] },
  { key: "video", title: "Відео", match: /відео|покадров|reels|shorts|tiktok/i,
    answers: ["Зараз тільки статика. Відео — окремим брифом.", "Потрібні й відео: "] },
  { key: "placements", title: "Плейсменти", match: /плейсмент|площин|telegram|google|youtube|gdn|responsive|формат\S* поставки/i,
    answers: ["Meta: стрічка 1:1 і 4:5, Stories/Reels 9:16. Telegram, Google і YouTube — не в цьому пакеті.", "Meta + Google адаптивні медійні (1200×628 і 1200×1200, без тексту на фото)."] },
];
const GENERIC = ["Вирішуй сам за брифом і знаннями — не блокуй.", "Прибери це з матеріалу."];

interface PkgLike {
  outcome?: string;
  blocking_questions?: unknown[];
  review?: { verdict?: string; open_issues?: { severity?: string; criterion?: string; problem?: string; fix?: string }[] } | null;
  unsupported_claims?: unknown[];
}

/** «[Відповідальний: …; строк: …] Надайте…» → «Надайте…»; first sentence, ≤ 160 chars. */
export function shortText(t: string): string {
  const clean = t.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0];
  return first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, "") + "…" : first;
}

const RANK: Record<Severity, number> = { critical: 0, question: 1, major: 2, minor: 3 };

/** What the owner has to answer, merged into topics with ready answers, most severe first. */
export function ownerChecklist(pkg: PkgLike): OwnerItem[] {
  const raw: { severity: Severity; area: string; text: string }[] = [];
  for (const q of pkg.blocking_questions ?? []) if (str(q)) raw.push({ severity: "question", area: "Питання", text: String(q) });
  for (const x of pkg.review?.open_issues ?? []) {
    const text = str(x.fix) ?? str(x.problem);
    if (!text) continue;
    raw.push({ severity: x.severity === "critical" ? "critical" : x.severity === "major" ? "major" : "minor",
      area: CRITERION[String(x.criterion)] ?? String(x.criterion ?? "Зауваження"), text });
  }
  const byTopic = new Map<string, OwnerItem>();
  const loose: OwnerItem[] = [];
  for (const r of raw) {
    const topic = TOPICS.find((t) => t.match.test(r.text));
    if (!topic) { loose.push({ severity: r.severity, area: r.area, text: shortText(r.text), answers: GENERIC, merged: 1 }); continue; }
    const prev = byTopic.get(topic.key);
    if (!prev) byTopic.set(topic.key, { severity: r.severity, area: topic.title, text: shortText(r.text), answers: topic.answers, merged: 1 });
    else {
      prev.merged++;
      if (RANK[r.severity] < RANK[prev.severity]) { prev.severity = r.severity; prev.text = shortText(r.text); }
    }
  }
  const order = TOPICS.map((t) => t.title);
  return [...byTopic.values(), ...loose].sort((a, b) => RANK[a.severity] - RANK[b.severity] || order.indexOf(a.area) - order.indexOf(b.area));
}

/** Excluded claims: removed from the copy until the owner confirms them. */
export function excludedClaims(pkg: PkgLike): string[] {
  return (pkg.unsupported_claims ?? []).map((c) => String(c).replace(/\s*\(прибрано з матеріалу\)\s*$/i, "")).filter(Boolean);
}

/** «Доопрацювати» comment prefilled with the default answers — the owner only edits what is different. */
export function answerTemplate(items: OwnerItem[]): string {
  return items.map((x, i) => `${i + 1}. ${x.area}: ${x.answers[0]}`).join("\n");
}

export type OwnerState =
  | { kind: "working"; text: string }
  | { kind: "approve"; text: string }
  | { kind: "answer"; text: string; count: number }
  | { kind: "done"; text: string }
  | { kind: "stopped"; text: string };

export function ownerState(runStatus: string, outcome: string | undefined, count: number, working?: string): OwnerState {
  if (runStatus === "queued" || runStatus === "running") return { kind: "working", text: working ?? "Команда працює над брифом" };
  if (runStatus === "needs_approval") {
    if (!outcome || outcome === "ready_for_approval") return { kind: "approve", text: "Пакет готовий. Переглянь креативи й затверди або поверни з коментарем." };
    return { kind: "answer", count, text: count
      ? `Потрібні твої відповіді (${count}). Затвердити поки не можна: дай відповіді нижче й натисни «Доопрацювати».`
      : "Рецензент не може пропустити пакет без твого рішення. Поверни на доопрацювання з коментарем або відхили." };
  }
  if (runStatus === "approved" || runStatus === "handoff_queued") return { kind: "done", text: "Затверджено. Задача з’явилась у CMO Space → «Виконання»." };
  if (runStatus === "cancelled") return { kind: "stopped", text: "Запуск скасовано." };
  if (runStatus === "failed") return { kind: "stopped", text: "Запуск зупинився з помилкою — деталі внизу." };
  return { kind: "working", text: runStatus };
}
