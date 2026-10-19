# Передача роботи Claude -> Codex: Implementation Plan v1

Оновлено 19.10.2026. Реалізація знаходиться в [PR #1](https://github.com/serkovichhhh-spec/ai-office/pull/1), гілка `fix/office-professional-workflow`. Main і нові production-міграції не змінені. Злиття лишається до явного підтвердження Дмитра Валерійовича.

## Джерела та узгодження паралельної роботи

План Claude «Implementation Plan v1» прийнято як специфікацію. Файл плану сам по собі не був реалізацією чи деплоєм. Перевірено main `26eb29461f3a5cfa4ab112e00c737968775bf907`: збереження коментаря власника через кожне коло рев’ю лишається в основі PR. Базові зміни ролей і CMO-брифу: `350c4a8`; перший checkpoint ідентичності та intelligence: `fd325cf`.

Seat, Execution Gateway і Versioned Blackboard збережені. Сесії ChatGPT/Claude здають один JSON на крок через MCP. Платний Model API не став обов’язковою залежністю. Trigger API є окремою необов’язковою можливістю; його фактичні кредити ще не виміряно.

## Статус за етапами

| Етап | Реалізація в PR | Статус приймання |
|---|---|---|
| 0. Executor identity | Нове підключення / явне перепідключення, label, allowed seats, capabilities, незалежність за executor_id | SQL і MCP пройдені; I2 з двома реальними акаунтами ще не пройдений |
| 1. Marketing Intelligence | Діагноз, повний CMO-бриф, research, draft candidates, creative Challenge, conditional, версійовані skills | Контракти, SQL, E2E та незалежний forward-test пройдені; golden briefs потребують оцінки власника |
| 2. Files / optional triggers | Приватні файли, fileParams, file spike, телефонний upload; контрольований dispatcher, watchdog, ліміти та вимикачі | Автоматичні перевірки пройдені; реальні F/T/H acceptance ще не пройдені |
| 3. Shadow WorkPlan | Закрита схема, відомі playbook/input contracts, DAG, дедлайни, знання, depth caps | Автоматичні перевірки пройдені; 3-5 реальних shadow-планів ще не оцінені |
| 4. Program Engine | Явне схвалення плану/бюджету, дочірні runs, залежності, owner gates, загальні ліміти, скасування | SQL/E2E пройдені; engine вимкнений за замовчуванням і ще не прийнятий для пілота |

«Реалізовано» означає наявність коду і перевірок у PR. Це не означає, що зовнішні можливості ChatGPT підтверджені, production розгорнуто або всі працівники професійно атестовані.

## Ролі, контекст і якість

16 ролей мають обов’язки, керівника, професійні методи, критерії якості й формат передачі. CMO відповідає за достатність вводних перед копірайтером чи дизайнером. Нові версії 12 процесів починають змістовну роботу з діагнозу та CMO-брифу; він містить продукт, УТП, умови, покриття, аудиторію, докази, канал, CTA, обмеження й вимірювання. Твердження спираються на конкретні knowledge ID/version/pointer. Пропущений контекст направляється відповідальному upstream, а не маскується переписуванням тексту.

У попередньому етапі в PAVUTYNA вже оновлено 16 профілів і методи через дозволений DML; події 113/114. Цей етап не повторював production-записів. У чинних approved knowledge були п’ять документів; відсутність покриття в пакеті не означає відсутність цих даних у компанії. Нових бізнес-фактів не вигадано. Приватні локальні skills Claude на його ПК недоступні й не змінювалися.

Нова bootstrap-міграція створює 16 профілів для нових workspace, зберігає наявні кастомні профілі. Owner-only sandbox створюється без копіювання задач і бізнес-знань.

## Ідентичність, незалежність та сумісність

Нове OAuth-підключення створює нову ідентичність; перепідключення перевіряє власника, workspace, kind і revoke. Чинні token hashes збережені. Owner налаштовує allowed seats, режим і capabilities з датою та доказом; MCP не дозволяє виконавцю довільно атестувати себе. Реально спостережений file attach у sandbox може підтвердити тільки `file_attach`, не `image_generation`.

Нові графи використовують capability routing. Непідтверджені або NULL-умови не надають доступу. Незалежний reviewer не може бути фактичним автором актуальних творчих матеріалів. Авторство лише продуктового брифу чи дослідження не прирівнюється до авторства концепції. За відсутності attempt діє обережний fallback за kind.

Legacy `reels_concepts@1`, `ooh_concepts@1` і версії бібліотеки зберігають старі графи. Їхні спеціалізовані source-файли відновлені з `26eb294`; зміни нових схем не підміняють старі runs. Нові версії доступні через `OFFICE_PLAN_V1_WORKSPACES`, default `sandbox`; фактичний workspace перевіряє сервер. Читання executor-полів сумісне з БД до міграцій.

## Intelligence і skills

`research_brief@1`: diagnosis -> research -> candidates -> package. Сервер створює draft knowledge з origin run/executor, confidence, sources, expiry та idempotency hash. Кандидати не стають approved без власника; provenance не підробляється browser insert. Прострочені знання виключаються з контексту.

Creative Challenge у нових OOH/graphic/art direction/ideation/reels перевіряє поточний artifact ID/version і кожен concept ID. Для weak обов’язкова сильніша альтернатива; rethink є рекомендацією. Непідтверджена суттєва обіцянка робить пакет conditional. БД блокує його виробниче схвалення. Окреме схвалення концепції ідемпотентне, журналюється, залишає needs_approval і не створює handoff.

`creative-challenge`, `ooh-copy`, `research-method` мають процедуру, checklist, anchored rubric, приклади й UI metadata. Версія та SHA-256 фіксуються для run; envelope несе точний текст, а не лише назву навички. Компіляція: `scripts/build-skills.ts`.

## Файли та MCP

Private bucket `office-files`, PNG/JPEG/WebP/PDF, максимум 25 MB. Metadata містить run/step/attempt/executor, SHA-256, MIME за сигнатурою, розміри й походження. Дедуплікація за run/hash. Завантаження перевіряє HTTPS, публічну pinned DNS/IP-адресу, redirects, timeout, streaming size та фактичний формат. Lease перевіряється до мережевого завантаження й після нього; порядок блокувань починається з executor. Чужі або невідомі `aio_file_` references не приймаються, поточна lease при цьому зберігається.

MCP має `office_attach_file` / `office_get_file` для allowlisted workspace. `_meta.openai/fileParams` описує всі чотири поля; required лише URL та file ID. Читання перевіряє scope і повертає короткий private URL на 10 хвилин; image-content обмежено 3 MB. Upload з UI/телефона обмежено 4 MB через hosting request limit; MCP приймає до 25 MB. Server Action body limit 4.25 MB. Це свідоме відхилення від єдиного файлового ліміту в чернетці плану.

`file_spike@1` доступний лише sandbox: власник створює реальне завдання з UI, сесія прикріплює файл або чесно повідомляє blocked. `SUPABASE_SERVICE_ROLE_KEY` потрібен лише серверу для private Storage. Він не передається в чат чи TaskEnvelope і в межах цієї роботи не запитувався.

## Необов’язкові тригери

За замовчуванням вимкнені глобальний dispatcher, cron, workspace і channel. Ручна кнопка «Викликати агента один раз» доступна власнику; перевіряє фактичний workspace та всі ліміти. Cron має окремий `OFFICE_TRIGGER_CRON_ENABLED=false` до проходження T4. `TRIGGERS_DISABLED=1` є аварійним server switch. На головній workspace є мобільний kill switch; нові triggered claims після зупинки заборонені, уже взята робота може бути здана.

Джерелом є тільки `awaiting_agent`, а не `ready`: інакше розбуджений агент ще не міг би claim. Резервації серіалізуються settings row; одна logical event має один idempotency key, HTTP retry максимум двічі після першого запиту. Є max concurrency, добовий і місячний estimate, 2 тригери/step, 8/run, загальний cap/program. NaN/Infinity не обходять бюджет. Після трьох послідовних failed/expired або вичерпання кредитного ліміту канал ставиться на паузу з подією в UI. 401/403 вимикають канал; відсутня/неправильна credential також.

Початкові поля пілота: 10/добу, 1 одночасно, 300 кредитів/місяць, оцінка 25 до власного вимірювання. Увімкнення вимагає запису price evidence. Це запобіжні оцінки; реальне списання та тверду стелю треба встановити в ChatGPT Admin.

Server secret reference дозволяє лише `OFFICE_AGENT_*`. Platform `sk-` key відхиляється. У POST лише task ID і conversation key; результат повертається виключно через MCP. Watchdog обробляє no_claim, suspended, lease expiry, rejected і completed без submit; status polling best effort, 404/405 не блокують fallback. Реальних API-запусків та витрат не було.

## WorkPlan і Program Engine

Shadow-план має відомі playbooks з точними brief schemas, валідні dates, approved knowledge того ж workspace, DAG, owner gates, унікальні ID, ліміти 2/4/6 та заборону рекурсивного program. Сам план не створює child runs.

Старт engine потребує окремого owner approval актуального плану без open questions і позитивного бюджету в межах parent run. Створення child runs атомарне, ідемпотентне, з pinned versions; сума child budgets не перевищує parent. Залежності чекають схваленого upstream package й owner gate. Research child готовий лише після обробки draft candidates і принаймні одного approved knowledge.

Upstream artifacts входять у контекст з run/version/hash і позначені як untrusted content. Input hashes враховують ці джерела; застарілий submit не застосовується. Загальні витрати й тригери обмежуються програмою. Скасування root зупиняє children, steps, leases та queued handoffs. Блокування узгоджено для cancel/worker; native concurrency ще потрібно перевірити окремо.

## Перевірки на фінальному коді

| Перевірка | Результат |
|---|---|
| Unit/contract tests | 102 passed, 9 suites |
| Реальні міграції, SQL functions, RLS acceptance | 186 passed на ізольованому PGlite PostgreSQL |
| Legacy runtime E2E | 30 passed |
| MCP E2E | 38 passed |
| Intelligence + files + program E2E | 48 passed |
| TypeScript / production build | passed |
| Три skill packages | quick_validate passed |
| Незалежний Challenge forward-test з реальним JSON Schema | Контракт та точний artifact/concept scope пройдені; загальний слоган і недоведені 24 години відхилені, корисний адресний CTA збережено |

E2E використовує справжні міграції, SQL/RLS, worker і MCP. Модельні відповіді, зовнішні байти й Storage замінено контрольованими fixtures. Це не реальна перевірка image generation, реального fileParams host або платного trigger API.

Native PostgreSQL підготовлено як тимчасову залежність, але запуск заблокований середовищем: `chown: Invalid argument`, `runuser: cannot set groups: Operation not permitted`. Сервер не стартував; обхід системних обмежень не виконувався. Міжсесійні SKIP LOCKED, паралельні reserve/claim, cancel-vs-submit і deadlock stress залишаються release gate. Embedded PostgreSQL їх не доводить.

Команди відтворення:

```bash
npm test
npm run typecheck
npm run build
npm run test:sql:embedded
E2E_EMBEDDED=1 node --import tsx scripts/e2e-local.ts
E2E_EMBEDDED=1 node --import tsx scripts/e2e-mcp.ts
E2E_EMBEDDED=1 npm run test:e2e-intelligence
```

## Міграції і rollout після рішення власника

У PR шість нових CLI-created міграцій, у порядку timestamp:

1. `20261019062005_office_executor_identity.sql`
2. `20261019062437_office_intelligence.sql`
3. `20261019064010_office_artifact_files.sql`
4. `20261019064725_office_trigger_gateway.sql`
5. `20261019093201_office_program_engine.sql`
6. `20261019094403_office_workspace_bootstrap.sql`

Для CHECK enum constraints виконується транзакційна заміна constraint. Дані/таблиці не видаляються; це технічне уточнення буквального «жодних DROP». Нова OAuth-функція має 7 явних аргументів без default, стара 5-аргументна обгортка збережена.

Перед rollout: native concurrency у окремій staging DB; snapshot/backup й перевірка міграцій на копії; owner approval merge. Після цього міграції й сумісний код, усі автоматичні прапорці вимкнені. Створити sandbox, перевірити старі підключення без reconnect, I2, F1-F7, T1-T6/H3/H4, 10 реальних вимірювань ціни T5, golden briefs і 3-5 shadow-планів. Лише потім окремо дозволити sandbox engine; cron після T4. PAVUTYNA pilot T7 має окреме рішення власника.

Відкат починається із заборони нових run/trigger/program. Чинні pinned runs нових версій не можна віддавати старому коду, який цих версій не знає. Міграції не відкочувати видаленням даних; при дефекті використовувати forward fix або сумісну попередню поведінку. Приватні business records і token hashes зберігати.

## Що Claude має взяти після повернення

Перевірити фінальний diff PR, особливо шість міграцій, lock order, capability/independence, program-wide budgets і сумісність legacy. Не повторювати production role DML і не міняти старим runs playbook_version. Закрити native concurrency та ручні acceptance з реальними доказами; не підміняти їх fixture JSON. Нічого не зливати до підтвердження власника.

Офіційні опори інтеграцій: [fileParams](https://developers.openai.com/plugins/reference), [Workspace Agent trigger runs](https://developers.openai.com/workspace-agents/trigger-runs), [authentication](https://developers.openai.com/workspace-agents/authentication), [Supabase private Storage](https://supabase.com/docs/guides/storage/serving/downloads).
