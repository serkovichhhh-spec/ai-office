import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Sql } from "@/lib/db-core";
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
import { readFile } from "node:fs/promises";
import { runTool } from "@/lib/mcp/server";

const envelope = { task_id: "00000000-0000-4000-8000-000000000001", seat: "strategist", step: "diagnosis", data_class: "internal" };
const sql = { unsafe: vi.fn(async (query: string) => [{ r: query.includes("worker_context")
  ? { workspace: { slug: "pavutyna" }, step: {}, knowledge: [] }
  : query.includes("gateway_claim") ? { claimed: true, attempt_id: "test-attempt", lease_token: "test-lease", envelope }
  : envelope }]) } as unknown as Sql;
beforeEach(() => {
  vi.mocked(readFile).mockRejectedValue(Object.assign(new Error("unreadable skill"), { code: "ENOENT" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("GET succeeds without attachments when skill files cannot be read", async () => {
  const result = await runTool({ sql, tokenHash: "test" }, "office_get_task", { task_id: envelope.task_id });
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toEqual(envelope);
  expect(console.warn).toHaveBeenCalledWith("CMO skill attachment unavailable", { task_id: envelope.task_id, code: "ENOENT" });
});
it("CLAIM preserves the granted lease when skill files cannot be read", async () => {
  const result = await runTool({ sql, tokenHash: "test" }, "office_claim_task", { task_id: envelope.task_id });
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toEqual({ claimed: true, attempt_id: "test-attempt", lease_token: "test-lease", envelope });
  expect(console.warn).toHaveBeenCalled();
});
