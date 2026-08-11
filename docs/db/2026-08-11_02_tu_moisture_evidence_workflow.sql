-- TU moisture investigation evidence workflow
-- Date: 2026-08-11
-- Scope:
-- 1) Add the first field-work template for moisture damage investigations
-- 2) Store reviewed observations, image links and measurements separately from report prose
-- 3) Persist auditable AI runs and suggestions without writing directly to report_draft
-- 4) Protect all mutable evidence with the shared inspection lock guard

create extension if not exists pgcrypto;

insert into public.settings_tu_report_templates (
  key,
  title,
  description,
  document_title,
  project_type,
  version,
  sort_order,
  is_active,
  is_system
)
values (
  'moisture_damage_investigation',
  'Fuktskadeutredning',
  'Fuktskadeutredning med strukturerat besiktningsunderlag och granskade AI-förslag.',
  'Fuktskadeutredning',
  'Fuktskadeutredning',
  1,
  150,
  true,
  true
)
on conflict (key) do update
set
  title = excluded.title,
  description = excluded.description,
  document_title = excluded.document_title,
  project_type = excluded.project_type,
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
      'scope_questions_boundaries',
      'assignment_scope',
      'Uppdrag, frågeställningar och avgränsningar',
      'Redovisa uppdraget, de tekniska frågeställningarna och tydliga avgränsningar. Skilj beställaruppgifter från verifierade fakta.',
      100
    ),
    (
      'basis_object_method',
      'basis_conditions',
      'Underlag, objekt och undersökningsmetod',
      'Beskriv tillgängligt underlag, berörda byggnadsdelar, åtkomlighet, mätmetoder och andra undersökningsförutsättningar.',
      200
    ),
    (
      'observations_measurements',
      'observed_execution',
      'Iakttagelser och mätresultat',
      'Redovisa endast kontrollerade observationer och mätresultat. Ange plats, metod, enhet och osäkerhet när det är relevant.',
      300
    ),
    (
      'technical_assessment',
      'technical_assessment',
      'Teknisk bedömning',
      'Analysera sannolika skadeorsaker och samband. Markera tydligt vad som är verifierat, sannolikt respektive inte möjligt att fastställa.',
      400
    ),
    (
      'recommended_follow_up',
      'recommended_actions',
      'Rekommenderad fortsatt hantering',
      'Beskriv proportionerliga fortsatta kontroller och tekniska åtgärder utan att dra juridiska slutsatser eller utse ansvarig part.',
      500
    ),
    (
      'summary_conclusion',
      'closing_comments',
      'Sammanfattande slutsats',
      'Sammanfatta de viktigaste slutsatserna, kvarstående osäkerheter och uppdragets begränsningar utan att tillföra nya fakta.',
      600
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

create table if not exists public.tu_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  source_type text not null default 'typed',
  location text,
  building_component text,
  note_text text not null default '',
  transcript_text text,
  risk_note text,
  suggested_follow_up text,
  certainty text not null default 'confirmed',
  review_status text not null default 'draft',
  target_section_id text,
  include_in_report boolean not null default true,
  audio_storage_bucket text,
  audio_storage_path text,
  audio_content_type text,
  audio_duration_seconds integer,
  observed_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_observations_source_type_check
    check (source_type in ('typed', 'voice', 'mixed')),
  constraint tu_observations_certainty_check
    check (certainty in ('confirmed', 'probable', 'uncertain')),
  constraint tu_observations_review_status_check
    check (review_status in ('draft', 'reviewed')),
  constraint tu_observations_audio_duration_check
    check (audio_duration_seconds is null or audio_duration_seconds >= 0),
  constraint tu_observations_audio_pair_check
    check (
      (audio_storage_bucket is null and audio_storage_path is null)
      or (btrim(audio_storage_bucket) <> '' and btrim(audio_storage_path) <> '')
    )
);

create index if not exists tu_observations_inspection_idx
  on public.tu_observations (inspection_id, observed_at, created_at);
create index if not exists tu_observations_org_idx
  on public.tu_observations (org_id, updated_at desc);
create index if not exists tu_observations_report_idx
  on public.tu_observations (inspection_id, review_status, include_in_report, target_section_id);

create table if not exists public.tu_observation_images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  observation_id uuid not null references public.tu_observations (id) on delete cascade,
  image_id uuid not null references public.technical_investigation_images (id) on delete cascade,
  sort_order integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tu_observation_images_unique unique (observation_id, image_id)
);

create index if not exists tu_observation_images_inspection_idx
  on public.tu_observation_images (inspection_id, observation_id, sort_order);
create index if not exists tu_observation_images_image_idx
  on public.tu_observation_images (image_id);

create table if not exists public.tu_measurements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  observation_id uuid references public.tu_observations (id) on delete cascade,
  location text,
  measurement_type text not null,
  value_text text not null,
  unit text,
  method text,
  instrument text,
  note text,
  measured_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_measurements_type_check check (btrim(measurement_type) <> ''),
  constraint tu_measurements_value_check check (btrim(value_text) <> '')
);

create index if not exists tu_measurements_inspection_idx
  on public.tu_measurements (inspection_id, measured_at, created_at);
create index if not exists tu_measurements_observation_idx
  on public.tu_measurements (observation_id)
  where observation_id is not null;

create table if not exists public.tu_ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  operation text not null default 'section_draft',
  status text not null default 'processing',
  model text not null,
  ruleset_key text not null default 'tu_moisture_v1',
  ruleset_version integer not null default 1,
  target_section_id text,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  error_message text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tu_ai_runs_operation_check check (operation in ('section_draft')),
  constraint tu_ai_runs_status_check check (status in ('processing', 'completed', 'failed')),
  constraint tu_ai_runs_ruleset_version_check check (ruleset_version > 0)
);

create index if not exists tu_ai_runs_inspection_idx
  on public.tu_ai_runs (inspection_id, created_at desc);

create table if not exists public.tu_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  run_id uuid not null references public.tu_ai_runs (id) on delete cascade,
  target_section_id text not null,
  target_section_key text not null,
  target_section_title text not null,
  proposed_text text not null,
  status text not null default 'pending',
  source_observation_ids jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  application_mode text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_ai_suggestions_target_section_id_check check (btrim(target_section_id) <> ''),
  constraint tu_ai_suggestions_target_section_key_check check (btrim(target_section_key) <> ''),
  constraint tu_ai_suggestions_target_section_title_check check (btrim(target_section_title) <> ''),
  constraint tu_ai_suggestions_text_check check (btrim(proposed_text) <> ''),
  constraint tu_ai_suggestions_status_check check (status in ('pending', 'accepted', 'rejected')),
  constraint tu_ai_suggestions_sources_array_check check (jsonb_typeof(source_observation_ids) = 'array'),
  constraint tu_ai_suggestions_warnings_array_check check (jsonb_typeof(warnings) = 'array')
);

alter table public.tu_ai_suggestions
  add column if not exists application_mode text;

alter table public.tu_ai_suggestions
  drop constraint if exists tu_ai_suggestions_application_mode_check,
  add constraint tu_ai_suggestions_application_mode_check
    check (application_mode is null or application_mode in ('append', 'replace'));

create index if not exists tu_ai_suggestions_inspection_idx
  on public.tu_ai_suggestions (inspection_id, created_at desc);
create index if not exists tu_ai_suggestions_pending_idx
  on public.tu_ai_suggestions (inspection_id, target_section_id, created_at desc)
  where status = 'pending';

drop trigger if exists trg_tu_observations_set_updated_at on public.tu_observations;
create trigger trg_tu_observations_set_updated_at
before update on public.tu_observations
for each row execute function public.technical_investigations_set_updated_at();

drop trigger if exists trg_tu_measurements_set_updated_at on public.tu_measurements;
create trigger trg_tu_measurements_set_updated_at
before update on public.tu_measurements
for each row execute function public.technical_investigations_set_updated_at();

drop trigger if exists trg_tu_ai_suggestions_set_updated_at on public.tu_ai_suggestions;
create trigger trg_tu_ai_suggestions_set_updated_at
before update on public.tu_ai_suggestions
for each row execute function public.technical_investigations_set_updated_at();

alter table public.tu_observations enable row level security;
alter table public.tu_observation_images enable row level security;
alter table public.tu_measurements enable row level security;
alter table public.tu_ai_runs enable row level security;
alter table public.tu_ai_suggestions enable row level security;

grant select, insert, update, delete on table
  public.tu_observations,
  public.tu_observation_images,
  public.tu_measurements,
  public.tu_ai_runs,
  public.tu_ai_suggestions
to authenticated;

drop policy if exists tu_observations_member_all on public.tu_observations;
create policy tu_observations_member_all on public.tu_observations
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_observation_images_member_all on public.tu_observation_images;
create policy tu_observation_images_member_all on public.tu_observation_images
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_measurements_member_all on public.tu_measurements;
create policy tu_measurements_member_all on public.tu_measurements
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_ai_runs_member_all on public.tu_ai_runs;
create policy tu_ai_runs_member_all on public.tu_ai_runs
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists tu_ai_suggestions_member_all on public.tu_ai_suggestions;
create policy tu_ai_suggestions_member_all on public.tu_ai_suggestions
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create or replace function public.validate_tu_evidence_link_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'tu_observation_images' then
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
  elsif tg_table_name = 'tu_measurements' and new.observation_id is not null then
    if not exists (
      select 1
      from public.tu_observations observation
      where observation.id = new.observation_id
        and observation.org_id = new.org_id
        and observation.inspection_id = new.inspection_id
    ) then
      raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'tu_ai_suggestions' then
    if not exists (
      select 1
      from public.tu_ai_runs run
      where run.id = new.run_id
        and run.org_id = new.org_id
        and run.inspection_id = new.inspection_id
    ) then
      raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_tu_observation_images_scope on public.tu_observation_images;
create trigger trg_validate_tu_observation_images_scope
before insert or update on public.tu_observation_images
for each row execute function public.validate_tu_evidence_link_scope();

drop trigger if exists trg_validate_tu_measurements_scope on public.tu_measurements;
create trigger trg_validate_tu_measurements_scope
before insert or update on public.tu_measurements
for each row execute function public.validate_tu_evidence_link_scope();

drop trigger if exists trg_validate_tu_ai_suggestions_scope on public.tu_ai_suggestions;
create trigger trg_validate_tu_ai_suggestions_scope
before insert or update on public.tu_ai_suggestions
for each row execute function public.validate_tu_evidence_link_scope();

create or replace function public.replace_tu_observation_images(
  p_org_id uuid,
  p_inspection_id uuid,
  p_observation_id uuid,
  p_image_ids uuid[] default array[]::uuid[],
  p_created_by uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform 1
  from public.tu_observations observation
  where observation.id = p_observation_id
    and observation.org_id = p_org_id
    and observation.inspection_id = p_inspection_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TU_OBSERVATION_NOT_FOUND';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_image_ids, array[]::uuid[])) as requested(image_id)
    left join public.technical_investigation_images image
      on image.id = requested.image_id
     and image.org_id = p_org_id
     and image.inspection_id = p_inspection_id
    where image.id is null
  ) then
    raise exception using errcode = '22023', message = 'TU_OBSERVATION_IMAGE_INVALID';
  end if;

  delete from public.tu_observation_images
  where org_id = p_org_id
    and inspection_id = p_inspection_id
    and observation_id = p_observation_id;

  insert into public.tu_observation_images (
    org_id,
    inspection_id,
    observation_id,
    image_id,
    sort_order,
    created_by
  )
  select
    p_org_id,
    p_inspection_id,
    p_observation_id,
    ordered.image_id,
    ordered.ordinality::integer * 10,
    case when auth.uid() is not null then auth.uid() else p_created_by end
  from unnest(coalesce(p_image_ids, array[]::uuid[])) with ordinality ordered(image_id, ordinality)
  on conflict (observation_id, image_id) do nothing;
end;
$$;

grant execute on function public.replace_tu_observation_images(uuid, uuid, uuid, uuid[], uuid)
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'tu-investigation-audio',
  'tu-investigation-audio',
  false,
  26214400,
  array[
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/x-wav',
    'audio/x-m4a'
  ]::text[]
where not exists (
  select 1 from storage.buckets where id = 'tu-investigation-audio'
);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'tu_observations',
    'tu_observation_images',
    'tu_measurements',
    'tu_ai_runs',
    'tu_ai_suggestions'
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
