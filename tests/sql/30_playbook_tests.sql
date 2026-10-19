-- Brief fields + gateway rate limit. Runs after 20_gateway_tests.sql (reuses schema t).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
truncate t.results;

begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
set local role authenticated;
insert into t.ids select 'brief_f', office.create_brief((select v from t.ids where k = 'ws_a'),
  '{"title":"Білборди","objective":"Перевірити поля","playbook_key":"ooh_concepts","fields":{"formats":"6×3 — 8 шт.","tone":"calm"}}');
select t.ok('fields and playbook stored with the brief',
  (select fields->>'formats' = '6×3 — 8 шт.' and playbook_key = 'ooh_concepts' from office.briefs where id = (select v from t.ids where k = 'brief_f')));
insert into t.ids select 'brief_g', office.create_brief((select v from t.ids where k = 'ws_a'), '{"title":"Без полів","objective":"Старий формат","fields":"not-an-object"}');
select t.ok('non-object fields ignored (old clients keep working)',
  (select fields = '{}'::jsonb and playbook_key = 'reels_concepts' from office.briefs where id = (select v from t.ids where k = 'brief_g')));
commit;

insert into t.tok select 'rl', office.create_executor('pavutyna', 'chatgpt', 'Rate test');
set role office_app;
do $$ begin
  for i in 1..120 loop perform office.gateway_status(t.h('rl')); end loop;
end $$;
select t.throws('121st call within a minute is rate limited', $q$select office.gateway_status(t.h('rl'))$q$, '54000');
reset role;
update office.executor_rate set window_start = window_start - interval '1 minute'
where executor_id = (select id from office.executors where name = 'Rate test');
set role office_app;
select t.ok('next minute works again', office.gateway_status(t.h('rl'))->'you'->>'name' = 'Rate test');
reset role;

\o
\set QUIET off
select id, case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from t.results order by id;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Playbook SQL tests failed'; end if;
end $$;
