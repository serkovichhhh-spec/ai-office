export interface StepRow {
  id: string;
  run_id: string;
  workspace_id: string;
  step_key: string;
  agent_role: string;
  cycle: number;
  attempt: number;
  input: Record<string, unknown>;
  agent_response?: { schemaName: string; output: unknown } | null;
}

export interface BriefRow {
  id: string;
  title: string;
  objective: string;
  audience: string;
  channel: string;
  deliverable_count: number;
  deliverables: unknown[];
  references: unknown[];
  acceptance_criteria: unknown[];
  deadline: string | null;
  priority: string;
  playbook_key: string;
  /** Playbook-specific brief fields (PlaybookSpec.briefFields). */
  fields?: Record<string, unknown>;
}

export interface AgentRow {
  role_key: string;
  display_name: string;
  model_tier: "fast" | "balanced" | "strong";
  system_prompt: string;
  provenance: string;
  enabled: boolean;
}

export interface KnowledgeItem {
  /** Record id and content version (12-char hash) — what KnowledgeRef cites. */
  id?: string;
  version?: string;
  title: string;
  kind: string;
  body: string;
  source_url: string | null;
  freshness_date: string | null;
}

export interface ArtifactItem {
  id?: string;
  hash?: string;
  kind: string;
  version: number;
  content: unknown;
}

/** Shape returned by office.worker_context(step_id). */
export interface StepContext {
  step: StepRow;
  run: { id: string; revision: number; playbook_key: string; playbook_version?: number; budget_usd: string | number; cost_usd: string | number; skill_pins?: import("./skills").SkillPins };
  brief: BriefRow;
  workspace: { id: string; slug: string; name: string };
  agent: AgentRow | null;
  knowledge: KnowledgeItem[];
  artifacts: ArtifactItem[];
}

export interface NextStep {
  step_key: string;
  agent_role: string;
  input?: Record<string, unknown>;
  depends_on?: string[];
  /** Executor for this step (claude_session | chatgpt | human); defaults to the seat's configured executor. */
  executor?: string;
  independent_of_step?: string;
  requires?: string[];
}

/** Payload for office.worker_complete. */
export interface StepResult {
  skill_pins?: import("./skills").SkillPins;
  output: unknown;
  provider: string;
  model: string | null;
  usage: { tokens_in: number; tokens_out: number; cost_usd: number };
  artifacts: Array<{ kind: string; title: string; content: unknown }>;
  next_steps: NextStep[];
  run_status: "needs_approval" | "needs_input" | null;
  activity: string;
  message: string;
}
