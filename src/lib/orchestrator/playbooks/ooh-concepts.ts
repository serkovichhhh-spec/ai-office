import { z } from "zod";
import { playbookFromSpec, type PlaybookSpec } from "../spec";

const claims = z.array(z.string().max(300)).max(10);

export const OohStrategySchema = z.object({
  summary: z.string().min(1).max(1200),
  audience_insight: z.string().min(1).max(600),
  key_messages: z
    .array(
      z.object({
        message: z.string().min(1).max(120),
        rationale: z.string().min(1).max(500),
        evidence: z.array(z.string().max(200)).max(10),
      }),
    )
    .min(1)
    .max(6),
  placement_constraints: z.array(z.string().max(300)).max(10),
  open_questions: z.array(z.string().max(300)).max(10),
  claims_needing_source: claims,
});

export const OohConceptsSchema = z.object({
  concepts: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        big_idea: z.string().min(1).max(400),
        headline: z.string().min(1).max(60),
        subline: z.string().max(90),
        cta: z.string().min(1).max(40),
        word_count: z.number().int().min(1).max(20),
        visual: z.string().min(1).max(600),
        composition: z.string().min(1).max(500),
        mascot_use: z.string().max(250),
        why_it_works: z.string().min(1).max(400),
        risks: z.array(z.string().max(250)).max(5),
        claims_needing_source: claims,
      }),
    )
    .min(1)
    .max(6),
});

export const OohDesignSpecsSchema = z.object({
  specs: z
    .array(
      z.object({
        concept_title: z.string().min(1).max(80),
        formats: z
          .array(
            z.object({
              format: z.string().min(1).max(80),
              size: z.string().min(1).max(60),
              layout: z.string().min(1).max(500),
              safe_zone: z.string().max(200),
            }),
          )
          .min(1)
          .max(8),
        typography: z.string().min(1).max(400),
        palette: z.string().min(1).max(300),
        assets_needed: z.array(z.string().max(150)).max(12),
        ai_background_prompt: z.string().max(900),
        print_notes: z.string().max(500),
        checklist: z.array(z.string().max(200)).min(1).max(12),
        claims_needing_source: claims,
      }),
    )
    .min(1)
    .max(6),
});

const n = (c: { brief: { deliverable_count: number } }) => Math.min(Math.max(c.brief.deliverable_count, 1), 6);

export const oohConceptsSpec: PlaybookSpec = {
  key: "ooh_concepts",
  title: "Зовнішня реклама й поліграфія",
  label: "Білборди, сітілайти, флаєри, А4",
  description: "Стратегія меседжу → візуальні концепції → ТЗ для дизайнера з форматами й промптами → рев'ю → пакет на затвердження.",
  briefFields: [
    { key: "formats", label: "Формати й кількість носіїв", type: "textarea", required: true, maxLength: 1000,
      placeholder: "Білборд 6×3 м — 8 шт.\nСітілайт 1,2×1,8 м — 2 шт." },
    { key: "locations", label: "Де стоятимуть носії", type: "textarea", maxLength: 1500,
      hint: "адреси або райони; від цього залежить локальний меседж", placeholder: "Трасa Київ–Чоп, виїзд з міста\nЖК «Сонячний», зупинка" },
    { key: "offer", label: "Оффер", type: "text", maxLength: 300,
      hint: "лише підтверджений: тариф, ціна, акція", placeholder: "Без конкретного офферу — іміджева кампанія" },
    { key: "mandatory", label: "Обов'язкові елементи", type: "textarea", maxLength: 800,
      placeholder: "Лого, маскот, QR на l.pavutyna.com/s/…, телефон" },
    { key: "tone", label: "Дозволений тон", type: "select", options: [
      { value: "calm", label: "Спокійний, впевнений" },
      { value: "ironic", label: "З іронією" },
      { value: "provocative", label: "Можна провокаційний" },
    ] },
  ],
  steps: [
    {
      key: "strategy",
      title: "Стратегія меседжу",
      seat: "strategist",
      schemaName: "ooh_strategy",
      schema: OohStrategySchema,
      role: "Ти — маркетинговий стратег зовнішньої реклами телеком-оператора.",
      inputs: [],
      activity: "researching",
      task: (ctx) =>
        `Сформуй стратегію для зовнішньої реклами: інсайт аудиторії, ${n(ctx)}–${n(ctx) + 2} ключових меседжів і обмеження носіїв ` +
        "(дистанція й час контакту, кількість слів, освітлення, локальність). У evidence — назви документів із <knowledge>.",
      summary: (o) => `Ключових меседжів: ${o.key_messages.length}`,
    },
    {
      key: "concepts",
      title: "Візуальні концепції",
      seat: "creative_director",
      schemaName: "ooh_concepts",
      schema: OohConceptsSchema,
      role: "Ти — арт-директор, який робить концепції зовнішньої реклами в межах брендбука.",
      inputs: ["strategy"],
      task: (ctx) =>
        `Створи рівно ${n(ctx)} різних концепцій носія. Одна ідея — один меседж. Заголовок до 7 слів, увесь текст на носії — до 12 слів ` +
        "(word_count). Візуал і композиція мають читатися з дороги за 3 секунди. Дотримуйся брендбука з <knowledge> і дозволеного тону з брифу.",
      summary: (o) => `Концепцій: ${o.concepts.length}`,
    },
    {
      key: "design_specs",
      title: "ТЗ для дизайнера",
      seat: "print_designer",
      schemaName: "ooh_design_specs",
      schema: OohDesignSpecsSchema,
      role: "Ти — дизайнер друкованої та зовнішньої реклами; пишеш точні ТЗ до макетів.",
      inputs: ["strategy", "concepts"],
      task: () =>
        "Для кожної концепції напиши ТЗ: усі формати з брифу (розмір, композиція, безпечна зона), типографіка й палітра з брендбука, " +
        "потрібні ассети (лого, маскот, іконки), промпт англійською для AI-фону без тексту й без логотипів, вимоги друку (вильоти, dpi, CMYK) і чекліст перевірки макета.",
      summary: (o) => `ТЗ для концепцій: ${o.specs.length}`,
    },
  ],
  review: {
    seat: "reviewer",
    sendBackTo: "concepts",
    criteria: [
      { key: "brief_fit", what: "Відповідність меті, аудиторії й форматам брифу.", pass_if: "кожна концепція закриває мету і всі формати мають ТЗ" },
      { key: "readability", what: "Читабельність з дороги.", pass_if: "заголовок ≤ 7 слів, увесь текст ≤ 12 слів, одна ідея на носій" },
      { key: "brand", what: "Відповідність брендбуку з knowledge.", pass_if: "кольори, лого, маскот і тон не суперечать брендбуку" },
      { key: "facts", what: "Факти лише з knowledge.", pass_if: "усі цифри, ціни, покриття й контакти або з knowledge, або в claims_needing_source" },
      { key: "distinctness", what: "Концепції справді різні.", pass_if: "різні меседжі або різні візуальні ідеї" },
      { key: "producibility", what: "ТЗ достатньо, щоб дизайнер зробив макет без уточнень.", pass_if: "є розміри, композиція, ассети, промпт і чекліст" },
    ],
  },
  package: {
    title: (ctx) => `Зовнішня реклама: ${ctx.brief.title}`,
    sections: [
      { kind: "strategy", label: "Стратегія" },
      { kind: "concepts", label: "Концепції" },
      { kind: "design_specs", label: "ТЗ для дизайнера" },
    ],
  },
  handoff: { to: "print_designer", note: "Макети за ТЗ: рендер PNG/PDF із вильотами для друкарні" },
};

export const oohConcepts = playbookFromSpec(oohConceptsSpec);
