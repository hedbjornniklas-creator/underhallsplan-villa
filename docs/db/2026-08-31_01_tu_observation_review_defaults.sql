-- TU observation review defaults
-- Date: 2026-08-31
-- Scope:
-- 1) Keep raw field observations neutral until the holistic analysis is reviewed
-- 2) Preserve existing observation values and legacy report links
-- 3) Retain the first captured note and transcript when office review corrects the working copy
-- 4) Require a new source review when a linked measurement changes

alter table public.tu_observations
  alter column certainty set default 'uncertain',
  add column if not exists original_note_text text,
  add column if not exists original_transcript_text text;

comment on column public.tu_observations.certainty is
  'Legacy observation-level assessment hint. New field observations remain uncertain until assessment is performed in the holistic analysis workflow.';

comment on column public.tu_observations.original_note_text is
  'First non-empty field note, retained when the editable working copy is corrected during office review.';

comment on column public.tu_observations.original_transcript_text is
  'First non-empty voice transcript, retained when the editable working copy is corrected during office review.';

create or replace function public.tu_observations_preserve_original_source()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.original_note_text := coalesce(
      nullif(btrim(new.original_note_text), ''),
      nullif(btrim(new.note_text), '')
    );
    new.original_transcript_text := coalesce(
      nullif(btrim(new.original_transcript_text), ''),
      nullif(btrim(new.transcript_text), '')
    );
    return new;
  end if;

  new.original_note_text := coalesce(
    old.original_note_text,
    nullif(btrim(old.note_text), ''),
    nullif(btrim(new.note_text), '')
  );
  new.original_transcript_text := coalesce(
    old.original_transcript_text,
    nullif(btrim(old.transcript_text), ''),
    nullif(btrim(new.transcript_text), '')
  );
  return new;
end;
$$;

drop trigger if exists trg_tu_observations_preserve_original_source
  on public.tu_observations;
create trigger trg_tu_observations_preserve_original_source
before insert or update of note_text, transcript_text
on public.tu_observations
for each row
execute function public.tu_observations_preserve_original_source();

create or replace function public.tu_measurements_invalidate_observation_review()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.observation_id is not null then
      update public.tu_observations
      set review_status = 'draft'
      where id = new.observation_id
        and review_status = 'reviewed';
    end if;
    return new;
  end if;

  if old.observation_id is not null then
    update public.tu_observations
    set review_status = 'draft'
    where id = old.observation_id
      and review_status = 'reviewed';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.observation_id is not null
     and new.observation_id is distinct from old.observation_id
  then
    update public.tu_observations
    set review_status = 'draft'
    where id = new.observation_id
      and review_status = 'reviewed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tu_measurements_invalidate_observation_review
  on public.tu_measurements;
create trigger trg_tu_measurements_invalidate_observation_review
after insert or update of observation_id, location, measurement_type, value_text, unit, method, instrument, note or delete
on public.tu_measurements
for each row
execute function public.tu_measurements_invalidate_observation_review();
