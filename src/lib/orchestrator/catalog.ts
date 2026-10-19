/** Serialisable brief-form catalogue types (shared by server and the client brief form). */

export type FieldType = "text" | "textarea" | "select" | "list" | "number" | "date" | "datetime" | "knowledge" | "knowledge_multi";

export interface BriefFieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface CatalogEntry {
  key: string;
  version: number;
  title: string;
  label: string;
  description: string;
  priority?: "P1" | "P2" | "P3";
  group: string;
  maxCount: number;
  fields: BriefFieldSpec[];
  hidden?: boolean;
}

export const FIELD_LABEL: Record<string, string> = {
  period_start: "Початок періоду", period_end: "Кінець періоду", channels: "Канали", pillars: "Рубрики",
  capacity_knowledge_ids: "Ресурси команди (знання)", events_knowledge_ids: "Події й інфоприводи (знання)",
  content_kind: "Вид контенту", plan_item_ids: "Елементи затвердженого плану", available_asset_ids: "Доступні матеріали",
  production_constraints: "Обмеження продакшну", platform_spec_knowledge_ids: "Технічні вимоги платформ (знання)",
  placements: "Місця розміщення", format_knowledge_ids: "Специфікації форматів (знання)", asset_ids: "Доступні матеріали",
  art_direction_artifact_id: "Затверджений артнапрям (ID)", required_copy: "Обов'язкові тексти",
  campaign_channels: "Канали кампанії", mandatory_asset_ids: "Обов'язкові матеріали", visual_constraints: "Візуальні обмеження",
  reference_notes: "Коментарі до референсів", idea_kind: "Що шукаємо", candidate_count: "Скільки ідей згенерувати (6–12)",
  creative_boundaries: "Межі: що можна і що не можна", rejected_ideas: "Раніше відхилені ідеї",
  platform: "Платформа", offer_knowledge_id: "Пропозиція / тариф (знання)", geo_knowledge_ids: "Географія (знання)",
  budget_knowledge_id: "Бюджет (знання)", conversion_knowledge_id: "Відстеження конверсій (знання)",
  landing_knowledge_id: "Посадкова сторінка й CTA (знання)", video_kind: "Тип відео", duration_seconds: "Тривалість, сек",
  voice_style: "Стиль озвучення", medium: "Носій", supplier_spec_knowledge_id: "Специфікація друкарні / оператора (знання)",
  placement_knowledge_ids: "Площини / місця розповсюдження (знання)", cta_route_knowledge_id: "Маршрут звернення CTA (знання)",
  mandatory_copy: "Обов'язкові тексти", launch_channels: "Канали запуску", launch_at: "Дата й час запуску",
  readiness_knowledge_ids: "Стан готовності (знання)", previous_offer_knowledge_id: "Попередня пропозиція (знання)",
  dataset_knowledge_ids: "Дані для аналізу (знання)", period: "Період аналізу", comparison_period: "Період порівняння",
  metric_keys: "Метрики", decision_question: "Яке рішення має підтримати звіт", competitors: "Конкуренти",
  dimensions: "Критерії порівняння", source_knowledge_ids: "Затверджені джерела (знання)", research_mode: "Режим дослідження",
  copy_kind: "Вид тексту", message_knowledge_ids: "Факти й умови повідомлення (знання)",
  destination_knowledge_id: "Куди веде CTA (знання)", delivery_spec_knowledge_id: "Технічні вимоги каналу (знання)",
  publication_at: "Дата публікації", mandatory_sections: "Обов'язкові блоки",
};

export const ENUM_LABEL: Record<string, string> = {
  post: "Пост", stories: "Сторіз", carousel: "Карусель", short_video: "Коротке відео",
  campaign: "Ідея кампанії", activation: "Активація", hook: "Гачок / хук", naming: "Назва", mechanic: "Механіка",
  meta: "Meta (Facebook, Instagram)", google: "Google Ads",
  reel: "Рілс", promo: "Промо-ролик", explainer: "Пояснювальне відео", testimonial: "Відгук клієнта",
  billboard: "Білборд", citylight: "Сітілайт", flyer: "Флаєр", a4: "А4", other: "Інше",
  knowledge_only: "Лише затверджені знання", candidate_collection: "Зібрати нові джерела на перевірку",
  website: "Сторінка сайту", landing: "Лендінг", email: "Email", sms: "SMS", pr: "PR-новина", ivr: "IVR (автовідповідач)", faq: "FAQ",
};

export const PLAYBOOK_GROUP: Record<string, string> = {
  reels_concepts: "Контент і SMM", social_content_pack: "Контент і SMM", smm_content_plan: "Контент і SMM",
  graphic_design_pack: "Дизайн і креатив", campaign_art_direction: "Дизайн і креатив", creative_ideation: "Дизайн і креатив",
  outdoor_print_pack: "Дизайн і креатив", ooh_concepts: "Дизайн і креатив",
  paid_media_campaign: "Реклама й запуски", offer_launch: "Реклама й запуски", owned_media_copy: "Реклама й запуски",
  campaign_analysis: "Аналітика", competitor_analysis: "Аналітика",
};
