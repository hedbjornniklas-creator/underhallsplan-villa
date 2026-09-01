-- TU quick instrument measurements
-- Date: 2026-09-01
-- Scope:
-- 1) Allow instrument measurements to be captured as dedicated field-log entries
-- 2) Keep existing typed, voice and mixed observations unchanged

alter table public.tu_observations
  drop constraint if exists tu_observations_source_type_check;

alter table public.tu_observations
  add constraint tu_observations_source_type_check
    check (source_type in ('typed', 'voice', 'mixed', 'measurement'));

comment on column public.tu_observations.source_type is
  'Capture source: typed note, voice note, mixed note or a dedicated instrument measurement.';
