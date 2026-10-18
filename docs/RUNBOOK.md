# AI Office — Runbook

## Інфраструктура
| Що | Де |
|---|---|
| Застосунок | Vercel, проєкт `ai-office` (команда serkovichhhh-9688s-projects), регіон fra1 |
| База | Supabase `gdicqiefyajzrzmhuhgi` (база CMO), схема `office` |
| Роль застосунку | `office_app` (LOGIN, без BYPASSRLS, connection limit 20) |
| Воркер | Vercel Cron `* * * * *` → `GET /api/worker/tick` з `Authorization: Bearer $CRON_SECRET` |
| Перевірка | `GET /api/health` з тим самим заголовком |

## Змінні середовища
Див. `.env.example`. Секрети (`DATABASE_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY`) — лише як sensitive у Vercel.

## Типові операції
**Увімкнути Claude замість заглушки.** У Vercel: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=<ключ>` (sensitive) → Redeploy. Перевірте бюджети: `update office.workspaces set run_budget_usd = 1, daily_budget_usd = 10 where slug = 'pavutyna';`

**Додати учасника.** Користувач має бути в Supabase Auth (той самий вхід, що й CMO Space):
```sql
insert into office.workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'approver' from office.workspaces w, auth.users u
where w.slug = 'pavutyna' and lower(u.email) = lower('<email>');
```

**Новий workspace.**
```sql
insert into office.workspaces (slug, name) values ('gtu', 'GTU');
select office.seed_default_agents(id) from office.workspaces where slug = 'gtu';
```

**Призупинити workspace** (воркер перестає брати кроки): `update office.workspaces set status = 'paused' where slug = '...';`

**Запуск «завис».** Воркер сам повертає крок із простроченим lease у чергу; після `max_attempts` запуск переходить у `failed` з подією `step.dead_lettered`. Подивитися: `select step_key, status, attempt, error, locked_until from office.steps where run_id = '<id>' order by created_at;`

**Ручний прогін воркера:** `curl -H "Authorization: Bearer $CRON_SECRET" https://<домен>/api/worker/tick`

## Відкат
- Код: Vercel → Deployments → попередній деплой → Promote (або `request_rollback`).
- База: схема `office` ізольована. Повний відкат фази 1 (видаляє всі дані AI Office, CMO не зачіпає):
  ```sql
  drop schema office cascade;
  revoke authenticated from office_app; drop role office_app;
  ```
  Перед цим — `pg_dump --schema=office`. Схеми `cmo` / `pvlinks` / `public` міграції не змінювали (звірено відбитком до/після: `28357b58…`, 297 об'єктів).

## Резервні копії
Supabase щоденні бекапи проєкту покривають і `office`. Нічний `cmo-daily-verified-backup` стосується лише CMO.
