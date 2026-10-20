import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import type { KnowledgeCandidateRow } from "@/lib/queries";

vi.mock("@/app/actions", () => ({ reviewKnowledgeCandidateAction: async () => ({ ok: true }) }));
import { ResearchCandidates } from "@/app/w/[slug]/knowledge/ResearchCandidates";
import { attachCmoSkill } from "@/lib/orchestrator/skills";

const row: KnowledgeCandidateRow = { id: "00000000-0000-4000-8000-000000000001", title: "Факт на перевірці", claim: "Підтвердіть це твердження.", confidence: "reported",
  sources: [{ url: "https://example.test/source", title: "Першоджерело", accessed_at: "2026-10-20", quote: "<script>untrusted</script>" }],
  why_it_matters: "Це змінює рішення щодо кампанії.", owner_question: null, data_class: "internal", status: "candidate", valid_until: null,
  review_note: "", created_at: "2026-10-20", run_id: "run-test", research_artifact_id: "artifact-test", approved_doc_id: null, review_hash: "abcdef0123456789abcdef0123456789" };

describe("research review interface", () => {
  const render = (isOwner: boolean, candidate = row) => renderToStaticMarkup(createElement(ResearchCandidates, { rows: [candidate], isOwner, slug: "pavutyna" }));
  it("shows sources and owner decisions while escaping source text", () => {
    const html = render(true);
    expect(html).toContain("Схвалити й додати до знань");
    expect(html).toContain('href="https://example.test/source"');
    expect(html).toContain("&lt;script&gt;untrusted&lt;/script&gt;");
  });
  it("hides decisions for viewers and for already reviewed candidates", () => {
    expect(render(false)).not.toContain("Схвалити й додати до знань");
    expect(render(true, { ...row, status: "approved" })).not.toContain("Схвалити й додати до знань");
  });
  it("never links unsafe sources", () => {
    const html = render(false, { ...row, sources: [{ url: "javascript:alert(1)", title: "Непридатне джерело", accessed_at: "" }] });
    expect(html).not.toContain('href="javascript:');
  });
  it("uses supplied live knowledge instead of the static snapshot", async () => {
    const text = "<knowledge>Current approved records only</knowledge>";
    const attached = await attachCmoSkill({ seat: "strategist", step: "diagnosis", data_class: "internal" }, "pavutyna", process.cwd(), text);
    expect(attached.context?.text).toBe(text);
  });
});
