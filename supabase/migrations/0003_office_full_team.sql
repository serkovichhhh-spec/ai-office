-- AI Office — full team roster: Marketing HQ + Production Studio.
-- Additive: widens the role list, adds department, seeds new roles for every workspace.

alter table office.agents drop constraint if exists agents_role_key_check;
alter table office.agents add constraint agents_role_key_check check (role_key in (
  'orchestrator','strategist','research_analyst','performance_analyst','creative_director','creative',
  'copywriter','smm','content_maker','reviewer',
  'designer','graphic_designer','print_designer','video_editor'));

alter table office.agents add column if not exists department text not null default 'marketing'
  check (department in ('marketing','production'));
alter table office.agents add column if not exists sort_order int not null default 100;

create or replace function office.activity_for_role(p_role text) returns text
language sql immutable set search_path = '' as $$
  select case p_role
    when 'orchestrator' then 'planning'
    when 'strategist' then 'researching'
    when 'research_analyst' then 'researching'
    when 'performance_analyst' then 'researching'
    when 'reviewer' then 'reviewing'
    else 'drafting' end
$$;

create or replace function office.seed_default_agents(p_workspace uuid) returns void
language sql security definer set search_path = '' as $$
  insert into office.agents (workspace_id, role_key, display_name, model_tier, system_prompt, provenance, department, sort_order)
  values
   (p_workspace, 'orchestrator', 'Шеф-маркетолог', 'fast',
    'Ти — шеф-маркетолог і координатор відділу. Перевіряєш бриф на повноту, плануєш кроки й залучаєш лише потрібних людей.', 'placeholder', 'marketing', 10),
   (p_workspace, 'strategist', 'Стратег', 'balanced',
    'Ти — маркетинговий стратег. Формуєш кути подачі, спираючись ЛИШЕ на затверджені знання workspace. Не вигадуй цифр і фактів.', 'placeholder', 'marketing', 20),
   (p_workspace, 'creative_director', 'Арт-директор', 'balanced',
    'Ти — арт-директор. Задаєш візуальну ідею, стиль і референси для кампанії в межах брендбука.', 'placeholder', 'marketing', 30),
   (p_workspace, 'creative', 'Креативник', 'balanced',
    'Ти — креативник. Генеруєш сміливі концепції й big ideas під бриф.', 'placeholder', 'marketing', 40),
   (p_workspace, 'copywriter', 'Копірайтер', 'balanced',
    'Ти — копірайтер коротких відео. Пишеш сценарії рілсів: хук у перші 2 секунди, кадри, текст на екрані, озвучка, CTA. Українською.', 'placeholder', 'marketing', 50),
   (p_workspace, 'smm', 'SMM-менеджер', 'balanced',
    'Ти — SMM-менеджер. Готуєш контент-план, тексти постів і сторіз під канали бренду.', 'placeholder', 'marketing', 60),
   (p_workspace, 'content_maker', 'Контент-мейкер', 'balanced',
    'Ти — контент-мейкер. Розписуєш зйомку: шот-лист, локації, реквізит, інструкції для кадру.', 'placeholder', 'marketing', 70),
   (p_workspace, 'reviewer', 'QA-рев''юер', 'fast',
    'Ти — QA-рев''юер. Перевіряєш матеріали на відповідність брифу, критеріям приймання та бренду; позначаєш твердження без джерела.', 'placeholder', 'marketing', 80),
   (p_workspace, 'designer', 'Дизайнер', 'balanced', '', 'production-local', 'production', 110),
   (p_workspace, 'graphic_designer', 'Графічний дизайнер', 'balanced', '', 'production-local', 'production', 120),
   (p_workspace, 'print_designer', 'Дизайнер поліграфії', 'balanced', '', 'production-local', 'production', 130),
   (p_workspace, 'video_editor', 'Монтажер', 'balanced', '', 'production-local', 'production', 140)
  on conflict (workspace_id, role_key) do nothing
$$;
revoke all on function office.seed_default_agents(uuid) from public;

-- Existing workspaces: rename the coordinator, set order, add the new roles.
update office.agents set display_name = 'Шеф-маркетолог', sort_order = 10
  where role_key = 'orchestrator' and display_name = 'Chief of Staff';
update office.agents set sort_order = case role_key
  when 'strategist' then 20 when 'copywriter' then 50 when 'reviewer' then 80 else sort_order end
  where role_key in ('strategist','copywriter','reviewer');
select office.seed_default_agents(id) from office.workspaces;
