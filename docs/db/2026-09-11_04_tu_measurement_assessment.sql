-- TU inspector assessment for instrument measurements
-- Date: 2026-09-11
-- Scope:
-- 1) Store the inspector's explicit assessment separately from the instrument reading
-- 2) Keep existing measurements neutral until they are assessed
-- 3) Reopen source review when an assessment changes

alter table public.tu_measurements
  add column if not exists assessment text;

comment on column public.tu_measurements.assessment is
  'Inspector-confirmed interpretation of the recorded measurement: no_deviation, deviation or not_assessable. Null means not yet assessed.';

alter table public.tu_measurements
  drop constraint if exists tu_measurements_assessment_check;

alter table public.tu_measurements
  add constraint tu_measurements_assessment_check
    check (assessment is null or assessment in ('no_deviation', 'deviation', 'not_assessable'));

-- Existing values cannot be interpreted safely from the number alone. Reopen only
-- unlocked source posts so the inspector can make an explicit assessment.
update public.tu_observations observations
set
  review_status = 'draft',
  updated_at = now()
where observations.review_status = 'reviewed'
  and exists (
    select 1
    from public.tu_measurements measurements
    where measurements.observation_id = observations.id
      and measurements.assessment is null
  )
  and exists (
    select 1
    from public.technical_investigation_details details
    join public.inspections inspections
      on inspections.id = details.inspection_id
    where details.inspection_id = observations.inspection_id
      and details.report_locked_at is null
      and inspections.locked_at is null
  );

drop trigger if exists trg_tu_measurements_invalidate_observation_review
  on public.tu_measurements;
create trigger trg_tu_measurements_invalidate_observation_review
after insert or update of observation_id, location, measurement_type, value_text, unit, method, instrument, assessment, note or delete
on public.tu_measurements
for each row
execute function public.tu_measurements_invalidate_observation_review();
