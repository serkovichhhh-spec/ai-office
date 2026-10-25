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

export interface OwnerItem { severity: "critical" | "major" | "minor" | "question"; area: string; text: string }

const CRITERION: Record<string, string> = {
  evidence: "Доказовість", brief_fit: "Відповідність брифу", brand: "Бренд", execution: "Виконуваність", specialist: "Фахова якість",
};

interface PkgLike {
  outcome?: string;
  blocking_questions?: unknown[];
  review?: { verdict?: string; open_issues?: { severity?: string; criterion?: string; problem?: string; fix?: string }[] } | null;
  unsupported_claims?: unknown[];
}

/** What the owner has to answer or provide, most severe first. Raw JSON fragments of the reviewer are not shown. */
export function ownerChecklist(pkg: PkgLike): OwnerItem[] {
  const items: OwnerItem[] = [];
  for (const q of pkg.blocking_questions ?? []) if (str(q)) items.push({ severity: "question", area: "Питання", text: String(q) });
  for (const x of pkg.review?.open_issues ?? []) {
    const text = str(x.fix) ?? str(x.problem);
    if (!text) continue;
    const sev = x.severity === "critical" ? "critical" : x.severity === "major" ? "major" : "minor";
    items.push({ severity: sev, area: CRITERION[String(x.criterion)] ?? String(x.criterion ?? "Зауваження"), text });
  }
  const order = { critical: 0, question: 1, major: 2, minor: 3 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Excluded claims: removed from the copy until the owner confirms them. */
export function excludedClaims(pkg: PkgLike): string[] {
  return (pkg.unsupported_claims ?? []).map((c) => String(c).replace(/\s*\(прибрано з матеріалу\)\s*$/i, "")).filter(Boolean);
}

/** A ready-to-edit answer template for «Доопрацювати». */
export function answerTemplate(items: OwnerItem[]): string {
  return items.map((x, i) => `${i + 1}. ${x.area}: ${x.text.split(/(?<=[.!?])\s/)[0]}\n   Відповідь: `).join("\n");
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
