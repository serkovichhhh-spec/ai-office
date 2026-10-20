import { expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn(async () => [{ enabled: false }]) }));
vi.mock("@/lib/db", () => ({ db: () => ({}), asUser: async (_db: unknown, _user: string, fn: (tx: unknown) => unknown) => fn(query) }));
import { listKnowledgeCandidates } from "@/lib/queries";

it("keeps the page available on 0008 without querying absent candidate tables", async () => {
  expect(await listKnowledgeCandidates("test-user", "test-workspace")).toEqual({ enabled: false, rows: [] });
  expect(query).toHaveBeenCalledTimes(1);
});
