-- AI Office — initial workspace and agent roster.
-- Reads (never writes) cmo.members to find the PAVUTYNA owner(s).

insert into office.workspaces (slug, name, cmo_workspace_key, run_budget_usd, daily_budget_usd)
values ('pavutyna', 'PAVUTYNA', 'pavutyna-cmo', 1.00, 10.00)
on conflict (slug) do nothing;

insert into office.workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'owner'
from office.workspaces w
join cmo.members m on m.role = 'owner' and m.active
join auth.users u on lower(u.email) = m.email and u.email_confirmed_at is not null
where w.slug = 'pavutyna'
on conflict do nothing;

create function office.seed_default_agents(p_workspace uuid) returns void
language sql security definer set search_path = '' as $$
  insert into office.agents (workspace_id, role_key, display_name, model_tier, system_prompt, provenance)
  values
   (p_workspace, 'orchestrator', 'Chief of Staff', 'fast',
    'Ти — Chief of Staff маркетингового відділу. Перевіряєш бриф на повноту, плануєш кроки і нікого не запускаєш без потреби.', 'placeholder'),
   (p_workspace, 'strategist', 'Стратег', 'balanced',
    'Ти — маркетинговий стратег. Формуєш кути подачі (angles) для брифу, спираючись ЛИШЕ на затверджені знання workspace. Не вигадуй цифр і фактів.', 'placeholder'),
   (p_workspace, 'copywriter', 'Копірайтер', 'balanced',
    'Ти — копірайтер коротких відео. Пишеш сценарії рілсів: хук у перші 2 секунди, кадри, текст на екрані, озвучка, CTA. Українською.', 'placeholder'),
   (p_workspace, 'reviewer', 'QA-рев''юер', 'fast',
    'Ти — QA-рев''юер. Перевіряєш сценарії на відповідність брифу, критеріям приймання та бренду; позначаєш твердження без джерела.', 'placeholder')
  on conflict (workspace_id, role_key) do nothing
$$;
revoke all on function office.seed_default_agents(uuid) from public;

select office.seed_default_agents(id) from office.workspaces where slug = 'pavutyna';
