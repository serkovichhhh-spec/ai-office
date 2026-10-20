# Architecture Review Round 2 — §15 Acceptance criteria і rollback (+ C1 деталізація)

Джерело істини: документ «AI Office v2 — Architecture Review Round 2», розділ 15 (стан на 19.10.2026)
і рішення власника 19.10 (розділ 17). Цей файл — копія для виконавців без доступу до документа.

## §15. Таблиця

| Робота | Готово, коли | Rollback |
|---|---|---|
| 0008 identity | Чинні тести зелені; ChatGPT № 1 працює без перепідключення; SQL-тест `not_independent`; новий виконавець стартує без ролей | Міграція адитивна → redeploy попереднього коміту; нові колонки лишаються |
| Пауза старої задачі | Задача `enabled = false` | Увімкнути знову |
| provider_policies (P0) | Envelope для Claude не містить записів вище за дозволений клас; запис у `external_transfers` на кожен get/claim | `governance_enforced = false` (лише логування) |
| **C1** | Routine v2 без Supabase робить claim → submit у sandbox; `whoami` = `claude_main`; 3 запуски поспіль | Нову задачу вимкнути, стару — увімкнути |
| Legacy off | 7 днів без `gateway.bypass_detected` | `legacy_agent_api = true` |
| W1 | 6 перевірок із розділу 3 | Revoke `gpt-b` |
| G0–G3 | Для кожної можливості Grok — V/T/U з доказом | Revoke `grok_main`; конектор у Grok видалити |
| stubgen | Stub для всіх 9 нових схем проходить Ajv; старі unit-тести зелені | Revert коміту |
| 0009 + skills | Кандидат із research з'являється в UI знань; після approve цитується наступним run; у TaskEnvelope є `skills[cmo@1.0.0]` + `context` | Нові поля опційні |
| Intelligence v2 | GB1–GB5 проходять auto checks; GB1 власник оцінює вище за пілот 18.10 | У каталозі знову `@1` |
| 0010 files | F1, F3, F4, F6, F7 пройдено; F2 — відомий результат | Нові дії MCP вимкнути в ChatGPT Admin; прапорець `files_enabled` |
| CV1, EL1 | Файл із Canva та ElevenLabs у Storage з provenance і rights | — |
| 0012 Router | `gateway_list` для чинних кроків не змінився (SQL-тест на знімку) | Попередня версія `gateway_list` |
| 0011 Trigger Gateway | 20 тригерів у sandbox: ≥ 90 % доходять до `task_completed`; circuit breaker і fallback спрацьовують на штучних збоях | `TRIGGERS_DISABLED=1` |
| Playbooks A, E, C | Фінали проходять Tech QA; жодного фіналу з `rights ≠ yes` | Приховати в каталозі |

Загальне правило: жодна міграція не видаляє і не перейменовує чинні колонки чи функції; кожна нова поведінка має прапорець; старий шлях живе ≥ 7 днів після приймання нового.

## C1 — деталізований чекліст (CTO, 20.10)

Передумови:
- Виконавець `claude_main` створює власник через екран згоди («Новий виконавець», label `claude_main`); ролі видаються явно в панелі «Виконавці» (лише потрібні для sandbox-кроку).
- Список конекторів запланованої задачі в Claude не редагується (задача отримує всі конектори акаунта). Тому промпт routine явно дозволяє ЛИШЕ 5 інструментів AI Office і забороняє будь-які інші; запис у Meta Ads уже заблоковано на рівні акаунта.
- Стара задача «AI Office: відпрацювати чергу» на паузі; `legacy_agent_api` = true до завершення етапу «Legacy off».

Sandbox: окремий бриф із позначкою `[C1 sandbox]` у workspace PAVUTYNA, сценарій з одним Claude-кроком, знання лише `public`/`internal`.

| # | Перевірка | Очікування | Де дивитись |
|---|---|---|---|
| C1.1 | `office_get_team_status` на старті | `you.label = claude_main`, `provider = anthropic`, `max_data_class = internal` | вивід routine |
| C1.2 | claim | подія `attempt.claimed` з `executor_label = claude_main` | стрічка run |
| C1.3 | submit | `step.agent_submitted`, далі `step.succeeded` (контракт пройшов перевірку) | стрічка run |
| C1.4 | аудит | рядок у `office.external_transfers` (provider `anthropic`, op `claim`, data_class ≤ internal) | SQL (перевіряє Claude) |
| C1.5 | без обходу | жодної події `gateway.legacy_used` / `gateway.bypass_detected` за час тесту; routine не викликала Supabase чи інші конектори | стрічка + історія сесії |
| C1.6 | порожня черга | routine коректно завершується на `no_tasks`, без помилок | вивід routine |
| C1.7 | стабільність | 3 запуски поспіль (окремі кроки) — усі C1.1–C1.6 зелені | — |
| C1.8 | ліміт | падіння з `USAGE_LIMIT_REACHED` — не провал C1: повторити після скидання і зафіксувати в звіті | історія задачі |

Rollback: вимкнути нову задачу; за потреби увімкнути стару; revoke `claude_main`.
