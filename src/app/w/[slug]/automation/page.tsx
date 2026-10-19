import {notFound} from 'next/navigation';
import {requireUser} from '@/lib/supabase';
import {asUser,db} from '@/lib/db';
import {workspaceBySlug,executors} from '@/lib/queries';
import {planV1Enabled} from '@/lib/orchestrator/rollout';
import {setAutomationAction,configureTriggerChannelAction,pauseTriggerChannelAction,setProgramEngineAction,dispatchAgentAction} from '../../../actions';
export const dynamic='force-dynamic';
export default async function AutomationPage({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const user=await requireUser();const ws=await workspaceBySlug(user.id,slug);
 if(!ws||ws.role!=='owner'||!planV1Enabled(slug))notFound();
 const [settings,channels,events,people]=await Promise.all([
  asUser(db(),user.id,tx=>tx`select * from office.automation_settings where workspace_id=${ws.id}::uuid`),
  asUser(db(),user.id,tx=>tx`select id,channel_ref,enabled,paused_reason,max_runs_per_day,max_credits_per_month,est_credits_per_run from office.trigger_channels where workspace_id=${ws.id}::uuid order by channel_ref`),
  asUser(db(),user.id,tx=>tx`select id,status,error_code,est_credits,created_at::text from office.trigger_runs where workspace_id=${ws.id}::uuid order by created_at desc limit 20`),
  executors(user.id,ws.id),
 ]);
 const enabled=Boolean(settings[0]?.triggers_enabled)&&!settings[0]?.kill_switch_at;
 const serverEnabled=process.env.OFFICE_TRIGGER_DISPATCH_ENABLED==='true'&&process.env.TRIGGERS_DISABLED!=='1';
 return <>
  <section className="panel"><h1>Автоматичні запуски</h1>
   <p>Тригер запрошує агента взяти задачу через AI Office. Результат приймається за звичайними правилами оренди та перевірки.</p>
   <p className="notice">Стан офісу: {enabled?'дозволено':'вимкнено'}. Серверний запуск: {serverEnabled?'увімкнений':'вимкнений'}.</p>
   <form action={setAutomationAction}><input type="hidden" name="workspace_id" value={ws.id}/><input type="hidden" name="enabled" value={enabled?'false':'true'}/><button className={`btn ${enabled?'danger':'secondary'}`}>{enabled?'Зупинити нові автоматичні запуски':'Дозволити запуски офісу'}</button></form>
   <p className="small muted">Зупинка забороняє нові запрошення та нові задачі для агента. Уже взяту задачу агент може завершити; результат перевіряє AI Office.</p>
  </section>
  <section className="panel"><h2>Виконання планів CMO</h2><p>Shadow-планування доступне окремо від запуску дочірніх задач. Кожна програма потребує вашого схвалення конкретного плану та бюджету.</p>
   <p>Режим офісу: {settings[0]?.program_engine_enabled?'дозволено':'вимкнено'}.</p>
   <form action={setProgramEngineAction}><input type="hidden" name="workspace_id" value={ws.id}/><input type="hidden" name="enabled" value={settings[0]?.program_engine_enabled?'false':'true'}/><button className="btn secondary">{settings[0]?.program_engine_enabled?'Призупинити виконання програм':'Дозволити виконання затверджених планів'}</button></form>
  </section>
  <section className="panel"><h2>Канали</h2><p className="small muted">AI Office обмежує оцінені витрати. Фактичне списання звіряйте в ChatGPT Admin; встановіть там стелю поповнення перед пілотом.</p>
   <form action={dispatchAgentAction}><input type="hidden" name="workspace_id" value={ws.id}/><button className="btn secondary" disabled={!enabled||!serverEnabled||!channels.some(c=>c.enabled)}>Викликати агента один раз</button></form>
   <p className="small muted">Ручний запуск дотримується лімітів і вимикачів. Автоматичний cron вмикається окремо після перевірок.</p>
   {channels.map(c=><div key={String(c.id)} style={{marginBottom:14}}><b>{String(c.channel_ref)}</b><p className="small">{c.enabled?'увімкнений':'вимкнений'}{c.paused_reason?` · ${c.paused_reason}`:''} · до {String(c.max_runs_per_day)} запусків/добу · {String(c.max_credits_per_month)} кредитів/місяць · оцінка {String(c.est_credits_per_run)} за запуск</p>
    {c.enabled&&<form action={pauseTriggerChannelAction}><input type="hidden" name="channel_id" value={String(c.id)}/><button className="btn secondary">Призупинити канал</button></form>}
   </div>)}
   <details><summary>Додати або оновити канал</summary><form action={configureTriggerChannelAction} className="form-grid">
    <input type="hidden" name="workspace_id" value={ws.id}/>
    <label>Виконавець-агент<select name="executor_id" required>{people.filter(e=>e.kind==='chatgpt'&&e.mode==='triggered').map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
    <p className="small muted">Налаштуйте окремого виконавця з режимом «Агент за тригером» та потрібними ролями в офісі.</p>
    <label>API trigger ID<input name="channel_ref" required pattern="agtch_[A-Za-z0-9_]+" placeholder="agtch_…"/></label>
    <label>Назва серверного секрету<input name="secret_ref" required pattern="OFFICE_AGENT_[A-Z0-9_]+" placeholder="OFFICE_AGENT_SANDBOX"/></label>
    <p className="small muted">Сам Workspace Agent access token задається лише в середовищі сервера. Це поле містить назву змінної, а не токен.</p>
    <label>Ролі через кому<input name="seats" required defaultValue="copywriter"/></label>
    <label>Запусків за добу<input name="max_runs_per_day" type="number" min={0} max={1000} defaultValue={10}/></label>
    <label>Одночасних запусків<input name="max_concurrent" type="number" min={1} max={10} defaultValue={1}/></label>
    <label>Кредитів за місяць<input name="max_credits_per_month" type="number" min={0} step="0.01" defaultValue={300}/></label>
    <label>Оцінка кредитів за запуск<input name="est_credits_per_run" type="number" min="0.01" step="0.01" defaultValue={25}/></label>
    <label>Доказ вимірювання ціни<input name="price_evidence" maxLength={1000} placeholder="Посилання або результат sandbox-тесту"/></label>
    <label><input name="enabled" type="checkbox"/> Увімкнути канал після перевірок sandbox</label><button className="btn">Зберегти канал</button>
   </form></details>
  </section>
  <section className="panel"><h2>Останні події</h2><ul>{events.map(e=><li key={String(e.id)}>{String(e.status)}{e.error_code?` · ${e.error_code}`:''} · оцінка {String(e.est_credits)} кредитів</li>)}</ul></section>
 </>;
}
