-- Optional Workspace Agent wake-up gateway. Disabled at every layer by default.
begin;
create table office.automation_settings(
 workspace_id uuid primary key references office.workspaces(id),triggers_enabled boolean not null default false,
 kill_switch_at timestamptz,max_triggers_per_run int not null default 8 check(max_triggers_per_run between 1 and 50)
);
insert into office.automation_settings(workspace_id) select id from office.workspaces;
create table office.trigger_channels(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references office.workspaces(id),
 executor_id uuid not null references office.executors(id),provider text not null default 'openai_workspace_agent' check(provider='openai_workspace_agent'),
 channel_ref text not null check(channel_ref ~ '^agtch_[A-Za-z0-9_]{1,150}$'),
 secret_ref text not null check(secret_ref ~ '^OFFICE_AGENT_[A-Z0-9_]+$'),enabled boolean not null default false,
 allowed_seats text[] not null check(cardinality(allowed_seats)>0),
 max_runs_per_day int not null default 10 check(max_runs_per_day between 0 and 1000),
 max_concurrent int not null default 1 check(max_concurrent between 1 and 10),
 max_credits_per_month numeric not null default 300 check(max_credits_per_month>=0 and max_credits_per_month<'Infinity'::numeric),
 est_credits_per_run numeric not null default 25 check(est_credits_per_run>0 and est_credits_per_run<'Infinity'::numeric),price_evidence text,
 paused_reason text,unique(workspace_id,channel_ref)
);
create table office.trigger_runs(
 id uuid primary key default gen_random_uuid(),channel_id uuid not null references office.trigger_channels(id),
 workspace_id uuid not null references office.workspaces(id),run_id uuid not null references office.runs(id),step_id uuid not null references office.steps(id),
 attempt_id uuid references office.execution_attempts(id),idempotency_key text not null,provider_run_id text,
 status text not null default 'pending' check(status in ('pending','accepted','queued','in_progress','suspended','completed','failed','expired','skipped')),
 http_status int,error_code text,est_credits numeric not null default 0 check(est_credits>=0 and est_credits<'Infinity'::numeric),actual_credits numeric check(actual_credits>=0 and actual_credits<'Infinity'::numeric),
 http_attempts int not null default 0,next_retry_at timestamptz not null default now(),
 dispatch_token uuid,dispatch_locked_until timestamptz,poll_unavailable boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),state_changed_at timestamptz not null default now(),
 unique(channel_id,idempotency_key)
);
create index trigger_runs_step on office.trigger_runs(step_id,created_at desc);
create index trigger_runs_channel on office.trigger_runs(channel_id,created_at desc);
alter table office.automation_settings enable row level security;
alter table office.trigger_channels enable row level security;
alter table office.trigger_runs enable row level security;
create policy automation_read on office.automation_settings for select to authenticated using(office.is_member(workspace_id));
create policy channels_read on office.trigger_channels for select to authenticated using(office.is_member(workspace_id));
create policy triggers_read on office.trigger_runs for select to authenticated using(office.is_member(workspace_id));
revoke all on office.automation_settings,office.trigger_channels,office.trigger_runs from public,anon,authenticated,service_role,office_app;
grant select on office.automation_settings,office.trigger_runs to authenticated;
grant select(id,workspace_id,executor_id,provider,channel_ref,enabled,allowed_seats,max_runs_per_day,max_concurrent,max_credits_per_month,est_credits_per_run,price_evidence,paused_reason) on office.trigger_channels to authenticated;

create function office.set_automation(p_ws uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not office.has_role(p_ws,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 insert into office.automation_settings(workspace_id,triggers_enabled,kill_switch_at)
 values(p_ws,p_enabled,case when p_enabled then null else now() end)
 on conflict(workspace_id) do update set triggers_enabled=excluded.triggers_enabled,kill_switch_at=excluded.kill_switch_at;
 perform office.log_event(p_ws,null,null,'user',auth.uid(),null,'automation.configured','idle',jsonb_build_object('enabled',p_enabled));
end $$;
create function office.configure_trigger_channel(p_ws uuid,p_executor uuid,p_channel text,p_secret text,p_seats text[],p_limits jsonb,p_enabled boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare e office.executors;v uuid;
begin
 if not office.has_role(p_ws,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 select * into e from office.executors where id=p_executor;
 if e.id is null or e.workspace_id<>p_ws or e.kind<>'chatgpt' or e.mode<>'triggered' or e.revoked_at is not null
  or not (array['get','claim','submit']::text[] <@ e.allowed_ops) then raise exception 'invalid trigger executor' using errcode='22023';end if;
 if p_seats is null or cardinality(p_seats)=0 or exists(select 1 from unnest(p_seats) seat where seat is null
  or not exists(select 1 from office.agents a where a.workspace_id=p_ws and a.role_key=seat)
  or (e.allowed_seats is not null and not(seat=any(e.allowed_seats)))) then raise exception 'invalid trigger seats' using errcode='22023';end if;
 if p_enabled and length(trim(coalesce(p_limits->>'price_evidence','')))<3 then raise exception 'measure price before enabling channel' using errcode='22023';end if;
 insert into office.trigger_channels(workspace_id,executor_id,channel_ref,secret_ref,allowed_seats,enabled,max_runs_per_day,max_concurrent,max_credits_per_month,est_credits_per_run,price_evidence)
 values(p_ws,e.id,p_channel,p_secret,p_seats,p_enabled,coalesce((p_limits->>'max_runs_per_day')::int,10),coalesce((p_limits->>'max_concurrent')::int,1),
 coalesce((p_limits->>'max_credits_per_month')::numeric,300),coalesce((p_limits->>'est_credits_per_run')::numeric,25),p_limits->>'price_evidence')
 on conflict(workspace_id,channel_ref) do update set executor_id=excluded.executor_id,secret_ref=excluded.secret_ref,allowed_seats=excluded.allowed_seats,
 enabled=excluded.enabled,max_runs_per_day=excluded.max_runs_per_day,max_concurrent=excluded.max_concurrent,max_credits_per_month=excluded.max_credits_per_month,
 est_credits_per_run=excluded.est_credits_per_run,price_evidence=excluded.price_evidence,paused_reason=null returning id into v;
 perform office.log_event(p_ws,null,null,'user',auth.uid(),null,'trigger.channel_configured','idle',jsonb_build_object('channel_id',v,'enabled',p_enabled));return v;
end $$;

create function office.pause_trigger_channel(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c office.trigger_channels;
begin
 select * into c from office.trigger_channels where id=p_id for update;
 if not found or not office.has_role(c.workspace_id,array['owner']) then raise exception 'not allowed' using errcode='42501';end if;
 update office.trigger_channels set enabled=false,paused_reason='paused_by_owner' where id=c.id;
 perform office.log_event(c.workspace_id,null,null,'user',auth.uid(),null,'trigger.channel_paused','idle',jsonb_build_object('channel_id',c.id));
end $$;
revoke all on function office.pause_trigger_channel(uuid) from public,anon,authenticated,service_role,office_app;
grant execute on function office.pause_trigger_channel(uuid) to authenticated;

-- Serialize all channel reservations of a workspace on its settings row. Retry the same
-- logical event with the same key; the dispatch lease protects against concurrent ticks.
create function office.trigger_next(p_slugs text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings office.automation_settings;c office.trigger_channels;e office.executors;s office.steps;t office.trigger_runs;
 n int;v_key text;reason text;v_skip uuid;
begin
 for settings in select a.* from office.automation_settings a join office.workspaces w on w.id=a.workspace_id
  where w.slug=any(p_slugs) and w.status='active' and a.triggers_enabled and a.kill_switch_at is null
  order by a.workspace_id for update of a skip locked loop
  for c in select * from office.trigger_channels where workspace_id=settings.workspace_id and enabled order by id for update skip locked loop
   reason:=null;
   if (select count(*)=3 and bool_and(status in ('failed','expired')) from
     (select status from office.trigger_runs where channel_id=c.id and status<>'skipped' order by created_at desc,id desc limit 3) recent) then reason:='consecutive_failures';
   elsif (select coalesce(sum(est_credits),0) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('month',now()))+c.est_credits_per_run>c.max_credits_per_month and not exists(select 1 from office.trigger_runs where channel_id=c.id and status='pending' and http_attempts<3) then reason:='credit_cap';end if;
   if reason is not null then
    update office.trigger_channels set enabled=false,paused_reason=reason where id=c.id;
    perform office.log_event(c.workspace_id,null,null,'system',null,null,'trigger.channel_paused','idle',jsonb_build_object('channel_id',c.id,'reason',reason));
    continue;
   end if;
   select * into e from office.executors where id=c.executor_id and workspace_id=c.workspace_id and revoked_at is null and mode='triggered' and kind='chatgpt';
   if not found then continue;end if;
   select st.* into s from office.steps st join office.runs r on r.id=st.run_id
    where st.workspace_id=c.workspace_id and r.status='running'
      and ((select count(*) from office.trigger_runs x where x.step_id=st.id and x.status<>'skipped')<2 or exists(select 1 from office.trigger_runs x where x.step_id=st.id and x.channel_id=c.id and x.status='pending'))
      and ((select count(*) from office.trigger_runs x where x.run_id=st.run_id and x.status<>'skipped')<settings.max_triggers_per_run or exists(select 1 from office.trigger_runs x where x.step_id=st.id and x.channel_id=c.id and x.status='pending'))
      and not exists(select 1 from office.trigger_runs x where x.step_id=st.id and
        (x.status in ('accepted','queued','in_progress','suspended') or
        (x.status='pending' and (x.dispatch_locked_until>now() or x.next_retry_at>now())))) and st.agent_role=any(c.allowed_seats) and office.gateway_eligible(e,st)
      and not exists(select 1 from office.execution_attempts a where a.step_id=st.id and a.state='claimed' and a.lease_expires_at>now())
    order by st.created_at for update of st skip locked limit 1;
   if not found then continue;end if;
   select * into t from office.trigger_runs where channel_id=c.id and step_id=s.id and status='pending' and attempt_id is null
    and http_attempts<3 and next_retry_at<=now() and (dispatch_locked_until is null or dispatch_locked_until<=now()) order by created_at for update limit 1;
   if found then
    update office.trigger_runs set dispatch_token=gen_random_uuid(),dispatch_locked_until=now()+interval '45 seconds',http_attempts=http_attempts+1,updated_at=now()
      where id=t.id returning * into t;
    return to_jsonb(t)||jsonb_build_object('channel_ref',c.channel_ref,'secret_ref',c.secret_ref);
   end if;
   reason:=null;
   if (select count(*) from office.trigger_runs where channel_id=c.id and status in ('pending','accepted','queued','in_progress','suspended'))>=c.max_concurrent then reason:='concurrency_cap';
   elsif (select count(*) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('day',now()))>=c.max_runs_per_day then reason:='daily_cap';
   elsif (select coalesce(sum(est_credits),0) from office.trigger_runs where channel_id=c.id and status<>'skipped' and created_at>=date_trunc('month',now()))+c.est_credits_per_run>c.max_credits_per_month then reason:='credit_cap';
   elsif (select count(*) from office.trigger_runs where step_id=s.id and status<>'skipped')>=2 then reason:='step_trigger_cap';
   elsif (select count(*) from office.trigger_runs where run_id=s.run_id and status<>'skipped')>=settings.max_triggers_per_run then reason:='run_trigger_cap';end if;
   if reason is not null then
    v_key:=office.sha256_hex(s.id::text||':skip:'||reason||':'||date_trunc('hour',now())::text);
    insert into office.trigger_runs(channel_id,workspace_id,run_id,step_id,idempotency_key,status,error_code)
      values(c.id,c.workspace_id,s.run_id,s.id,v_key,'skipped',reason) on conflict do nothing;
    continue;
   end if;
   select count(*)+1 into n from office.trigger_runs where step_id=s.id and channel_id=c.id;
   v_key:=office.sha256_hex(s.id::text||':'||s.cycle::text||':'||n::text||':'||c.id::text);
   insert into office.trigger_runs(channel_id,workspace_id,run_id,step_id,idempotency_key,est_credits,http_attempts,dispatch_token,dispatch_locked_until)
    values(c.id,c.workspace_id,s.run_id,s.id,v_key,c.est_credits_per_run,1,gen_random_uuid(),now()+interval '45 seconds')
    on conflict(channel_id,idempotency_key) do nothing returning * into t;
   if found then return to_jsonb(t)||jsonb_build_object('channel_ref',c.channel_ref,'secret_ref',c.secret_ref);end if;
  end loop;
 end loop;
 return null;
end $$;
create function office.trigger_can_send(p_id uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from office.trigger_runs t join office.trigger_channels c on c.id=t.channel_id
  join office.automation_settings a on a.workspace_id=t.workspace_id join office.executors e on e.id=c.executor_id
  join office.steps s on s.id=t.step_id join office.runs r on r.id=t.run_id join office.workspaces w on w.id=t.workspace_id
  where t.id=p_id and t.dispatch_token=p_token and t.dispatch_locked_until>now() and t.status='pending'
  and c.enabled and a.triggers_enabled and a.kill_switch_at is null and e.revoked_at is null and e.mode='triggered'
  and r.status='running' and w.status='active' and s.agent_role=any(c.allowed_seats) and office.gateway_eligible(e,s)
  and not exists(select 1 from office.execution_attempts x where x.step_id=s.id and x.state='claimed' and x.lease_expires_at>now()))
$$;
create function office.trigger_finish(p_id uuid,p_token uuid,p_http int,p_provider_id text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare t office.trigger_runs;v_status text;
begin
 select * into t from office.trigger_runs where id=p_id for update;
 if not found or t.dispatch_token is distinct from p_token or t.status<>'pending' then return;end if;
 if p_error='disabled_before_dispatch' then v_status:='skipped';
 elsif p_error in ('credential_missing','wrong_credential_type','invalid_channel') then v_status:='failed';
 elsif p_http=202 then v_status:='accepted';
 elsif (p_http=0 or p_http>=500 or p_http=429) and t.http_attempts<3 then v_status:='pending';
 elsif p_error='disabled_before_dispatch' then v_status:='skipped';else v_status:='failed';end if;
 update office.trigger_runs set status=v_status,http_status=p_http,
  provider_run_id=case when p_provider_id ~ '^apirun_[A-Za-z0-9_]{1,150}$' then p_provider_id end,
  error_code=p_error,dispatch_token=null,dispatch_locked_until=null,next_retry_at=now()+make_interval(secs=>10*t.http_attempts),
  state_changed_at=case when status is distinct from v_status then now() else state_changed_at end,updated_at=now() where id=t.id;
 if p_http in (401,403) or p_error in ('credential_missing','wrong_credential_type') then
  update office.trigger_channels set enabled=false,paused_reason=coalesce(p_error,'authentication_failed') where id=t.channel_id;
 end if;
 perform office.log_event(t.workspace_id,t.run_id,t.step_id,'system',null,null,'trigger.'||v_status,'idle',
  jsonb_build_object('trigger_id',t.id,'channel_id',t.channel_id,'http_status',p_http,'error',p_error,'estimated_credits',t.est_credits));
end $$;

create function office.trigger_link_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update office.trigger_runs set attempt_id=new.id,updated_at=now()
 where id=(select t.id from office.trigger_runs t join office.trigger_channels c on c.id=t.channel_id
   where t.step_id=new.step_id and c.executor_id=new.executor_id and t.status in ('pending','accepted','queued','in_progress','suspended')
   order by t.created_at desc limit 1) and attempt_id is null;
 return new;
end $$;
create trigger trigger_link_attempt after insert on office.execution_attempts for each row execute function office.trigger_link_attempt();
create function office.trigger_watchdog(p_slugs text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform office.gateway_expire();
 update office.trigger_runs t set status='completed',updated_at=now(),state_changed_at=now(),error_code=null
  from office.execution_attempts a,office.workspaces w where t.attempt_id=a.id and t.workspace_id=w.id and w.slug=any(p_slugs)
    and a.state='validated' and t.status in ('pending','accepted','queued','in_progress','suspended');
 update office.trigger_runs t set status='failed',error_code='output_rejected_or_lease_expired',updated_at=now(),state_changed_at=now()
  from office.execution_attempts a,office.workspaces w where t.attempt_id=a.id and t.workspace_id=w.id and w.slug=any(p_slugs)
    and a.state in ('rejected','expired','released') and t.status in ('pending','accepted','queued','in_progress','suspended');
 update office.trigger_runs t set status='expired',error_code='no_claim',updated_at=now(),state_changed_at=now()
  from office.workspaces w where t.workspace_id=w.id and w.slug=any(p_slugs) and t.attempt_id is null
    and t.status in ('pending','accepted','queued','in_progress','suspended') and t.created_at<now()-interval '15 minutes';
 update office.trigger_runs t set status='failed',error_code='needs_approval_in_chatgpt',updated_at=now(),state_changed_at=now()
  from office.workspaces w where t.workspace_id=w.id and w.slug=any(p_slugs) and t.status='suspended' and t.state_changed_at<now()-interval '10 minutes';
 update office.trigger_runs t set status='failed',error_code='run_not_active',updated_at=now(),state_changed_at=now()
  from office.runs r,office.workspaces w where t.run_id=r.id and t.workspace_id=w.id and w.slug=any(p_slugs)
   and r.status in ('cancelled','failed') and t.status in ('pending','accepted','queued','in_progress','suspended');
 update office.execution_attempts a set state='released',rejection_reason=coalesce(t.error_code,'trigger_ended')
  from office.trigger_runs t,office.workspaces w where t.attempt_id=a.id and t.workspace_id=w.id and w.slug=any(p_slugs)
    and t.status in ('failed','expired') and a.state='claimed';
end $$;
create function office.trigger_poll_jobs(p_slugs text[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(q),'[]'::jsonb) from (
 select t.id,t.provider_run_id,c.channel_ref,c.secret_ref from office.trigger_runs t join office.trigger_channels c on c.id=t.channel_id
 join office.workspaces w on w.id=t.workspace_id where w.slug=any(p_slugs) and t.status in ('accepted','queued','in_progress','suspended')
 and t.provider_run_id is not null and not t.poll_unavailable order by t.updated_at limit 2) q
$$;
create function office.trigger_observe(p_id uuid,p_status text,p_http int) returns void
language plpgsql security definer set search_path='' as $$
declare t office.trigger_runs;a office.execution_attempts;v_status text;v_error text;
begin
 select * into t from office.trigger_runs where id=p_id for update;
 if not found or t.status not in ('accepted','queued','in_progress','suspended') then return;end if;
 if p_http in (404,405) then update office.trigger_runs set poll_unavailable=true,updated_at=now() where id=p_id;return;end if;
 if p_http in (401,403) then
  update office.trigger_channels set enabled=false,paused_reason='poll_authentication_failed' where id=t.channel_id;
  update office.trigger_runs set status='failed',error_code='poll_authentication_failed',updated_at=now() where id=p_id;return;end if;
 if p_http<>200 or p_status not in ('queued','in_progress','suspended','completed','failed') then return;end if;
 select * into a from office.execution_attempts where id=t.attempt_id;
 v_status:=p_status;
 if a.state='validated' then v_status:='completed';
 elsif p_status='completed' and a.state='submitted' then v_status:='in_progress';
 elsif p_status='completed' then v_status:='failed';v_error:='no_submit';
 elsif p_status='failed' then v_error:='provider_run_failed';end if;
 update office.trigger_runs set status=v_status,error_code=v_error,updated_at=now(),
 state_changed_at=case when status<>v_status then now() else state_changed_at end where id=p_id;
 if v_status='failed' and a.state='claimed' then update office.execution_attempts set state='released',rejection_reason=v_error where id=a.id;end if;
end $$;

-- Kill switch forbids new triggered claims; existing leases may submit their result.
create or replace function office.gateway_claim(p_token_hash text, p_step uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e office.executors; s office.steps; v_token text; v_attempt uuid; v_expires timestamptz;
begin
  e := office.gateway_executor(p_token_hash, 'claim');
  if e.mode='triggered' and not exists(select 1 from office.automation_settings where workspace_id=e.workspace_id and triggers_enabled and kill_switch_at is null) then
    raise exception 'automation_disabled' using errcode='42501';end if;
  perform office.gateway_expire();
  if p_step is null then
    select st.* into s from office.steps st join office.runs r on r.id = st.run_id and r.status = 'running'
    where office.gateway_eligible(e, st)
      and not exists (select 1 from office.execution_attempts x where x.step_id = st.id and x.state = 'claimed')
    order by st.created_at for update of st skip locked limit 1;
    if not found then return jsonb_build_object('claimed', false, 'reason', 'no_tasks'); end if;
  else
    select * into s from office.steps where id = p_step for update;
    if not found or s.workspace_id <> e.workspace_id then raise exception 'task not found' using errcode = 'P0002'; end if;
    if not office.executor_independent(e,s) then raise exception 'not_independent' using errcode='42501'; end if;
    if office.gateway_eligible(e, s) is not true then
      return jsonb_build_object('claimed', false, 'reason', 'not_assigned_to_you_or_not_waiting');
    end if;
    if exists (select 1 from office.execution_attempts x where x.step_id = s.id and x.state = 'claimed') then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
  end if;

  if not exists (select 1 from office.runs r join office.workspaces w on w.id=r.workspace_id
    where r.id=s.run_id and r.status='running' and w.status='active') then
    return jsonb_build_object('claimed',false,'reason','run_not_active'); end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(mins => e.lease_minutes);
  insert into office.execution_attempts (step_id, run_id, workspace_id, executor_id, lease_token_hash, lease_expires_at, input_hashes)
  values (s.id, s.run_id, s.workspace_id, e.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires,
          office.run_input_hashes(s.run_id))
  returning id into v_attempt;
  perform office.log_event(s.workspace_id, s.run_id, s.id, 'agent', null, s.agent_role, 'attempt.claimed',
    office.activity_for_role(s.agent_role),
    jsonb_build_object('step', s.step_key, 'attempt_id', v_attempt, 'executor', e.kind, 'executor_name', e.name, 'lease_expires_at', v_expires));
  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt, 'lease_token', v_token, 'lease_expires_at', v_expires,
                            'envelope', office.gateway_envelope(s.id));
end $$;
revoke all on function office.gateway_claim(text,uuid) from public,anon,authenticated,service_role,office_app;
grant execute on function office.gateway_claim(text,uuid) to office_app;

revoke all on function office.set_automation(uuid,boolean),office.configure_trigger_channel(uuid,uuid,text,text,text[],jsonb,boolean),
 office.trigger_next(text[]),office.trigger_can_send(uuid,uuid),office.trigger_finish(uuid,uuid,int,text,text),office.trigger_link_attempt(),
 office.trigger_watchdog(text[]),office.trigger_poll_jobs(text[]),office.trigger_observe(uuid,text,int) from public,anon,authenticated,service_role,office_app;
grant execute on function office.set_automation(uuid,boolean),office.configure_trigger_channel(uuid,uuid,text,text,text[],jsonb,boolean) to authenticated;
grant execute on function office.trigger_next(text[]),office.trigger_can_send(uuid,uuid),office.trigger_finish(uuid,uuid,int,text,text),
 office.trigger_watchdog(text[]),office.trigger_poll_jobs(text[]),office.trigger_observe(uuid,text,int) to office_app;
commit;
