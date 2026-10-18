# AI Office — Discovery

Дата аудиту: 18.10.2026. Режим: **тільки читання**. Жодна наявна система не змінювалась.

## 1. Що перевірено і як

| Система | Як перевірено | Доступ |
|---|---|---|
| Vercel, команда `serkovichhhh-9688s-projects` | Vercel MCP: проєкти, деплої, назви env-змінних (без значень) | є |
| Supabase, організація `lnadruxwefzcavsrcbmq` | Supabase MCP: проєкти, таблиці, політики RLS, функції, cron, розширення | є |
| GitHub | `list_repos` для сесії | **немає** (жоден репозиторій не підключений) |
| ПК `serkovich-gigabytepc` (Windows) | Тільки назви папок | **вміст закритий** (немає дозволу на папки) |
| Claude Projects (маркетингові скіли/ролі) | — | **немає** (не експортуються через API) |
| Pavutyna Workflow (chatgpt.site) | — | не перевірено (зовнішній сайт) |
| Anthropic API | Пошук env-змінних у Vercel | **ключа немає ніде** |

## 2. Інвентар

### 2.1 Vercel (12 проєктів)

| Проєкт | Що це | Рішення для AI Office |
|---|---|---|
| `pavutyna-cmo` | CMO Space. Статичний сайт (`framework: null`), лише `CMO_SUPABASE_URL` і `CMO_SUPABASE_PUBLISHABLE_KEY`. SSO-захист Vercel на прев'ю. Останній прод-деплой `dpl_6SAuCGjVXh5zpj4Z49TYuxN6x7V1`. | **integrate** (читаємо його дані через БД, код не чіпаємо) |
| `pavutyna-links` | Pavutyna Links (l.pavutyna.com через Cloudflare Worker) | **defer** (поза скоупом; є ризик безпеки, див. RISKS R1) |
| `tyama-*` (4 шт.), `bside35`, `dima-b-side-prototype` | ТЯМА та запрошення | **не чіпати** |
| `prodprod`, `prodprod-studio`, `prodprod-proposals` | Сайти ProdProd | **не чіпати** |
| `champion-strategy` | Інший проєкт | **не чіпати** |

### 2.2 Supabase

| Проєкт | Статус | Зміст | Рішення |
|---|---|---|---|
| `tyama-foundation-verification` (`gdicqiefyajzrzmhuhgi`, eu-central-1, PG 17) | ACTIVE | Фактично **база CMO**: схеми `cmo`, `pvlinks`, архів `zz_archive_tyama_*`. 6 користувачів auth (вхід лише через email). | **reuse**: нова схема `office` поруч |
| `TYAMA` (`papubuaxpnscdpycfwht`) | ACTIVE | Продукт ТЯМА | **не чіпати** |
| `champion-dashboard` | INACTIVE | — | ігнорувати |

#### Схема `cmo` (джерело правди для CMO Space)

| Таблиця | Рядків | Призначення |
|---|---|---|
| `cmo.tasks` | 130 (done 67, todo 55, ready 4, progress 2, backlog 2) | Реєстр задач команди. PK `(workspace_key, source, source_id)`, `workspace_key = 'pavutyna-cmo'` (CHECK) |
| `cmo.members` | 7 | Ролі `owner` / `intake` / `executor`, ключ — email |
| `cmo.space_documents` + `space_document_events` | 18 / 67 | Розділи CMO Space (decisions, insights, content, campaigns, budget, attribution, reports…) з ревізіями та журналом |
| `cmo.agent_runs` | 3 | **Журнал наявних агентів**: `analyst`, `lead_analyst`, `optimizer`, `scout`, `content`, `chief`, `backup` |
| `cmo.workspace_backups` | 21 | Бекапи; pg_cron `cmo-daily-verified-backup` о 01:00 UTC |
| `cmo.inbox_preferences`, `source_snapshots`, `space_snapshots` | — | Службові |

Функції: `cmo.actor()` (визначає роль за `auth.uid()` + email), `cmo.agent_upsert()` (агенти пишуть лише в дозволені розділи і не перезаписують записи, якими вже володіє людина), `cmo.creative_action`, `cmo.board_action`, `cmo.inbox_action` та інші. Політики RLS дозволяють доступ лише ролі `owner`.

**Висновок:** `cmo.agent_runs` + `cmo.agent_upsert` — це вже працюючий протокол «агенти пропонують, людина володіє». AI Office має **показувати** ці запуски (вони справжні) і **не дублювати** реєстр задач.

Стан наявних запусків на момент аудиту:
- #1 analyst — ok, «Історія Meta Ads занесена…».
- #2 chief — ok, «Підсумок тижня 10.10–16.10 збережено в Google Doc».
- #3 analyst — **`running` з 17.10 12:54 UTC без завершення** (зависла сесія, heartbeat відсутній).

#### Схема `pvlinks`
9 таблиць **без RLS** (settings, links, sources, offers, templates, post_log, events, leads, users). Див. RISKS R1.

#### Платформа
Розширення: `pg_cron`, `pgcrypto`, `pg_trgm`, `supabase_vault`, `uuid-ossp`. `pg_net` і `pgmq` **не встановлені**. Event trigger `ensure_rls` автоматично вмикає RLS лише для нових таблиць у `public`; на інші схеми він не діє, тому в `office` RLS вмикаємо явно.

### 2.3 ПК власника (лише назви папок)
- `Videos\ProdProd-Studio` — локальний продакшн (`/produce`, BAT-лаунчер). **Не відкривали.** Інтеграція — фаза 4.
- `Documents\GitHub\{pavutyna-links, TYAMA, TYAMA-live}`.
- `Desktop\{prodprod-proposals, prodprod-site, prodprod-transfer}`.
- Локальна копія коду CMO Space не знайдена (ймовірно, деплоїлась з іншого місця).

## 3. Класифікація компонентів

| Компонент | Рішення | Обґрунтування |
|---|---|---|
| Supabase Auth (email) | **reuse** | Ті самі люди, один вхід для CMO Space і AI Office |
| `cmo.members` | **integrate** | Початкове заповнення власників workspace PAVUTYNA |
| `cmo.agent_runs` | **integrate (read)** | Показ справжніх запусків наявних агентів в офісі |
| `cmo.tasks`, `space_documents` | **integrate (read), пізніше write через контракт** | Не дублюємо реєстр; передаємо затверджені результати як пропозиції |
| CMO Space (код) | **defer** | Статичний сайт без серверної частини, не підходить під оркестрацію |
| pg_cron | **reuse** | Можливий тригер воркера в майбутньому |
| `/produce` (локально) | **defer → фаза 4** | Не чіпаємо; лише версіонований контракт handoff |
| Claude Projects скіли | **defer** | Потрібен експорт від власника; потім перенесення з провенансом |
| `pvlinks` | **поза скоупом** | Але є критичний ризик безпеки |

## 4. Джерело правди за сутностями

| Сутність | Джерело правди | Примітка |
|---|---|---|
| Користувач | `auth.users` | Спільно з CMO Space |
| Workspace | `office.workspaces` | Нове. PAVUTYNA зіставлено з `cmo.tasks.workspace_key = 'pavutyna-cmo'` |
| Членство в workspace | `office.workspace_members` | Нове; власник PAVUTYNA береться з `cmo.members` (role = owner) |
| Задача команди | `cmo.tasks` | AI Office лише читає |
| Рішення (decision) | `cmo.space_documents['decisions']` | AI Office лише читає |
| Бриф | `office.briefs` | Нове |
| Запуск агента (AI Office) | `office.runs` + `office.steps` | Нове |
| Запуск наявного агента | `cmo.agent_runs` | Показуємо як є |
| Артефакт / версія | `office.artifacts` (незмінні) | Нове |
| Затвердження | `office.approvals` (незмінні) | Нове |
| Передача в продакшн | `office.handoffs` | Нове; споживач — майбутній локальний міст |

## 5. Чого бракує (блокує лише свою частину)

1. **Anthropic API-ключ** — власник вирішив стартувати на заглушці. Адаптер готовий, вмикається змінною `AI_PROVIDER=anthropic`.
2. **GitHub** — підключення до сесії для створення репозиторію.
3. **Експорт маркетингових скілів із Claude Projects** — для перенесення промптів ролей (зараз ролі мають базові промпти, позначені як `provenance: placeholder`).
4. **Дозвіл на `Videos\ProdProd-Studio`** — лише для фази 4.
