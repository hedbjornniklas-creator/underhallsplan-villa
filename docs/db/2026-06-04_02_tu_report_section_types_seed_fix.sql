-- Technical investigations report section type seed fix
-- Date: 2026-06-04
-- Scope:
-- 1) Add a plain unique key index for admin upserts
-- 2) Re-seed standard TU report section headings after the initial catalog migration

create unique index if not exists settings_tu_report_section_types_key_plain_unique_idx
  on public.settings_tu_report_section_types (key);

insert into public.settings_tu_report_section_types (
  key,
  title,
  description,
  sort_order,
  is_active,
  is_system
)
values
  ('background_scope', 'Bakgrund', 'Bakgrund och anledning till utredningen.', 100, true, true),
  ('assignment_scope', 'Uppdragets omfattning', 'Vad uppdraget omfattar och avgränsar.', 200, true, true),
  ('construction_description', 'Beskrivning av konstruktionen', 'Beskrivning av berörd konstruktion.', 300, true, true),
  ('basis_conditions', 'Underlag och besiktningsförutsättningar', 'Underlag, handlingar och förutsättningar.', 400, true, true),
  ('observed_execution', 'Iakttagelser vid platsbesök', 'Observationer från platsbesöket.', 500, true, true),
  ('technical_assessment', 'Teknisk bedömning', 'Teknisk analys och bedömning.', 600, true, true),
  ('time_assessment', 'Tidsmässig bedömning', 'Tidsmässig bedömning av förhållanden eller skada.', 700, true, true),
  ('continued_risk', 'Bedömning av fortsatt risk', 'Bedömning av fortsatt risk eller skadeutveckling.', 800, true, true),
  ('recommended_actions', 'Rekommenderad fortsatt hantering', 'Rekommenderad fortsatt hantering eller åtgärdsinriktning.', 900, true, true),
  ('closing_comments', 'Avslutande kommentarer', 'Avslutande kommentarer och juridiskt skydd.', 1000, true, true)
on conflict (key) do update
set
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_system = true,
  updated_at = now();
