import { z } from 'zod';
const text = (max=2000) => z.string().trim().min(1).max(max);
export const KnowledgeRef = z.strictObject({record_id:text(100),version:text(100),pointer:text(500)});
export const WebSource = z.strictObject({
  url:z.url().refine(v=>v.startsWith('https://'), 'HTTPS source required'),
  title:text(300),accessed_at:z.iso.date(),
});
export const BriefDiagnosisSchema = z.strictObject({
  real_task:text(),audience_tension:text(),
  what_we_know:z.array(z.strictObject({statement:text(),refs:z.array(KnowledgeRef).min(1)})).max(30),
  what_we_dont_know:z.array(text(500)).max(20),
  questions_to_owner:z.array(text(500)).max(5),
  recommended_depth:z.enum(['light','standard','deep']),
});
export const KnowledgeCandidateSchema = z.strictObject({
  kind:z.enum(['fact','market','insight','case','argument','result','rejected_idea','taste_rule']),
  title:text(200),claim:text(2000),confidence:z.enum(['verified','reported','assumption']),
  sources:z.array(WebSource).max(12),valid_until:z.iso.date().nullable(),
  why_it_matters:text(500),owner_question:z.string().max(500),
}).superRefine((v,c)=>{
  if(v.confidence==='verified' && !v.sources.length) c.addIssue({code:'custom',message:'verified needs a source'});
  if(v.confidence==='assumption' && !v.owner_question.trim()) c.addIssue({code:'custom',message:'assumption needs owner_question'});
});
export const KnowledgeCandidatesSchema = z.strictObject({
  status:z.enum(['ready','blocked']),summary:text(),
  candidates:z.array(KnowledgeCandidateSchema).max(12),blocking_questions:z.array(text(500)).max(10),
}).superRefine((v,c)=>{
  if(v.status==='ready' && (v.candidates.length<3 || v.blocking_questions.length)) c.addIssue({code:'custom',message:'ready needs at least three candidates and no blocking questions'});
  if(v.status==='blocked' && !v.blocking_questions.length) c.addIssue({code:'custom',message:'blocked needs a precise question'});
});
const Test = z.strictObject({pass:z.boolean(),note:text(500)});
export const ChallengeReportSchema = z.strictObject({
  reviewed_artifact_id:text(100),reviewed_version:z.number().int().positive(),
  concepts:z.array(z.strictObject({concept_id:text(100),tests:z.strictObject({swap:Test,three_second:Test,banality:Test,proof:Test,talkability:Test}),
    verdict:z.enum(['strong','workable','weak']),one_line_reason:text(300),needs_fact:z.array(text(500)).max(20)})).min(1).max(30),
  stronger_alternative:z.strictObject({headline:text(500),idea:text(),why_stronger:text(),needs_fact:z.array(text(500)).max(20)}).nullable(),
  recommendation:z.enum(['proceed','proceed_with_alternative','rethink']),
}).superRefine((v,c)=>{
  if(v.concepts.some(x=>x.verdict==='weak') && !v.stronger_alternative) c.addIssue({code:'custom',message:'weak concept needs stronger_alternative'});
  if(new Set(v.concepts.map(x=>x.concept_id)).size!==v.concepts.length) c.addIssue({code:'custom',message:'duplicate concept_id'});
});
export type BriefDiagnosis = z.infer<typeof BriefDiagnosisSchema>;
export type ChallengeReport = z.infer<typeof ChallengeReportSchema>;
