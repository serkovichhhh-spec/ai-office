# AI Office — Architecture

Статус: v1 для фази 1 (онлайн-ядро маркетингу). Принцип: **спочатку справжня автономія, потім контроль, а візуалізація зверху**.

## 1. Рішення: окремий застосунок, спільна база

- **Новий застосунок `ai-office`** (Next.js, TypeScript) — окремий Vercel-проєкт.
- **CMO Space не змінюється.** Це статичний сайт без серверної частини, він не може виконувати фонову оркестрацію.
- **База — наявний Supabase CMO**, нова схема `office`. Схеми `cmo` і `pvlinks` не змінюються: міграції лише додають нове.
- **Вхід спільний** (Supabase Auth, email). Ті самі люди, окремі права в AI Office.

Чому не новий Supabase: це роздвоїло б облікові записи й ускладнило б читання `cmo.agent_runs` / `cmo.tasks`. Ізоляцію забезпечують RLS, окрема роль БД і функції з перевірками, а не окрема база.

## 2. Компоненти

```
Браузер (desktop / mobile)
   │  HTTPS, cookie-сесія Supabase Auth
   ▼
Next.js на Vercel ──────────────────────────────────────────────┐
   │ Server Actions / Route Handlers                             │
   │ 1. перевіряє користувача (supabase.auth.getUser)            │
   │ 2. відкриває транзакцію з роллю `authenticated` і JWT-claims│
   │    → RLS виконується в Postgres                             │
   ▼                                                             │
Postgres (Supabase), схема `office`                              │
   briefs · runs · steps · events · artifacts · approvals ·     │
   handoffs · agents · knowledge_docs · workspaces · members    │
   ▲                                                             │
   │ office.worker_* (SECURITY DEFINER, лише роль office_app)    │
   │                                                             │
Воркер = /api/worker/tick  ◄── Vercel Cron щохвилини ────────────┘
   │                       ◄── «поштовх» одразу після подачі брифу
   ├─ claim кроку (FOR UPDATE SKIP LOCKED, lease 120 с)
   ├─ виконання ролі агента → AI-провайдер (stub | anthropic)
   └─ complete / fail / retry з backoff → події, артефакти
```

### 2.1 Доступ до БД — без відкриття схеми в публічний API
Схема `office` **не** додається в exposed schemas PostgREST. Застосунок підключається до Postgres напряму (pooler, transaction mode) окремою роллю **`office_app`**:
- `office_app` не має BYPASSRLS і не є власником таблиць;
- для запитів від імені користувача: `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims = {sub: <user id>}` у межах транзакції, тож працюють ті самі RLS-політики, що й у Supabase;
- функції воркера `office.worker_*` дозволено викликати лише ролі `office_app`. Після переходу на роль `authenticated` вони недоступні.

Пароль ролі передається в БД як **SCRAM-верифікатор** (не відкритим текстом), тож у логах SQL його немає. Сам рядок підключення зберігається лише в змінній Vercel типу sensitive.

### 2.2 Черга і воркер (durable без окремого сервера)
Черга — таблиця `office.steps`.
- **Claim:** `office.worker_claim(worker_id, n)` бере готові кроки через `FOR UPDATE SKIP LOCKED` і ставить lease (`locked_until`).
- **Heartbeat:** `office.worker_heartbeat(step_id, worker_id)` продовжує lease для довгих кроків.
- **Відновлення:** крок із простроченим lease повертається в чергу (новий attempt) або, якщо спроби вичерпано, переходить у `failed`. Саме так ловиться ситуація на зразок «запуск analyst #3 висить з учора».
- **Ідемпотентність:**
  - подача брифу — `runs.idempotency_key` (unique), повтор повертає той самий запуск;
  - завершення кроку — `worker_complete(step_id, worker_id, attempt)` приймається лише від власника lease і лише для поточного attempt, тож подвійне виконання не пише двічі;
  - handoff — `handoffs.idempotency_key` (unique, похідний від approval).
- **Retry:** експоненційний backoff (`next_attempt_at`), `max_attempts` на крок (за замовчуванням 3). Після вичерпання крок `failed`, запуск `failed`, у журналі подія `step.dead_lettered` (DLQ = кроки у `failed` з повним контекстом).
- **Ліміти:** `runs.budget_usd`, денний бюджет workspace, `max_steps` на запуск, тайм-аут кроку. Перевищення бюджету → запуск `failed` з причиною `budget_exceeded`.
- **Скасування:** `office.cancel_run` → кроки `cancelled`; воркер перевіряє статус перед записом результату.

Тригер воркера — **Vercel Cron щохвилини** (Pro) + поштовх одразу після подачі. Vercel не використовується як постійний процес: кожен виклик обробляє обмежену кількість кроків у межах `maxDuration`.

### 2.3 Оркестрація: плейбуки як граф кроків
Оркестратор — **детермінований код**, а не вільна LLM-петля. Плейбук задає:
- кроки, їхні залежності (DAG) і ролі агентів;
- що кожен крок отримує на вхід (бриф, затверджені знання workspace, виходи попередніх кроків);
- обмежену петлю ревізій: reviewer може повернути сценарії на доопрацювання **максимум 1 раз**.

Перший плейбук — `reels_concepts` («Розробити N рілсів»):

```
intake (orchestrator, код) → strategy (strategist) → scripts (copywriter)
   → review (reviewer) ──fail, ревізія ≤1──► scripts
                       └─pass──► package (orchestrator, код) → NEEDS_APPROVAL
```

Ролі налаштовуються (`office.agents`: назва, роль, системний промпт, рівень моделі, дозволені інструменти, увімкнено/вимкнено) окремо для кожного workspace.

### 2.4 AI-провайдер
Інтерфейс `AiProvider.generate({system, messages, schema, tier}) → {output, usage, model, costUsd}`.
- **`stub`** (поточний): детермінований структурований результат із брифу, `costUsd = 0`, `model = "stub"`. **Кожен артефакт має `provider: stub`, і в UI показується бейдж «STUB — без AI».** Це не імітація роботи: виконання, черга, статуси й артефакти справжні, але згенерований текст шаблонний, і це явно позначено.
- **`anthropic`**: Messages API зі структурованим виходом (tool use), облік токенів і вартості. Вмикається через `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. Рівні моделей (`fast` / `balanced` / `strong`) мапляться на конкретні моделі в конфігурації.

### 2.5 Стани (три окремі машини замість однієї)

| Сутність | Стани | Хто змінює |
|---|---|---|
| **Бриф** | `draft → active → done` · `cancelled` | користувач (через функції) |
| **Запуск** | `queued → running → needs_approval → approved → handoff_queued` · `needs_input` · `failed` · `cancelled` | воркер і функція `decide` |
| **Крок** | `pending → ready → running → succeeded` · `failed` · `cancelled` · `skipped` | воркер |
| **Handoff** | `queued → claimed → in_production → review → done` · `failed` · `cancelled` | майбутній локальний міст |

Дозволені переходи запуску перевіряє тригер у БД (`office.guard_run_transition`), тож обійти їх через API неможливо.

Відповідність стану з ТЗ: `DRAFT/READY` = бриф; `RUNNING/NEEDS_INPUT/NEEDS_APPROVAL/APPROVED/HANDOFF_QUEUED` = запуск; `IN_PRODUCTION/REVIEW/DONE` = handoff.

### 2.6 Затвердження
`office.decide(artifact_id, decision, rationale)` — єдиний шлях:
- перевіряє, що користувач має роль `owner` або `approver` у workspace;
- запуск має бути в `needs_approval`, а артефакт — **останньою версією** цього запуску;
- записує незмінний `approvals` зі snapshot `artifact_hash`;
- `approved` → запуск `approved` → створює `handoffs` (`queued`, idempotency key = approval id) → запуск `handoff_queued`;
- `revision_requested` → новий цикл кроків з коментарем (нова версія артефакту);
- `rejected` → запуск `cancelled`.

Таблиці `artifacts` і `approvals` захищені тригерами від UPDATE/DELETE (незмінність). Відкат = нове рішення поверх попереднього, історія зберігається.

### 2.7 Події → офіс
`office.events` — append-only журнал (`run.created`, `step.started`, `agent.activity`, `step.succeeded`, `artifact.created`, `approval.recorded`, `handoff.queued`, `step.failed`…). Кожна подія має `agent_role` і `activity` (`idle | researching | drafting | reviewing | waiting_approval | blocked | delivering`).

Майбутній піксельний офіс (фаза 3) **лише** відтворює стан із цих подій. Якщо подій немає, агенти стоять без діла. Уже у фазі 1 є простий «стан команди» на тих самих подіях.

Наявні агенти з `cmo.agent_runs` показуються через `office.legacy_agent_runs()` (SECURITY DEFINER, read-only, лише для власників workspace PAVUTYNA). Схема `cmo` не змінюється.

### 2.8 Handoff у продакшн (контракт v1)
`office.handoffs.payload` відповідає JSON-схемі `handoff.v1`:
- `schema_version`, `workspace`, `brief`, `approved_artifact {id, version, hash}`;
- `approval {id, approver, decided_at}`;
- `deliverables`, `acceptance_criteria`;
- `idempotency_key`.

Споживач (фаза 4): локальний міст робить **вихідне** автентифіковане опитування, забирає лише затверджені handoff-и й повертає статуси. Веб ніколи не виконує shell.

## 3. Безпека
- RLS на всіх таблицях `office`; кожен рядок має `workspace_id`; доступ лише для членів workspace.
- Клієнт ніколи не пише в `runs/steps/artifacts/approvals/handoffs` напряму: лише через функції з перевірками (INSERT/UPDATE-політик для `authenticated` немає).
- Секрети тільки на сервері (`server-only`), жодних `NEXT_PUBLIC_*`, крім URL Supabase і publishable key.
- Отримані тексти (знання, бриф) подаються моделі як **дані** в розмежованих блоках; вихід моделі валідується схемою (zod) перед записом.
- Аудит: усі дії в `office.events` з `actor_id`.

## 4. Технології
Next.js 15 (App Router) · TypeScript · `postgres` (postgres.js) · `@supabase/ssr` (лише auth) · zod · Vitest (юніт) · SQL-тести на локальному Postgres 16 (ізоляція, переходи, ідемпотентність).
