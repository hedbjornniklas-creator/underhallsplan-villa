-- TU completed fieldwork and holistic AI analysis
-- Date: 2026-08-19
-- Scope:
-- 1) Track fieldwork completion separately from report locking
-- 2) Reuse auditable TU AI runs for whole-inspection analysis
-- 3) Store source-linked analysis items for inspector review

alter table public.tu_ai_runs
  drop constraint if exists tu_ai_runs_operation_check,
  drop constraint if exists tu_ai_runs_status_check;

alter table public.tu_ai_runs
  add column if not exists input_hash text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add constraint tu_ai_runs_operation_check
    check (operation in ('section_draft', 'inspection_analysis')),
  add constraint tu_ai_runs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  add constraint tu_ai_runs_attempt_count_check
    check (attempt_count >= 0);

create unique index if not exists tu_ai_runs_active_inspection_analysis_idx
  on public.tu_ai_runs (inspection_id)
  where operation = 'inspection_analysis'
    and status in ('queued', 'processing');

create table if not exists public.tu_analysis_workflows (
  inspection_id uuid primary key references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'in_progress',
  fieldwork_completed_at timestamptz,
  fieldwork_completed_by uuid references public.profiles (id) on delete set null,
  current_analysis_run_id uuid references public.tu_ai_runs (id) on delete set null,
  analysis_approved_at timestamptz,
  analysis_approved_by uuid references public.profiles (id) on delete set null,
  analysis_stale_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_analysis_workflows_status_check
    check (status in ('in_progress', 'analysis_processing', 'analysis_ready', 'analysis_approved'))
);

create index if not exists tu_analysis_workflows_org_idx
  on public.tu_analysis_workflows (org_id, updated_at desc);

create table if not exists public.tu_ai_analysis_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  run_id uuid not null references public.tu_ai_runs (id) on delete cascade,
  item_type text not null,
  title text not null,
  summary text not null,
  certainty text not null default 'uncertain',
  review_status text not null default 'pending',
  target_section_id text,
  include_in_report boolean not null default true,
  source_observation_ids jsonb not null default '[]'::jsonb,
  source_image_ids jsonb not null default '[]'::jsonb,
  source_measurement_ids jsonb not null default '[]'::jsonb,
  supporting_reasons jsonb not null default '[]'::jsonb,
  contradicting_reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_ai_analysis_items_type_check check (
    item_type in (
      'verified_observation',
      'party_statement',
      'measurement',
      'image_observation',
      'technical_hypothesis',
      'information_gap',
      'recommended_follow_up',
      'report_image'
    )
  ),
  constraint tu_ai_analysis_items_title_check check (btrim(title) <> ''),
  constraint tu_ai_analysis_items_summary_check check (btrim(summary) <> ''),
  constraint tu_ai_analysis_items_certainty_check
    check (certainty in ('confirmed', 'probable', 'uncertain')),
  constraint tu_ai_analysis_items_review_status_check
    check (review_status in ('pending', 'accepted', 'rejected')),
  constraint tu_ai_analysis_items_observation_sources_check
    check (jsonb_typeof(source_observation_ids) = 'array'),
  constraint tu_ai_analysis_items_image_sources_check
    check (jsonb_typeof(source_image_ids) = 'array'),
  constraint tu_ai_analysis_items_measurement_sources_check
    check (jsonb_typeof(source_measurement_ids) = 'array'),
  constraint tu_ai_analysis_items_supporting_reasons_check
    check (jsonb_typeof(supporting_reasons) = 'array'),
  constraint tu_ai_analysis_items_contradicting_reasons_check
    check (jsonb_typeof(contradicting_reasons) = 'array'),
  constraint tu_ai_analysis_items_warnings_check
    check (jsonb_typeof(warnings) = 'array')
);

create index if not exists tu_ai_analysis_items_run_idx
  on public.tu_ai_analysis_items (run_id, sort_order, created_at);
create index if not exists tu_ai_analysis_items_review_idx
  on public.tu_ai_analysis_items (inspection_id, review_status, include_in_report);

drop trigger if exists trg_tu_analysis_workflows_set_updated_at
  on public.tu_analysis_workflows;
create trigger trg_tu_analysis_workflows_set_updated_at
before update on public.tu_analysis_workflows
for each row execute function public.technical_investigations_set_updated_at();

drop trigger if exists trg_tu_ai_analysis_items_set_updated_at
  on public.tu_ai_analysis_items;
create trigger trg_tu_ai_analysis_items_set_updated_at
before update on public.tu_ai_analysis_items
for each row execute function public.technical_investigations_set_updated_at();

alter table public.tu_analysis_workflows enable row level security;
alter table public.tu_ai_analysis_items enable row level security;

grant select, insert, update, delete on table
  public.tu_analysis_workflows,
  public.tu_ai_analysis_items
to authenticated;

drop policy if exists tu_analysis_workflows_member_all on public.tu_analysis_workflows;
create policy tu_analysis_workflows_member_all on public.tu_analysis_workflows
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_ai_analysis_items_member_all on public.tu_ai_analysis_items;
create policy tu_ai_analysis_items_member_all on public.tu_ai_analysis_items
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create or replace function public.validate_tu_analysis_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_run_id uuid;
begin
  v_run_id := case
    when tg_table_name = 'tu_analysis_workflows' then new.current_analysis_run_id
    else new.run_id
  end;

  if v_run_id is not null and not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = v_run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation = 'inspection_analysis'
  ) then
    raise exception using errcode = '23514', message = 'TU_ANALYSIS_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_tu_analysis_workflow_scope
  on public.tu_analysis_workflows;
create trigger trg_validate_tu_analysis_workflow_scope
before insert or update on public.tu_analysis_workflows
for each row execute function public.validate_tu_analysis_scope();

drop trigger if exists trg_validate_tu_ai_analysis_items_scope
  on public.tu_ai_analysis_items;
create trigger trg_validate_tu_ai_analysis_items_scope
before insert or update on public.tu_ai_analysis_items
for each row execute function public.validate_tu_analysis_scope();

do $$
declare
  v_table text;
  v_tables text[] := array[
    'tu_analysis_workflows',
    'tu_ai_analysis_items'
  ];
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
    return;
  end if;

  foreach v_table in array v_tables loop
    execute format(
      'drop trigger if exists trg_guard_locked_inspection_write on public.%I',
      v_table
    );
    execute format(
      'create trigger trg_guard_locked_inspection_write
        before insert or update or delete on public.%I
        for each row
        execute function public.guard_locked_inspection_child_write()',
      v_table
    );
  end loop;
end
$$;

create or replace function public.mark_tu_analysis_stale_after_source_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_inspection_id uuid;
  v_run_id uuid;
begin
  v_org_id := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;

  if tg_table_name = 'technical_investigation_images' and tg_op = 'UPDATE' then
    if new.file_path is not distinct from old.file_path
      and new.storage_bucket is not distinct from old.storage_bucket
      and new.caption is not distinct from old.caption
    then
      return new;
    end if;
  end if;

  if tg_table_name = 'technical_investigation_details' and tg_op = 'UPDATE' then
    if new.title is not distinct from old.title
      and new.project_type is not distinct from old.project_type
      and new.scope_description is not distinct from old.scope_description
      and new.background is not distinct from old.background
      and new.basis is not distinct from old.basis
      and new.accessibility is not distinct from old.accessibility
      and new.property_object_type is not distinct from old.property_object_type
      and new.brf_name is not distinct from old.brf_name
      and new.apartment_number is not distinct from old.apartment_number
      and new.apartment_holder_name is not distinct from old.apartment_holder_name
    then
      return new;
    end if;
  end if;

  select current_analysis_run_id
  into v_run_id
  from public.tu_analysis_workflows
  where org_id = v_org_id
    and inspection_id = v_inspection_id
    and status <> 'in_progress';

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_run_id is not null then
    update public.tu_ai_runs
    set
      status = 'cancelled',
      error_message = 'Källunderlaget ändrades efter att analysen startades.',
      completed_at = now()
    where id = v_run_id
      and status in ('queued', 'processing');
  end if;

  update public.tu_analysis_workflows
  set
    status = 'in_progress',
    analysis_approved_at = null,
    analysis_approved_by = null,
    analysis_stale_at = now()
  where org_id = v_org_id
    and inspection_id = v_inspection_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'tu_observations',
    'tu_observation_images',
    'tu_measurements',
    'technical_investigation_images',
    'technical_investigation_details'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'drop trigger if exists trg_mark_tu_analysis_stale on public.%I',
      v_table
    );
    execute format(
      'create trigger trg_mark_tu_analysis_stale
        after insert or update or delete on public.%I
        for each row
        execute function public.mark_tu_analysis_stale_after_source_write()',
      v_table
    );
  end loop;
end
$$;
