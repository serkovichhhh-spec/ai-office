# AI Office

Маркетинговий відділ з AI-агентів для кількох бізнесів (workspace-ів). Фаза 1 — онлайн-ядро: бриф → агенти → пакет → затвердження → черга в продакшн.

- Архітектура: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Аудит: [`docs/DISCOVERY.md`](docs/DISCOVERY.md) · План: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) · Ризики: [`docs/RISKS.md`](docs/RISKS.md)
- Експлуатація: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)

## Як це працює
1. Учасник workspace подає бриф (`office.create_brief` + `office.submit_brief`, ідемпотентно).
2. Воркер (`/api/worker/tick`, Vercel Cron щохвилини + поштовх після подачі) бере кроки з черги `office.steps` (`SKIP LOCKED`, lease, heartbeat, ретраї).
3. Плейбук `reels_concepts`: intake → strategy → scripts → review (≤1 повернення) → package.
4. Власник або approver затверджує останню версію (`office.decide`) → `office.handoffs` у статусі `queued` (контракт `handoff.v1`).
5. Локальний `/produce` забиратиме handoff-и через майбутній міст (фаза 4).

## AI-провайдер
`AI_PROVIDER=stub` (зараз) — шаблонний текст, позначений «STUB — без AI»; усе інше справжнє.
`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` — Claude через Messages API зі структурованим виходом. Код міняти не треба.

## Розробка
```bash
npm install
npm test                 # unit (vitest)
npm run test:sql         # 58 SQL-тестів: ізоляція, права, черга, затвердження (локальний Postgres)
E2E_ADMIN_URL=postgres://postgres:<pw>@localhost:5432/postgres npm run test:e2e-local
npm run dev              # з .env.local (див. .env.example)
```
