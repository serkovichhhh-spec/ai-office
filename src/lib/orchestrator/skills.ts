import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillAttachment {
  key: string;
  version: string;
  sha256: string;
  files: Record<string, string>;
}

const FILES = ["SKILL.md", "checklist.md", "rubric.json", "examples/good.md", "examples/bad.md", "evaluation/golden-briefs.json"] as const;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function needsCmoSkill(envelope: Record<string, unknown>): boolean {
  return envelope.seat === "strategist" && envelope.step === "diagnosis";
}

/** Fixed server-owned paths; executors cannot choose a pack or a workspace context. */
export async function attachCmoSkill<T extends Record<string, unknown>>(envelope: T, workspaceSlug: string, root = process.cwd()): Promise<T & {
  skills?: SkillAttachment[];
  context?: { file: string; version: string; text: string; data_class: string };
}> {
  // v1.0.0 includes PAVUTYNA examples and an internal context snapshot.
  if (!needsCmoSkill(envelope) || workspaceSlug !== "pavutyna" || !["internal", "confidential"].includes(String(envelope.data_class))) return envelope;
  const directory = join(root, "skills/cmo");
  const read = async (file: string) => (await readFile(join(directory, file), "utf8")).replace(/\r\n/g, "\n");
  const files = Object.fromEntries(await Promise.all(FILES.map(async (file) => [file, await read(file)])));
  // Hash is over sorted [path, UTF-8 content] pairs, including all delivered skill files.
  const sha256 = digest(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
  const result = { ...envelope, skills: [{ key: "cmo", version: "1.0.0", sha256, files }] };
  const file = "context/pavutyna.md";
  const text = await read(file);
  return { ...result, context: { file, version: digest(text), text, data_class: "internal" } };
}
