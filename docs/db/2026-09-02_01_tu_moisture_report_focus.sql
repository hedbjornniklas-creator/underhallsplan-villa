-- TU moisture report editorial focus
-- Date: 2026-09-02
-- Scope:
-- 1) Reduce new moisture investigation reports to four focused sections
-- 2) Keep existing investigations unchanged because their report drafts are copied snapshots
-- 3) Bump the system template version for traceability

update public.settings_tu_report_templates
set
  description = 'Fuktskadeutredning med fokuserat besiktningsunderlag, redaktionellt relevansurval och granskat AI-förslag.',
  version = greatest(version, 2),
  updated_at = now()
where key = 'moisture_damage_investigation'
  and is_system = true;

delete from public.settings_tu_report_template_sections section_row
using public.settings_tu_report_templates template
where section_row.template_id = template.id
  and template.key = 'moisture_damage_investigation'
  and template.is_system = true;

with seed_rows (
  template_section_key,
  section_type_key,
  title_override,
  ai_instruction,
  sort_order
) as (
  values
    (
      'scope_questions_boundaries',
      'assignment_scope',
      'Uppdrag och avgränsning',
      'Beskriv kort den tekniska frågan, vad som kontrollerades och relevanta avgränsningar i besiktningsmannens egen röst.',
      100
    ),
    (
      'investigation_observations',
      'observed_execution',
      'Genomförande och iakttagelser',
      'Redovisa genomförandet och de iakttagelser eller kvalificerade mätresultat som behövs för att besvara huvudfrågan. Undvik bakgrundsfakta utan betydelse för bedömningen.',
      200
    ),
    (
      'assessment_conclusion',
      'technical_assessment',
      'Teknisk bedömning och slutsats',
      'Besvara uppdragets huvudfråga genom att väga samman relevanta iakttagelser. Skilj verifierat från bedömt och ange endast begränsningar som påverkar slutsatsen.',
      300
    ),
    (
      'recommended_follow_up',
      'recommended_actions',
      'Rekommenderad fortsatt hantering',
      'Ange endast fortsatta kontroller eller åtgärder som följer proportionerligt av den tekniska bedömningen. Utse inte juridiskt ansvarig part.',
      400
    )
)
insert into public.settings_tu_report_template_sections (
  template_id,
  template_section_key,
  section_type_key,
  title_override,
  default_content,
  ai_instruction,
  sort_order,
  is_required,
  include_in_toc,
  allow_delete
)
select
  template.id,
  seed_rows.template_section_key,
  seed_rows.section_type_key,
  seed_rows.title_override,
  null,
  seed_rows.ai_instruction,
  seed_rows.sort_order,
  true,
  true,
  false
from seed_rows
join public.settings_tu_report_templates template
  on template.key = 'moisture_damage_investigation'
 and template.is_system = true
on conflict (template_id, template_section_key) do update
set
  section_type_key = excluded.section_type_key,
  title_override = excluded.title_override,
  default_content = excluded.default_content,
  ai_instruction = excluded.ai_instruction,
  sort_order = excluded.sort_order,
  is_required = excluded.is_required,
  include_in_toc = excluded.include_in_toc,
  allow_delete = excluded.allow_delete,
  updated_at = now();
