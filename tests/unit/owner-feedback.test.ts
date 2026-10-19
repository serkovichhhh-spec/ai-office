import { describe, expect, it } from "vitest";
import { carryOwner, feedbackParts, ownerBlock } from "@/lib/orchestrator/prompting";

describe("owner feedback carry-over", () => {
  it("keeps the owner comment alongside reviewer notes in later rounds", () => {
    const input = { owner_feedback: "Третя ідея — не туди", reviewer_feedback: "#1 [high] ...", review_loop: 2 };
    const parts = feedbackParts(input);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("КОМЕНТАР ВЛАСНИКА");
    expect(parts[0]).toContain("Третя ідея — не туди");
    expect(carryOwner(input)).toEqual({ owner_feedback: "Третя ідея — не туди" });
  });
  it("adds nothing when there is no owner comment", () => {
    expect(carryOwner({ review_loop: 0 })).toEqual({});
    expect(ownerBlock({ owner_feedback: "  " })).toBe("");
    expect(feedbackParts({ reviewer_feedback: "x" })).toEqual(["Зауваження рев'юера:\nx"]);
  });
});
