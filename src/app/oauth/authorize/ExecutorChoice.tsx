"use client";
import { useState } from "react";
export function ExecutorChoice({workspaces,executors,guessKind}: {
  workspaces: {id:string;name:string}[];
  executors: {id:string;workspace_id:string;kind:string;label:string}[];
  guessKind:string;
}) {
  const [workspace,setWorkspace] = useState(workspaces[0].id);
  const [kind,setKind] = useState(guessKind);
  const [existing,setExisting] = useState("");
  const choices=executors.filter(e=>e.workspace_id===workspace && e.kind===kind);
  return <>
    <label>Workspace<select name="workspace_id" value={workspace} onChange={e=>{setWorkspace(e.target.value);setExisting("");}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    <label>Хто виконує задачі<select name="kind" value={kind} onChange={e=>{setKind(e.target.value);setExisting("");}}><option value="chatgpt">ChatGPT</option><option value="claude_session">Claude</option></select></label>
    <label>Підключення<select name="executor_id" value={existing} onChange={e=>setExisting(e.target.value)}><option value="">Новий виконавець</option>{choices.map(e=><option key={e.id} value={e.id}>Перепідключити {e.label}</option>)}</select></label>
    {!existing && <label>Унікальне ім'я виконавця<input name="label" required minLength={2} maxLength={64} pattern="[a-z][a-z0-9_]+" placeholder={kind==='chatgpt'?'chatgpt_creative':'claude_review'} /><span className="muted small">Латинські літери, цифри та _. Окреме ім'я для кожного акаунта.</span></label>}
  </>;
}
