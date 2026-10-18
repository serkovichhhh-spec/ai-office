import { z } from "zod";

export const StrategySchema = z.object({
  summary: z.string().min(1).max(1500),
  angles: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        insight: z.string().min(1).max(600),
        hook_idea: z.string().min(1).max(300),
        why_it_works: z.string().min(1).max(500),
        // Titles of approved knowledge docs used; empty means "no factual claim relied on".
        evidence: z.array(z.string().max(200)).max(10),
      }),
    )
    .min(1)
    .max(10),
  open_questions: z.array(z.string().max(300)).max(10),
});
export type Strategy = z.infer<typeof StrategySchema>;

export const ScriptsSchema = z.object({
  scripts: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        angle: z.string().min(1).max(120),
        duration_sec: z.number().int().min(5).max(180),
        hook: z.string().min(1).max(300),
        scenes: z
          .array(
            z.object({
              shot: z.string().min(1).max(400),
              on_screen_text: z.string().max(200),
              voiceover: z.string().max(600),
            }),
          )
          .min(1)
          .max(15),
        cta: z.string().min(1).max(200),
        claims_needing_source: z.array(z.string().max(300)).max(10),
      }),
    )
    .min(1)
    .max(10),
});
export type Scripts = z.infer<typeof ScriptsSchema>;

export const ReviewSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  summary: z.string().min(1).max(1500),
  issues: z
    .array(
      z.object({
        script_index: z.number().int().min(0).max(20),
        severity: z.enum(["low", "medium", "high"]),
        issue: z.string().min(1).max(500),
        fix: z.string().max(500),
      }),
    )
    .max(30),
  unsupported_claims: z.array(z.string().max(300)).max(20),
});
export type Review = z.infer<typeof ReviewSchema>;
