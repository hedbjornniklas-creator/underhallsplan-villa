-- TU chronological analysis and grounded report drafts
-- Date: 2026-09-01
-- Scope:
-- 1) Add current-assessment and evidence-conflict analysis item types
-- 2) Preserve earlier/later source links for conflict review
-- 3) Store report grounding status and non-observation source fields

alter table public.tu_ai_analysis_items
  drop constraint if exists tu_ai_analysis_items_type_check;

alter table public.tu_ai_analysis_items
  add constraint tu_ai_analysis_items_type_check check (
    item_type in (
      'current_assessment',
      'evidence_conflict',
      'verified_observation',
      'party_statement',
      'measurement',
      'image_observation',
      'technical_hypothesis',
      'information_gap',
      'recommended_follow_up',
      'report_image'
    )
  );

alter table public.tu_ai_analysis_items
  add column if not exists earlier_source_observation_ids jsonb not null default '[]'::jsonb,
  add column if not exists later_source_observation_ids jsonb not null default '[]'::jsonb;

alter table public.tu_ai_analysis_items
  drop constraint if exists tu_ai_analysis_items_earlier_sources_check,
  drop constraint if exists tu_ai_analysis_items_later_sources_check;

alter table public.tu_ai_analysis_items
  add constraint tu_ai_analysis_items_earlier_sources_check
    check (jsonb_typeof(earlier_source_observation_ids) = 'array'),
  add constraint tu_ai_analysis_items_later_sources_check
    check (jsonb_typeof(later_source_observation_ids) = 'array');

alter table public.tu_ai_suggestions
  add column if not exists source_field_keys jsonb not null default '[]'::jsonb,
  add column if not exists grounding_status text not null default 'grounded';

alter table public.tu_ai_suggestions
  drop constraint if exists tu_ai_suggestions_text_check,
  drop constraint if exists tu_ai_suggestions_source_field_keys_check,
  drop constraint if exists tu_ai_suggestions_grounding_status_check,
  drop constraint if exists tu_ai_suggestions_grounded_text_check;

alter table public.tu_ai_suggestions
  add constraint tu_ai_suggestions_source_field_keys_check
    check (jsonb_typeof(source_field_keys) = 'array'),
  add constraint tu_ai_suggestions_grounding_status_check
    check (grounding_status in ('grounded', 'needs_source', 'blocked', 'manually_edited')),
  add constraint tu_ai_suggestions_grounded_text_check
    check (grounding_status <> 'grounded' or btrim(proposed_text) <> '');

comment on column public.tu_ai_analysis_items.earlier_source_observation_ids is
  'Earlier chronological observations participating in an AI-identified evidence conflict.';
comment on column public.tu_ai_analysis_items.later_source_observation_ids is
  'Later chronological observations participating in an AI-identified evidence conflict.';
comment on column public.tu_ai_suggestions.source_field_keys is
  'Non-observation source fields cited by the generated report section.';
comment on column public.tu_ai_suggestions.grounding_status is
  'Whether the generated report section is grounded, missing sources, blocked by safety checks or manually edited.';
