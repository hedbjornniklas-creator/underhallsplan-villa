-- TU control stage clarification
-- Date: 2026-09-09
-- Scope:
-- 1) Store a description when the preparation uses another control stage
-- 2) Keep an existing control plan stale when its stage description changes

alter table public.tu_post_damage_cases
  add column if not exists remediation_stage_other text;

update public.tu_post_damage_cases
set remediation_stage_other = 'Annat skede (tidigare val)'
where remediation_stage = 'other'
  and btrim(coalesce(remediation_stage_other, '')) = '';

alter table public.tu_post_damage_cases
  drop constraint if exists tu_post_damage_cases_remediation_stage_other_check;

alter table public.tu_post_damage_cases
  add constraint tu_post_damage_cases_remediation_stage_other_check
    check (
      (remediation_stage = 'other'
        and btrim(coalesce(remediation_stage_other, '')) <> ''
        and char_length(remediation_stage_other) <= 200)
      or (remediation_stage is distinct from 'other' and remediation_stage_other is null)
    );

create or replace function public.prepare_tu_control_plan_case_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.damage_types is not distinct from old.damage_types
    and new.remediation_stage is not distinct from old.remediation_stage
    and new.remediation_stage_other is not distinct from old.remediation_stage_other
    and new.main_question is not distinct from old.main_question
  then
    return new;
  end if;

  if old.current_plan_run_id is not null then
    update public.tu_ai_runs
    set status = 'cancelled',
        error_message = 'Kontrollens förutsättningar ändrades.',
        progress_stage = 'cancelled',
        progress_message = 'Kontrollplanen blev inaktuell när förutsättningarna ändrades.',
        heartbeat_at = now(),
        completed_at = now()
    where id = old.current_plan_run_id and status in ('queued', 'processing');
    new.plan_stale_at := now();
  end if;
  new.status := 'draft';
  new.plan_approved_at := null;
  new.plan_approved_by := null;
  return new;
end;
$$;
