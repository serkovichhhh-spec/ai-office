/** Explicit workspace rollout. Existing pinned runs remain executable regardless of this flag. */
export function planV1Enabled(slug: string): boolean {
  const enabled = (process.env.OFFICE_PLAN_V1_WORKSPACES ?? 'sandbox').split(',').map(s=>s.trim());
  return enabled.includes(slug);
}

export function filesEnabledForWorkspace(slug:string):boolean {
  return (process.env.OFFICE_FILE_WORKSPACES??'sandbox').split(',').map(s=>s.trim()).includes(slug);
}

export function programEngineEnabledForWorkspace(slug:string):boolean {
  return (process.env.OFFICE_PROGRAM_WORKSPACES??'').split(',').map(s=>s.trim()).filter(Boolean).includes(slug);
}
