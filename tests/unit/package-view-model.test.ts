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
  it("owner checklist uses the reviewer's fix (not raw JSON), most severe first", () => {
    const items = ownerChecklist(pkg);
    expect(items.map((x) => x.severity)).toEqual(["critical", "major", "minor"]);
    expect(items[0].text).toMatch(/^Додати офіційні специфікації/);
    expect(items.some((x) => x.text.includes("\"width\""))).toBe(false);
    expect(items[1].area).toBe("Виконуваність");
  });
  it("excluded claims and answer template", () => {
    expect(excludedClaims(pkg)).toEqual(["«100+ годин роботи без світла»", "Порівняння з конкурентами"]);
    expect(answerTemplate(ownerChecklist(pkg))).toMatch(/^1\. Доказовість: .+\n {3}Відповідь: /);
  });
  it("one sentence per state", () => {
    expect(ownerState("needs_approval", "escalated", 3).kind).toBe("answer");
    expect(ownerState("needs_approval", "ready_for_approval", 0).kind).toBe("approve");
    expect(ownerState("running", undefined, 0, "Claude працює").text).toBe("Claude працює");
    expect(ownerState("handoff_queued", undefined, 0).kind).toBe("done");
  });
});
