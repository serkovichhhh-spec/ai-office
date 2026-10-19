"use client";
import {useActionState} from 'react';
import {uploadRunFileAction,type ActionState} from '../../../../actions';
export function FileUpload({runId}:{runId:string}){
 const [state,action,pending]=useActionState<ActionState,FormData>(uploadRunFileAction,{});
 return <form action={action} className="form-grid">
  <input type="hidden" name="run_id" value={runId}/>
  <label>Файл<input type="file" name="file" required accept="image/png,image/jpeg,image/webp,application/pdf"/></label>
  <label>Для чого цей файл<input name="purpose" required maxLength={500} placeholder="Референс, логотип, макет…"/></label>
  <p className="small muted">PNG, JPEG, WebP або PDF до 4 МБ. Для файлів до 25 МБ використайте передачу з чату.</p>
  {state.error&&<p className="error" role="alert">{state.error}</p>}{state.ok&&<p role="status">Файл прикріплено</p>}
  <button className="btn" disabled={pending}>{pending?'Завантаження…':'Прикріпити'}</button>
 </form>;
}
