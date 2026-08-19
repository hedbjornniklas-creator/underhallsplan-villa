-- TU evidence scope trigger fix
-- Date: 2026-08-19
-- Scope:
-- 1) Validate observation images, measurements and AI suggestions with table-specific triggers
-- 2) Avoid accessing fields that do not exist on the trigger row type

drop trigger if exists trg_validate_tu_observation_images_scope
  on public.tu_observation_images;
drop trigger if exists trg_validate_tu_measurements_scope
  on public.tu_measurements;
drop trigger if exists trg_validate_tu_ai_suggestions_scope
  on public.tu_ai_suggestions;

drop function if exists public.validate_tu_evidence_link_scope();

create or replace function public.validate_tu_observation_image_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tu_observations observation
    where observation.id = new.observation_id
      and observation.org_id = new.org_id
      and observation.inspection_id = new.inspection_id
  ) or not exists (
    select 1
    from public.technical_investigation_images image
    where image.id = new.image_id
      and image.org_id = new.org_id
      and image.inspection_id = new.inspection_id
  ) then
    raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.validate_tu_measurement_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.observation_id is not null and not exists (
    select 1
    from public.tu_observations observation
    where observation.id = new.observation_id
      and observation.org_id = new.org_id
      and observation.inspection_id = new.inspection_id
  ) then
    raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.validate_tu_ai_suggestion_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = new.run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation = 'section_draft'
  ) then
    raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create trigger trg_validate_tu_observation_images_scope
before insert or update on public.tu_observation_images
for each row execute function public.validate_tu_observation_image_scope();

create trigger trg_validate_tu_measurements_scope
before insert or update on public.tu_measurements
for each row execute function public.validate_tu_measurement_scope();

create trigger trg_validate_tu_ai_suggestions_scope
before insert or update on public.tu_ai_suggestions
for each row execute function public.validate_tu_ai_suggestion_scope();
