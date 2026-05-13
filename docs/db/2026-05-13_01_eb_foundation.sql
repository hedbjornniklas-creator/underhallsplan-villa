-- EB foundation
-- Date: 2026-05-13
-- Scope:
-- 1) Dashboard access module for Entreprenadbesiktning
-- 2) Allow assignment_type = EB
-- 3) Global EB settings for SB and future inspection variants
-- 4) EB project, inspection detail, participant, discipline and note foundation

create extension if not exists pgcrypto;

create or replace function public.eb_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Access model seed
-- ---------------------------------------------------------------------
insert into public.platform_modules (product_id, key, label, description, is_active, sort_order)
select
  p.id,
  'construction_inspections',
  'Entreprenadbesiktning',
  'EB module for construction inspections, starting with SB.',
  true,
  250
from public.platform_products p
where p.key = 'dashboard'
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- Legacy dashboard inspector assignments without module_id represented all inspection modules.
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_by_profile_id,
  granted_reason,
  source_system,
  source_record_id
)
select
  a.profile_id,
  a.product_id,
  m.id,
  a.role_id,
  'global',
  null,
  true,
  a.granted_by_profile_id,
  coalesce(a.granted_reason, 'Backfilled from legacy Dashboard inspector access.'),
  'eb_foundation_backfill',
  a.id::text
from public.platform_access_assignments a
join public.platform_products p on p.id = a.product_id and p.key = 'dashboard'
join public.platform_roles r on r.id = a.role_id and r.key = 'inspector'
join public.platform_modules m on m.product_id = p.id and m.key = 'construction_inspections'
where a.module_id is null
  and a.is_active = true
  and not exists (
    select 1
    from public.platform_access_assignments existing
    where existing.profile_id = a.profile_id
      and existing.product_id = a.product_id
      and existing.module_id = m.id
      and existing.role_id = a.role_id
      and existing.scope_type = 'global'
      and existing.scope_id is null
  );

-- ---------------------------------------------------------------------
-- Assignment type
-- ---------------------------------------------------------------------
alter table public.assignments
  drop constraint if exists assignments_type_check;

alter table public.assignments
  add constraint assignments_type_check
  check (assignment_type in ('OB', 'STATUS', 'UHP', 'EB'));

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
create table if not exists public.settings_eb_inspection_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_inspection_types_key_check check (btrim(key) <> ''),
  constraint settings_eb_inspection_types_label_check check (btrim(label) <> '')
);

create unique index if not exists settings_eb_inspection_types_one_default_idx
  on public.settings_eb_inspection_types (is_default)
  where is_default = true;

drop trigger if exists trg_settings_eb_inspection_types_set_updated_at
  on public.settings_eb_inspection_types;
create trigger trg_settings_eb_inspection_types_set_updated_at
before update on public.settings_eb_inspection_types
for each row
execute function public.eb_set_updated_at();

create table if not exists public.settings_eb_disciplines (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  littera_prefix text,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_disciplines_key_check check (btrim(key) <> ''),
  constraint settings_eb_disciplines_label_check check (btrim(label) <> '')
);

drop trigger if exists trg_settings_eb_disciplines_set_updated_at
  on public.settings_eb_disciplines;
create trigger trg_settings_eb_disciplines_set_updated_at
before update on public.settings_eb_disciplines
for each row
execute function public.eb_set_updated_at();

create table if not exists public.settings_eb_note_statuses (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  color_token text not null default 'gray',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_note_statuses_key_check check (btrim(key) <> ''),
  constraint settings_eb_note_statuses_label_check check (btrim(label) <> '')
);

create unique index if not exists settings_eb_note_statuses_one_default_idx
  on public.settings_eb_note_statuses (is_default)
  where is_default = true;

drop trigger if exists trg_settings_eb_note_statuses_set_updated_at
  on public.settings_eb_note_statuses;
create trigger trg_settings_eb_note_statuses_set_updated_at
before update on public.settings_eb_note_statuses
for each row
execute function public.eb_set_updated_at();

create table if not exists public.settings_eb_note_markers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  color_token text not null default 'gray',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_note_markers_key_check check (btrim(key) <> ''),
  constraint settings_eb_note_markers_label_check check (btrim(label) <> '')
);

drop trigger if exists trg_settings_eb_note_markers_set_updated_at
  on public.settings_eb_note_markers;
create trigger trg_settings_eb_note_markers_set_updated_at
before update on public.settings_eb_note_markers
for each row
execute function public.eb_set_updated_at();

grant select on table
  public.settings_eb_inspection_types,
  public.settings_eb_disciplines,
  public.settings_eb_note_statuses,
  public.settings_eb_note_markers
to authenticated;

insert into public.settings_eb_inspection_types (key, label, description, sort_order, is_active, is_default)
values
  ('SB', 'Slutbesiktning', 'Första entreprenadbesiktningstypen i EB-modulen.', 100, true, true),
  ('FB', 'Förbesiktning', 'Planerad framtida besiktningstyp.', 200, true, false),
  ('EB', 'Efterbesiktning', 'Planerad framtida besiktningstyp.', 300, true, false),
  ('GB', 'Garantibesiktning', 'Planerad framtida besiktningstyp.', 400, true, false)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_default = excluded.is_default;

insert into public.settings_eb_disciplines (key, label, littera_prefix, sort_order, is_active)
values
  ('bygg', 'Bygg', 'BYGG', 100, true),
  ('mark', 'Mark', 'MARK', 200, true),
  ('ror', 'Rör', 'RÖR', 300, true),
  ('luft', 'Luft', 'LUFT', 400, true),
  ('el', 'El', 'EL', 500, true),
  ('styr', 'Styr', 'STYR', 600, true),
  ('brand', 'Brand', 'BRAND', 700, true),
  ('hiss', 'Hiss', 'HISS', 800, true)
on conflict (key) do update
set
  label = excluded.label,
  littera_prefix = excluded.littera_prefix,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.settings_eb_note_statuses (key, label, description, color_token, sort_order, is_active, is_default)
values
  ('open', 'Kvarstår', 'Noteringen kvarstår efter besiktning.', 'amber', 100, true, true),
  ('resolved', 'Avhjälpt', 'Noteringen är avhjälpt.', 'emerald', 200, true, false),
  ('not_accessible', 'Ej åtkomligt', 'Delen var inte åtkomlig vid besiktningen.', 'gray', 300, true, false),
  ('info', 'Information', 'Noteringen är endast informativ.', 'blue', 400, true, false)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  color_token = excluded.color_token,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_default = excluded.is_default;

insert into public.settings_eb_note_markers (key, label, description, color_token, sort_order, is_active)
values
  ('E', 'Entreprenörsansvar', 'Markerar entreprenörens ansvar.', 'amber', 100, true),
  ('B', 'Beställaransvar', 'Markerar beställarens ansvar.', 'sky', 200, true),
  ('S', 'Särskild utredning', 'Markerar fråga för särskild utredning.', 'violet', 300, true),
  ('U', 'Utgår', 'Markerar att noteringen utgår.', 'gray', 400, true),
  ('N', 'Nedsättning', 'Markerar nedsättning.', 'rose', 500, true),
  ('A', 'Anmärkning', 'Markerar anmärkning.', 'orange', 600, true)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  color_token = excluded.color_token,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------
-- EB operational tables
-- ---------------------------------------------------------------------
create table if not exists public.eb_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  contract_name text,
  property_designation text,
  address text,
  postal_code text,
  city text,
  municipality text,
  client_name text,
  contractor_name text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_projects_title_check check (btrim(title) <> ''),
  constraint eb_projects_status_check check (status in ('draft', 'active', 'completed', 'archived'))
);

alter table public.eb_projects
  add column if not exists property_id uuid references public.properties (id) on delete set null;

create index if not exists eb_projects_org_idx
  on public.eb_projects (org_id, updated_at desc);
create index if not exists eb_projects_owner_profile_idx
  on public.eb_projects (owner_profile_id, updated_at desc);
create index if not exists eb_projects_property_idx
  on public.eb_projects (property_id)
  where property_id is not null;

drop trigger if exists trg_eb_projects_set_updated_at on public.eb_projects;
create trigger trg_eb_projects_set_updated_at
before update on public.eb_projects
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_inspection_details (
  inspection_id uuid primary key references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  parent_inspection_id uuid references public.inspections (id) on delete set null,
  inspection_variant text not null default 'SB',
  sequence_no integer not null default 1,
  contract_form text,
  meeting_place text,
  start_meeting_time time,
  final_meeting_time time,
  invitation_sent_at timestamptz,
  invitation_sent_by uuid references public.profiles (id) on delete set null,
  invitation_message_id uuid references public.outbound_messages (id) on delete set null,
  invitation_subject text,
  invitation_body text,
  report_title text,
  report_locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_inspection_details_variant_check
    check (inspection_variant in ('SB', 'FB', 'EB', 'GB', 'KSB', 'SAB'))
);

alter table public.eb_inspection_details
  add column if not exists parent_inspection_id uuid references public.inspections (id) on delete set null,
  add column if not exists sequence_no integer not null default 1,
  add column if not exists invitation_sent_by uuid references public.profiles (id) on delete set null,
  add column if not exists invitation_message_id uuid references public.outbound_messages (id) on delete set null;

create index if not exists eb_inspection_details_org_idx
  on public.eb_inspection_details (org_id, updated_at desc);
create index if not exists eb_inspection_details_project_idx
  on public.eb_inspection_details (eb_project_id, updated_at desc);
create index if not exists eb_inspection_details_project_sequence_idx
  on public.eb_inspection_details (eb_project_id, sequence_no, created_at);
create index if not exists eb_inspection_details_parent_idx
  on public.eb_inspection_details (parent_inspection_id)
  where parent_inspection_id is not null;
create index if not exists eb_inspection_details_invitation_sent_at_idx
  on public.eb_inspection_details (invitation_sent_at desc)
  where invitation_sent_at is not null;

drop trigger if exists trg_eb_inspection_details_set_updated_at
  on public.eb_inspection_details;
create trigger trg_eb_inspection_details_set_updated_at
before update on public.eb_inspection_details
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  inspection_id uuid references public.inspections (id) on delete cascade,
  party_key text,
  role_label text,
  company_name text,
  person_name text,
  email text,
  phone text,
  receives_invitation boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eb_participants_project_idx
  on public.eb_participants (eb_project_id, sort_order);
create index if not exists eb_participants_inspection_idx
  on public.eb_participants (inspection_id, sort_order);

drop trigger if exists trg_eb_participants_set_updated_at on public.eb_participants;
create trigger trg_eb_participants_set_updated_at
before update on public.eb_participants
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_disciplines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  inspection_id uuid references public.inspections (id) on delete cascade,
  discipline_key text not null,
  label text not null,
  littera text,
  inspector_name text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_disciplines_label_check check (btrim(label) <> '')
);

create index if not exists eb_disciplines_project_idx
  on public.eb_disciplines (eb_project_id, sort_order);
create index if not exists eb_disciplines_inspection_idx
  on public.eb_disciplines (inspection_id, sort_order);

drop trigger if exists trg_eb_disciplines_set_updated_at on public.eb_disciplines;
create trigger trg_eb_disciplines_set_updated_at
before update on public.eb_disciplines
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  discipline_id uuid references public.eb_disciplines (id) on delete set null,
  source_note_id uuid references public.eb_notes (id) on delete set null,
  note_number integer,
  location text,
  marker_key text,
  status_key text not null default 'open',
  note_text text not null default '',
  responsible_party text,
  due_date date,
  sort_order integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eb_notes
  add column if not exists source_note_id uuid references public.eb_notes (id) on delete set null;

create index if not exists eb_notes_inspection_idx
  on public.eb_notes (inspection_id, sort_order, created_at);
create index if not exists eb_notes_project_idx
  on public.eb_notes (eb_project_id, sort_order, created_at);
create index if not exists eb_notes_source_note_idx
  on public.eb_notes (source_note_id)
  where source_note_id is not null;
create index if not exists eb_notes_org_text_idx
  on public.eb_notes using gin (to_tsvector('simple', coalesce(note_text, '')));

drop trigger if exists trg_eb_notes_set_updated_at on public.eb_notes;
create trigger trg_eb_notes_set_updated_at
before update on public.eb_notes
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_note_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  source_note_id uuid references public.eb_notes (id) on delete set null,
  phrase text not null,
  normalized_prefix text not null,
  use_count integer not null default 1,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_note_suggestions_phrase_check check (btrim(phrase) <> ''),
  constraint eb_note_suggestions_prefix_check check (btrim(normalized_prefix) <> '')
);

create unique index if not exists eb_note_suggestions_unique_idx
  on public.eb_note_suggestions (org_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), phrase);
create index if not exists eb_note_suggestions_prefix_idx
  on public.eb_note_suggestions (org_id, normalized_prefix, use_count desc, last_used_at desc);

drop trigger if exists trg_eb_note_suggestions_set_updated_at
  on public.eb_note_suggestions;
create trigger trg_eb_note_suggestions_set_updated_at
before update on public.eb_note_suggestions
for each row
execute function public.eb_set_updated_at();

alter table public.inspection_images
  add column if not exists eb_note_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inspection_images_eb_note_id_fkey'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_eb_note_id_fkey
      foreign key (eb_note_id) references public.eb_notes (id) on delete cascade;
  end if;
end;
$$;

create index if not exists inspection_images_eb_note_id_idx
  on public.inspection_images (eb_note_id)
  where eb_note_id is not null;

-- ---------------------------------------------------------------------
-- EB invitation mail logging
-- ---------------------------------------------------------------------
alter table public.outbound_messages
  add column if not exists inspection_id uuid references public.inspections (id) on delete set null,
  add column if not exists eb_project_id uuid references public.eb_projects (id) on delete set null;

create index if not exists outbound_messages_inspection_id_idx
  on public.outbound_messages (inspection_id)
  where inspection_id is not null;

create index if not exists outbound_messages_eb_project_id_idx
  on public.outbound_messages (eb_project_id)
  where eb_project_id is not null;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.eb_projects enable row level security;
alter table public.eb_inspection_details enable row level security;
alter table public.eb_participants enable row level security;
alter table public.eb_disciplines enable row level security;
alter table public.eb_notes enable row level security;
alter table public.eb_note_suggestions enable row level security;

grant select, insert, update, delete on table
  public.eb_projects,
  public.eb_inspection_details,
  public.eb_participants,
  public.eb_disciplines,
  public.eb_notes,
  public.eb_note_suggestions
to authenticated;

drop policy if exists eb_projects_select_member on public.eb_projects;
create policy eb_projects_select_member
  on public.eb_projects
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists eb_projects_insert_member on public.eb_projects;
create policy eb_projects_insert_member
  on public.eb_projects
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists eb_projects_update_member on public.eb_projects;
create policy eb_projects_update_member
  on public.eb_projects
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_projects_delete_admin on public.eb_projects;
create policy eb_projects_delete_admin
  on public.eb_projects
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists eb_inspection_details_select_member on public.eb_inspection_details;
create policy eb_inspection_details_select_member
  on public.eb_inspection_details
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists eb_inspection_details_insert_member on public.eb_inspection_details;
create policy eb_inspection_details_insert_member
  on public.eb_inspection_details
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists eb_inspection_details_update_member on public.eb_inspection_details;
create policy eb_inspection_details_update_member
  on public.eb_inspection_details
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_inspection_details_delete_admin on public.eb_inspection_details;
create policy eb_inspection_details_delete_admin
  on public.eb_inspection_details
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists eb_participants_member_all on public.eb_participants;
create policy eb_participants_member_all
  on public.eb_participants
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_disciplines_member_all on public.eb_disciplines;
create policy eb_disciplines_member_all
  on public.eb_disciplines
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_notes_member_all on public.eb_notes;
create policy eb_notes_member_all
  on public.eb_notes
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_note_suggestions_member_all on public.eb_note_suggestions;
create policy eb_note_suggestions_member_all
  on public.eb_note_suggestions
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
