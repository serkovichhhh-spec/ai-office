import { describe, expect, it } from "vitest";
import pkg from "../fixtures/graphic-pack.json";
import { answerTemplate, creativesFrom, excludedClaims, ownerChecklist, ownerState } from "../../src/lib/ui/package-view-model";

const creatives = pkg.sections.find((s) => s.kind === "creatives")!.content;

describe("package view model (run page 1.3)", () => {
  it("turns graphic pack creatives into visual previews with real ratios", () => {
    const c = creativesFrom(creatives)!;
    expect(c).toHaveLength(2);
    expect(c[0].title).toBe("Місто в темряві — ПАВУТИНА світить");
    expect(c[0].copy.map((x) => x.headline)).toEqual(["ІНТЕРНЕТ ПРАЦЮЄ БЕЗ СВІТЛА", "КОЛИ ГАСНЕ СВІТЛО — ПАВУТИНА ТРИМАЄ ЗВ'ЯЗОК"]);
    expect(c[0].formats.map((f) => [f.ratio, f.px])).toEqual([["1:1", "1080×1080"], ["4:5", "1080×1350"], ["9:16", "1080×1920"]]);
    expect(c[0].details).not.toHaveProperty("copy");
    expect(c[0].details).not.toHaveProperty("id");
    expect(c[0].details).toHaveProperty("file_naming");
  });
  it("derives a ratio from pixel size and ignores non-visual sections", () => {
    expect(creativesFrom([{ headline: "A", formats: [{ width: 1200, height: 628 }] }])![0].formats[0].ratio).toBe("300:157");
    expect(creativesFrom(["рядок"])).toBeNull();
    expect(creativesFrom([{ statement: "x", validation: "y" }])).toBeNull();
    expect(creativesFrom("text")).toBeNull();
  });
  it("owner checklist: topics with ready answers, most severe first, no raw JSON", () => {
    const items = ownerChecklist(pkg);
    expect(items.map((x) => [x.severity, x.area])).toEqual([["critical", "Специфікації форматів"], ["major", "Лого й маскот"], ["minor", "Юридичний текст"]]);
    expect(items.every((x) => x.answers.length > 0)).toBe(true);
    expect(items.some((x) => x.text.includes("\"width\""))).toBe(false);
  });
  it("merges the real 9-item escalation into a few topics and strips «[Відповідальний…]»", () => {
    const real = {
      blocking_questions: [
        "[Відповідальний: власник/бренд-менеджер; строк: 2026-10-28] Надайте оригінальні файли білого лого та маскота з реальними asset_id, версіями й підтвердженням прав.",
        "[Відповідальний: ads_specialist; строк: 2026-10-28] Згенеруйте коди l.pavutyna.com/s/<код> для кожної пари креатив × плейсмент (3 креативи × Instagram/Facebook feed, stories, Telegram).",
        "[Відповідальний: власник; строк: 2026-10-28] Підтвердіть, що «НЕЗЛАМНИЙ ГІГАБІТ» і «Поторгуємось?» діють увесь період кампанії.",
        "[Відповідальний: юрист; строк: 2026-10-28] Погодьте скорочені умови акцій для банера та мінімальний кегль/кількість рядків юрблоку, або рішення винести повні умови на посадкову.",
        "[Відповідальний: ads_specialist; строк: 2026-10-28] Підтвердіть точний список плейсментів і надайте чинні офіційні вимоги Meta/Telegram (як pinned knowledge) для розмірів, ваги, safe-area.",
      ],
      review: { open_issues: [
        { severity: "critical", criterion: "evidence", fix: "Або додати чинне pinned knowledge з офіційними специфікаціями Meta/Telegram і коректні refs для кожного формату." },
        { severity: "major", criterion: "execution", fix: "Отримати від власника реальні ідентифікатори/версії оригінальних файлів лого й маскота з підтвердженими правами." },
        { severity: "major", criterion: "execution", fix: "Додати як блокери з відповідальними: підтвердження чинності обох промо на період флайту, юридичне погодження умов." },
        { severity: "major", criterion: "specialist", fix: "Розробити здійсненну мобільну композицію юридичного блоку для 1:1, 4:5 і 9:16." },
      ] },
    };
    const items = ownerChecklist(real);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.map((x) => x.area).sort()).toEqual(["Лого й маскот", "Специфікації форматів", "Трекінг-коди", "Чинність акцій", "Юридичний текст"].sort());
    expect(items.some((x) => x.text.startsWith("["))).toBe(false);
    expect(items.find((x) => x.area === "Лого й маскот")!.merged).toBe(2);
  });
  it("excluded claims and a template prefilled with default answers", () => {
    expect(excludedClaims(pkg)).toEqual(["«100+ годин роботи без світла»", "Порівняння з конкурентами"]);
    const t = answerTemplate(ownerChecklist(pkg));
    expect(t.split("\n")[0]).toMatch(/^1\. Специфікації форматів: Бери затверджені знання/);
    expect(t).not.toMatch(/Відповідь:\s*$/m);
  });
  it("one sentence per state", () => {
    expect(ownerState("needs_approval", "escalated", 3).kind).toBe("answer");
    expect(ownerState("needs_approval", "ready_for_approval", 0).kind).toBe("approve");
    expect(ownerState("running", undefined, 0, "Claude працює").text).toBe("Claude працює");
    expect(ownerState("handoff_queued", undefined, 0).kind).toBe("done");
  });
});
