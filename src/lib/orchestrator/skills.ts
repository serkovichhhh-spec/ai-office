import packages from './skill-packages.json';
import type { StepContext } from './types';
export interface SkillPackage {key:string;version:number;sha256:string;text:string}
export type SkillPins=Record<string,{version:number;sha256:string}>;
export const SKILL_PACKAGES:Record<string,SkillPackage>=packages;
export const V1_SKILL_PINS:SkillPins=Object.fromEntries(Object.values(packages).filter(p=>p.version===1).map(p=>[p.key,{version:p.version,sha256:p.sha256}]));
export function skillsForStep(ctx:StepContext):SkillPackage[] {
  const keys=ctx.step.step_key==='challenge'?['creative-challenge']
    : ['diagnosis','research','marketing_brief'].includes(ctx.step.step_key)?['research-method']
    : ['outdoor_print_pack','ooh_concepts'].includes(ctx.run.playbook_key) && ['prepare','build'].includes(ctx.step.step_key)?['ooh-copy']:[];
  return keys.map(key=>{
    // The compiled graph's default version is fixed even for direct contract tests.
    const pin=ctx.run.skill_pins?.[key] ?? V1_SKILL_PINS[key];
    const p=SKILL_PACKAGES[`${key}@${pin.version}`];
    if(!p || p.sha256!==pin.sha256) throw new Error(`unavailable pinned skill: ${key}@${pin.version}`);
    return p;
  });
}
