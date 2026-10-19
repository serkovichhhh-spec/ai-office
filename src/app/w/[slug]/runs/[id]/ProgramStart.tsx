"use client";
import {useActionState} from 'react';
import {startProgramAction,type ActionState} from '../../../../actions';
export function ProgramStart({artifactId,budget}:{artifactId:string;budget:string}){
 const [state,action,pending]=useActionState<ActionState,FormData>(startProgramAction,{});
 return <form action={action} className="form-grid">
  <input type="hidden" name="plan_artifact_id" value={artifactId}/>
  <label>Спільний бюджет програми, USD<input name="budget_usd" type="number" min="0.0001" max={budget} step="0.0001" defaultValue={budget} required/></label>
  <label>Максимум тригерів для всієї програми<input name="max_triggers" type="number" min={1} max={50} defaultValue={8} required/></label>
  {state.error&&<p className="error" role="alert">{state.error}</p>}{state.ok&&<p role="status">Програму створено</p>}
  <button className="btn approve" disabled={pending}>Схвалити план і створити задачі</button>
 </form>;
}
