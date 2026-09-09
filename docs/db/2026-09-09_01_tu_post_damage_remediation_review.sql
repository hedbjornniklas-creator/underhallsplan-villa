-- TU technical review after damage remediation
-- Date: 2026-09-09
-- Scope:
-- 1) Add an immutable workflow profile to TU report templates and investigations
-- 2) Add source-document metadata and an auditable AI-generated control plan
-- 3) Seed a general AI-assisted template for reviews after damage remediation
-- 4) Keep control plans and later report analysis stale when their sources change

begin;

create extension if not exists pgcrypto;

alter table public.settings_tu_report_templates
  add column if not exists workflow_profile text not null default 'field_report';

alter table public.settings_tu_report_templates
  drop constraint if exists settings_tu_report_templates_workflow_profile_check;

alter table public.settings_tu_report_templates
  add constraint settings_tu_report_templates_workflow_profile_check
    check (workflow_profile in ('field_report', 'post_damage_review'));

alter table public.technical_investigation_details
  add column if not exists report_workflow_profile text not null default 'field_report';

alter table public.technical_investigation_details
  drop constraint if exists technical_investigation_details_report_workflow_profile_check;

alter table public.technical_investigation_details
  add constraint technical_investigation_details_report_workflow_profile_check
    check (report_workflow_profile in ('field_report', 'post_damage_review'));

comment on column public.settings_tu_report_templates.workflow_profile is
  'TU workflow selected for new investigations. post_damage_review adds source review and a control plan.';
comment on column public.technical_investigation_details.report_workflow_profile is
  'Immutable TU workflow copied from the selected template when the investigation is created.';

alter table public.technical_investigation_documents
  add column if not exists use_in_analysis boolean not null default false,
  add column if not exists analysis_source_role text not null default 'other',
  add column if not exists source_party text,
  add column if not exists document_date date;

alter table public.technical_investigation_documents
  drop constraint if exists technical_investigation_documents_analysis_source_role_check;

alter table public.technical_investigation_documents
  add constraint technical_investigation_documents_analysis_source_role_check
    check (
      analysis_source_role in (
        'prior_report',
        'agreed_scope',
        'completion_record',
        'measurement_record',
        'other'
      )
    );

create index if not exists technical_investigation_documents_analysis_idx
  on public.technical_investigation_documents (inspection_id, use_in_analysis, document_date, created_at);

comment on column public.technical_investigation_documents.use_in_analysis is
  'Whether the document may be used as untrusted source material by TU AI analysis.';
comment on column public.technical_investigation_documents.analysis_source_role is
  'The evidentiary role of the document, kept separate from delivery inclusion.';

alter table public.tu_ai_runs
  drop constraint if exists tu_ai_runs_operation_check;

alter table public.tu_ai_runs
  add constraint tu_ai_runs_operation_check
    check (operation in ('section_draft', 'inspection_analysis', 'report_draft', 'report_review', 'control_plan'));

create unique index if not exists tu_ai_runs_active_control_plan_idx
  on public.tu_ai_runs (inspection_id)
  where operation = 'control_plan'
    and status in ('queued', 'processing');

create table if not exists public.tu_post_damage_cases (
  inspection_id uuid primary key references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  damage_types text[] not null default '{}'::text[],
  remediation_stage text,
  main_question text,
  status text not null default 'draft',
  current_plan_run_id uuid references public.tu_ai_runs (id) on delete set null,
  overview text,
  source_summary text,
  conflicts jsonb not null default '[]'::jsonb,
  essential_questions jsonb not null default '[]'::jsonb,
  plan_stale_at timestamptz,
  plan_approved_at timestamptz,
  plan_approved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_post_damage_cases_damage_types_check
    check (
      damage_types <@ array[
        'fire_smoke',
        'moisture_water',
        'microbial',
        'ventilation',
        'structure',
        'installation',
        'other'
      ]::text[]
    ),
  constraint tu_post_damage_cases_remediation_stage_check
    check (
      remediation_stage is null
      or remediation_stage in (
        'after_demolition',
        'after_remediation',
        'before_restoration',
        'after_completion',
        'other'
      )
    ),
  constraint tu_post_damage_cases_status_check
    check (status in ('draft', 'plan_processing', 'plan_ready', 'plan_approved')),
  constraint tu_post_damage_cases_conflicts_check
    check (jsonb_typeof(conflicts) = 'array'),
  constraint tu_post_damage_cases_questions_check
    check (jsonb_typeof(essential_questions) = 'array')
);

create index if not exists tu_post_damage_cases_org_idx
  on public.tu_post_damage_cases (org_id, updated_at desc);

create table if not exists public.tu_verification_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  run_id uuid not null references public.tu_ai_runs (id) on delete cascade,
  item_type text not null,
  category text not null,
  title text not null,
  description text not null,
  verification_method text,
  source_references jsonb not null default '[]'::jsonb,
  priority text not null default 'normal',
  review_status text not null default 'pending',
  verification_status text not null default 'not_checked',
  needs_follow_up boolean not null default false,
  inspector_note text,
  sort_order integer not null default 100,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_verification_items_type_check
    check (
      item_type in (
        'prior_observation',
        'recommendation',
        'agreed_measure',
        'completion_claim',
        'measurement_requirement',
        'other'
      )
    ),
  constraint tu_verification_items_category_check check (btrim(category) <> ''),
  constraint tu_verification_items_title_check check (btrim(title) <> ''),
  constraint tu_verification_items_description_check check (btrim(description) <> ''),
  constraint tu_verification_items_sources_check check (jsonb_typeof(source_references) = 'array'),
  constraint tu_verification_items_priority_check check (priority in ('high', 'normal', 'low')),
  constraint tu_verification_items_review_status_check
    check (review_status in ('pending', 'accepted', 'rejected')),
  constraint tu_verification_items_verification_status_check
    check (
      verification_status in (
        'not_checked',
        'verified',
        'consistent',
        'reported_not_verifiable',
        'partially_verified',
        'remaining_condition',
        'inaccessible',
        'not_applicable'
      )
    )
);

create index if not exists tu_verification_items_run_idx
  on public.tu_verification_items (run_id, sort_order, created_at);
create index if not exists tu_verification_items_inspection_idx
  on public.tu_verification_items (inspection_id, review_status, verification_status, sort_order);

create table if not exists public.tu_verification_item_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  verification_item_id uuid not null references public.tu_verification_items (id) on delete cascade,
  observation_id uuid not null references public.tu_observations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tu_verification_item_observations_unique
    unique (verification_item_id, observation_id)
);

create index if not exists tu_verification_item_observations_inspection_idx
  on public.tu_verification_item_observations (inspection_id, verification_item_id);
create index if not exists tu_verification_item_observations_observation_idx
  on public.tu_verification_item_observations (observation_id);

drop trigger if exists trg_tu_post_damage_cases_set_updated_at on public.tu_post_damage_cases;
create trigger trg_tu_post_damage_cases_set_updated_at
before update on public.tu_post_damage_cases
for each row execute function public.technical_investigations_set_updated_at();

drop trigger if exists trg_tu_verification_items_set_updated_at on public.tu_verification_items;
create trigger trg_tu_verification_items_set_updated_at
before update on public.tu_verification_items
for each row execute function public.technical_investigations_set_updated_at();

alter table public.tu_post_damage_cases enable row level security;
alter table public.tu_verification_items enable row level security;
alter table public.tu_verification_item_observations enable row level security;

grant select, insert, update, delete on table
  public.tu_post_damage_cases,
  public.tu_verification_items,
  public.tu_verification_item_observations
to authenticated;

drop policy if exists tu_post_damage_cases_member_all on public.tu_post_damage_cases;
create policy tu_post_damage_cases_member_all on public.tu_post_damage_cases
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_verification_items_member_all on public.tu_verification_items;
create policy tu_verification_items_member_all on public.tu_verification_items
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_verification_item_observations_member_all on public.tu_verification_item_observations;
create policy tu_verification_item_observations_member_all on public.tu_verification_item_observations
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create or replace function public.validate_tu_post_damage_case_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.technical_investigation_details details
    where details.inspection_id = new.inspection_id
      and details.org_id = new.org_id
  ) then
    raise exception using errcode = '23514', message = 'TU_CONTROL_PLAN_INSPECTION_SCOPE_INVALID';
  end if;

  if new.current_plan_run_id is not null and not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = new.current_plan_run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation = 'control_plan'
  ) then
    raise exception using errcode = '23514', message = 'TU_CONTROL_PLAN_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

create or replace function public.validate_tu_verification_item_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.technical_investigation_details details
    where details.inspection_id = new.inspection_id
      and details.org_id = new.org_id
  ) or not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = new.run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation = 'control_plan'
  ) then
    raise exception using errcode = '23514', message = 'TU_CONTROL_PLAN_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

create or replace function public.validate_tu_verification_observation_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.technical_investigation_details details
    where details.inspection_id = new.inspection_id
      and details.org_id = new.org_id
  ) or not exists (
    select 1
    from public.tu_verification_items item
    where item.id = new.verification_item_id
      and item.org_id = new.org_id
      and item.inspection_id = new.inspection_id
  ) or not exists (
    select 1
    from public.tu_observations observation
    where observation.id = new.observation_id
      and observation.org_id = new.org_id
      and observation.inspection_id = new.inspection_id
  ) then
    raise exception using errcode = '23514', message = 'TU_CONTROL_PLAN_OBSERVATION_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_tu_post_damage_case_scope on public.tu_post_damage_cases;
create trigger trg_validate_tu_post_damage_case_scope
before insert or update on public.tu_post_damage_cases
for each row execute function public.validate_tu_post_damage_case_scope();

drop trigger if exists trg_validate_tu_verification_item_scope on public.tu_verification_items;
create trigger trg_validate_tu_verification_item_scope
before insert or update on public.tu_verification_items
for each row execute function public.validate_tu_verification_item_scope();

drop trigger if exists trg_validate_tu_verification_observation_scope on public.tu_verification_item_observations;
create trigger trg_validate_tu_verification_observation_scope
before insert or update on public.tu_verification_item_observations
for each row execute function public.validate_tu_verification_observation_scope();

create or replace function public.mark_tu_control_plan_stale_after_document_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_inspection_id uuid;
  v_affects_analysis boolean;
  v_plan_run_id uuid;
  v_analysis_run_id uuid;
begin
  v_org_id := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  v_affects_analysis := case
    when tg_op = 'INSERT' then new.use_in_analysis
    when tg_op = 'DELETE' then old.use_in_analysis
    else old.use_in_analysis or new.use_in_analysis
  end;

  if not v_affects_analysis then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.use_in_analysis is not distinct from old.use_in_analysis
    and new.analysis_source_role is not distinct from old.analysis_source_role
    and new.source_party is not distinct from old.source_party
    and new.document_date is not distinct from old.document_date
    and new.file_path is not distinct from old.file_path
    and new.title is not distinct from old.title
  then
    return new;
  end if;

  select current_plan_run_id into v_plan_run_id
  from public.tu_post_damage_cases
  where org_id = v_org_id and inspection_id = v_inspection_id;

  if v_plan_run_id is not null then
    update public.tu_ai_runs
    set status = 'cancelled',
        error_message = 'Källdokumenten ändrades efter att kontrollplanen startades.',
        progress_stage = 'cancelled',
        progress_message = 'Kontrollplanen blev inaktuell när underlaget ändrades.',
        heartbeat_at = now(),
        completed_at = now()
    where id = v_plan_run_id and status in ('queued', 'processing');
  end if;

  update public.tu_post_damage_cases
  set status = 'draft',
      plan_stale_at = case when current_plan_run_id is null then plan_stale_at else now() end,
      plan_approved_at = null,
      plan_approved_by = null
  where org_id = v_org_id and inspection_id = v_inspection_id;

  select current_analysis_run_id into v_analysis_run_id
  from public.tu_analysis_workflows
  where org_id = v_org_id
    and inspection_id = v_inspection_id
    and status <> 'in_progress';

  if found then
    if v_analysis_run_id is not null then
      update public.tu_ai_runs
      set status = 'cancelled',
          error_message = 'Källunderlaget ändrades efter att analysen startades.',
          progress_stage = 'cancelled',
          progress_message = 'Analysen avbröts eftersom underlaget ändrades.',
          heartbeat_at = now(),
          completed_at = now()
      where id = v_analysis_run_id and status in ('queued', 'processing');
    end if;

    update public.tu_analysis_workflows
    set status = 'in_progress',
        analysis_approved_at = null,
        analysis_approved_by = null,
        analysis_stale_at = now()
    where org_id = v_org_id and inspection_id = v_inspection_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_tu_control_plan_stale on public.technical_investigation_documents;
create trigger trg_mark_tu_control_plan_stale
after insert or update or delete on public.technical_investigation_documents
for each row execute function public.mark_tu_control_plan_stale_after_document_write();

create or replace function public.prepare_tu_control_plan_case_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.damage_types is not distinct from old.damage_types
    and new.remediation_stage is not distinct from old.remediation_stage
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

drop trigger if exists trg_prepare_tu_control_plan_case_update on public.tu_post_damage_cases;
create trigger trg_prepare_tu_control_plan_case_update
before update on public.tu_post_damage_cases
for each row execute function public.prepare_tu_control_plan_case_update();

create or replace function public.mark_tu_control_plan_unapproved_after_item_write()
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
  if tg_op = 'UPDATE'
    and new.item_type is not distinct from old.item_type
    and new.category is not distinct from old.category
    and new.title is not distinct from old.title
    and new.description is not distinct from old.description
    and new.verification_method is not distinct from old.verification_method
    and new.source_references is not distinct from old.source_references
    and new.priority is not distinct from old.priority
    and new.review_status is not distinct from old.review_status
    and new.sort_order is not distinct from old.sort_order
  then
    return new;
  end if;

  v_org_id := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  v_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;

  update public.tu_post_damage_cases
  set status = 'plan_ready',
      plan_approved_at = null,
      plan_approved_by = null
  where org_id = v_org_id
    and inspection_id = v_inspection_id
    and current_plan_run_id = v_run_id
    and status = 'plan_approved';

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_tu_control_plan_unapproved on public.tu_verification_items;
create trigger trg_mark_tu_control_plan_unapproved
after insert or update or delete on public.tu_verification_items
for each row execute function public.mark_tu_control_plan_unapproved_after_item_write();

do $$
declare
  v_table text;
  v_tables text[] := array[
    'tu_verification_items',
    'tu_verification_item_observations'
  ];
begin
  if to_regprocedure('public.mark_tu_analysis_stale_after_source_write()') is null then
    raise notice 'mark_tu_analysis_stale_after_source_write() is missing; apply TU analysis migration first.';
    return;
  end if;

  foreach v_table in array v_tables loop
    execute format('drop trigger if exists trg_mark_tu_analysis_stale on public.%I', v_table);
    execute format(
      'create trigger trg_mark_tu_analysis_stale
       after insert or update or delete on public.%I
       for each row execute function public.mark_tu_analysis_stale_after_source_write()',
      v_table
    );
  end loop;
end
$$;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'technical_investigation_documents',
    'tu_post_damage_cases',
    'tu_verification_items',
    'tu_verification_item_observations'
  ];
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
    return;
  end if;

  foreach v_table in array v_tables loop
    execute format('drop trigger if exists trg_guard_locked_inspection_write on public.%I', v_table);
    execute format(
      'create trigger trg_guard_locked_inspection_write
       before insert or update or delete on public.%I
       for each row execute function public.guard_locked_inspection_child_write()',
      v_table
    );
  end loop;
end
$$;

insert into public.settings_tu_report_templates (
  key,
  title,
  description,
  document_title,
  project_type,
  authoring_mode,
  workflow_profile,
  version,
  sort_order,
  is_active,
  is_system
)
values (
  'post_damage_remediation_review',
  'Teknisk kontroll efter skadeåtgärd',
  'AI-stödd kontroll efter rivning, sanering, uttorkning eller annan skadeåtgärd. Tidigare underlag omvandlas till en granskningsbar kontrollplan före platsbesöket.',
  'Teknisk kontroll efter skadeåtgärd',
  'Teknisk kontroll efter skadeåtgärd',
  'ai_assisted',
  'post_damage_review',
  1,
  175,
  true,
  true
)
on conflict (key) do update
set title = excluded.title,
    description = excluded.description,
    document_title = excluded.document_title,
    project_type = excluded.project_type,
    authoring_mode = excluded.authoring_mode,
    workflow_profile = excluded.workflow_profile,
    version = excluded.version,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    is_system = true,
    updated_at = now();

with seed_rows (
  template_section_key,
  section_type_key,
  title_override,
  ai_instruction,
  sort_order
) as (
  values
    (
      'scope_basis_boundaries',
      'assignment_scope',
      'Uppdrag, underlag och avgränsning',
      'Beskriv kontrollens fråga, vilket tidigare underlag som varit relevant, kontrollens skede och de avgränsningar som faktiskt påverkar slutsatsen. Skilj tydligt på tidigare uppgifter, rekommendationer, påstått utförda åtgärder och besiktningsmannens egen kontroll.',
      100
    ),
    (
      'review_execution_observations',
      'observed_execution',
      'Genomförande och iakttagelser',
      'Redovisa hur kontrollen genomfördes och de egna iakttagelser, mätningar och åtkomstbegränsningar som behövs för att besvara kontrollfrågan. Använd kontrollplanen som disposition men skriv inte interna kontrollstatusar eller dokumentreferenser som rapportadministration.',
      200
    ),
    (
      'review_assessment_conclusion',
      'technical_assessment',
      'Teknisk bedömning',
      'Väg samman tidigare underlag med den egna kontrollen och besvara huvudfrågan. Skilj mellan verifierat, synligt förenligt med uppgivet utförande, uppgivet men inte verifierbart, delvis verifierat och kvarstående förhållande. Använd inte godkänd eller underkänd om uppdraget inte uttryckligen kräver en sådan formell prövning.',
      300
    ),
    (
      'review_recommended_follow_up',
      'recommended_actions',
      'Rekommenderad fortsatt hantering',
      'Ange endast proportionerliga fortsatta kontroller, kompletteringar eller åtgärder som följer av den samlade bedömningen. Skilj återstående kontrollbehov från konstaterade brister och undvik juridiska slutsatser eller ansvarsfördelning.',
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
select template.id,
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
  on template.key = 'post_damage_remediation_review'
on conflict (template_id, template_section_key) do update
set section_type_key = excluded.section_type_key,
    title_override = excluded.title_override,
    default_content = excluded.default_content,
    ai_instruction = excluded.ai_instruction,
    sort_order = excluded.sort_order,
    is_required = excluded.is_required,
    include_in_toc = excluded.include_in_toc,
    allow_delete = excluded.allow_delete,
    updated_at = now();

commit;
