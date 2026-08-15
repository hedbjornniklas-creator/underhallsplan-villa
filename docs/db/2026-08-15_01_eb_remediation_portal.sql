-- EB remediation portal
-- Date: 2026-08-15
-- Scope:
-- 1) Replace free-text responsible party/trade group with a project-specific "Atgardas av" register
-- 2) Keep remediation work, replies and completion photos separate from the locked EB statement
-- 3) Provide revocable, accountless access links for contractor administrators and subcontractors
-- 4) Preserve an auditable history of assignments, comments and status changes

create table if not exists public.eb_remediation_assignees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  company_name text,
  contact_name text,
  email text,
  phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_remediation_assignees_name_check check (btrim(name) <> ''),
  constraint eb_remediation_assignees_normalized_name_check check (btrim(normalized_name) <> '')
);

create unique index if not exists eb_remediation_assignees_project_name_unique_idx
  on public.eb_remediation_assignees (eb_project_id, normalized_name);

create index if not exists eb_remediation_assignees_org_project_idx
  on public.eb_remediation_assignees (org_id, eb_project_id, is_active, name);

alter table public.eb_notes
  add column if not exists remediation_assignee_id uuid
    references public.eb_remediation_assignees (id) on delete set null;

create index if not exists eb_notes_remediation_assignee_idx
  on public.eb_notes (remediation_assignee_id)
  where remediation_assignee_id is not null;

-- Preserve and normalize values previously stored in either free-text field.
with source_values as (
  select distinct
    n.org_id,
    n.eb_project_id,
    btrim(coalesce(nullif(n.trade_group, ''), nullif(n.responsible_party, ''))) as name
  from public.eb_notes n
  where btrim(coalesce(nullif(n.trade_group, ''), nullif(n.responsible_party, ''))) <> ''
), normalized_values as (
  select
    org_id,
    eb_project_id,
    name,
    lower(regexp_replace(name, '\s+', ' ', 'g')) as normalized_name
  from source_values
)
insert into public.eb_remediation_assignees (
  org_id,
  eb_project_id,
  name,
  normalized_name
)
select
  org_id,
  eb_project_id,
  name,
  normalized_name
from normalized_values
on conflict (eb_project_id, normalized_name) do nothing;

update public.eb_notes n
set remediation_assignee_id = a.id
from public.eb_remediation_assignees a
where n.remediation_assignee_id is null
  and a.org_id = n.org_id
  and a.eb_project_id = n.eb_project_id
  and a.normalized_name = lower(
    regexp_replace(
      btrim(coalesce(nullif(n.trade_group, ''), nullif(n.responsible_party, ''))),
      '\s+',
      ' ',
      'g'
    )
  )
  and btrim(coalesce(nullif(n.trade_group, ''), nullif(n.responsible_party, ''))) <> '';

create table if not exists public.eb_remediation_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  eb_note_id uuid not null references public.eb_notes (id) on delete cascade,
  remediation_assignee_id uuid references public.eb_remediation_assignees (id) on delete set null,
  assignment_managed_by text not null default 'inspection',
  status text not null default 'unassigned',
  due_date date,
  included boolean not null default true,
  note_snapshot jsonb not null default '{}'::jsonb,
  reported_remedied_at timestamptz,
  reported_remedied_by_access_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_remediation_tasks_assignment_source_check
    check (assignment_managed_by in ('inspection', 'contractor')),
  constraint eb_remediation_tasks_status_check
    check (status in (
      'unassigned',
      'assigned',
      'in_progress',
      'ready_for_review',
      'returned',
      'reported_remedied',
      'cannot_remedy'
    ))
);

create unique index if not exists eb_remediation_tasks_note_unique_idx
  on public.eb_remediation_tasks (eb_note_id);

create index if not exists eb_remediation_tasks_project_status_idx
  on public.eb_remediation_tasks (eb_project_id, status, updated_at desc);

create index if not exists eb_remediation_tasks_assignee_idx
  on public.eb_remediation_tasks (remediation_assignee_id, status, updated_at desc)
  where remediation_assignee_id is not null;

create table if not exists public.eb_remediation_access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  remediation_assignee_id uuid references public.eb_remediation_assignees (id) on delete cascade,
  role text not null,
  display_name text,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  sent_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_remediation_access_links_role_check
    check (role in ('contractor_admin', 'contractor_viewer', 'assignee')),
  constraint eb_remediation_access_links_email_check check (btrim(email) <> ''),
  constraint eb_remediation_access_links_assignee_scope_check check (
    (role = 'assignee' and remediation_assignee_id is not null)
    or (role <> 'assignee' and remediation_assignee_id is null)
  )
);

alter table public.eb_remediation_tasks
  drop constraint if exists eb_remediation_tasks_reported_remedied_by_access_id_fkey;

alter table public.eb_remediation_tasks
  add constraint eb_remediation_tasks_reported_remedied_by_access_id_fkey
  foreign key (reported_remedied_by_access_id)
  references public.eb_remediation_access_links (id)
  on delete set null;

create index if not exists eb_remediation_access_links_project_idx
  on public.eb_remediation_access_links (eb_project_id, role, created_at desc);

create index if not exists eb_remediation_access_links_active_idx
  on public.eb_remediation_access_links (eb_project_id, remediation_assignee_id, expires_at)
  where revoked_at is null;

create table if not exists public.eb_remediation_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  task_id uuid not null references public.eb_remediation_tasks (id) on delete cascade,
  event_type text not null,
  actor_access_link_id uuid references public.eb_remediation_access_links (id) on delete set null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_email text,
  message text,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint eb_remediation_events_type_check
    check (event_type in (
      'task_created',
      'assigned',
      'status_changed',
      'comment',
      'photo_added',
      'link_sent',
      'link_revoked'
    ))
);

create index if not exists eb_remediation_events_task_idx
  on public.eb_remediation_events (task_id, created_at asc);

create index if not exists eb_remediation_events_project_idx
  on public.eb_remediation_events (eb_project_id, created_at desc);

create unique index if not exists eb_remediation_events_task_created_unique_idx
  on public.eb_remediation_events (task_id, event_type)
  where event_type = 'task_created';

create table if not exists public.eb_remediation_images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  task_id uuid not null references public.eb_remediation_tasks (id) on delete cascade,
  event_id uuid references public.eb_remediation_events (id) on delete set null,
  storage_bucket text not null default 'eb-remediation-images',
  file_path text not null,
  thumbnail_file_path text,
  file_name text,
  content_type text,
  file_size_bytes bigint,
  uploaded_by_access_link_id uuid references public.eb_remediation_access_links (id) on delete set null,
  uploaded_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint eb_remediation_images_file_path_check check (btrim(file_path) <> '')
);

create index if not exists eb_remediation_images_task_idx
  on public.eb_remediation_images (task_id, created_at asc);

drop trigger if exists trg_eb_remediation_assignees_set_updated_at
  on public.eb_remediation_assignees;
create trigger trg_eb_remediation_assignees_set_updated_at
before update on public.eb_remediation_assignees
for each row execute function public.eb_set_updated_at();

drop trigger if exists trg_eb_remediation_tasks_set_updated_at
  on public.eb_remediation_tasks;
create trigger trg_eb_remediation_tasks_set_updated_at
before update on public.eb_remediation_tasks
for each row execute function public.eb_set_updated_at();

drop trigger if exists trg_eb_remediation_access_links_set_updated_at
  on public.eb_remediation_access_links;
create trigger trg_eb_remediation_access_links_set_updated_at
before update on public.eb_remediation_access_links
for each row execute function public.eb_set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'eb-remediation-images',
  'eb-remediation-images',
  false,
  15728640,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
where not exists (
  select 1 from storage.buckets where id = 'eb-remediation-images'
);

alter table public.eb_remediation_assignees enable row level security;
alter table public.eb_remediation_tasks enable row level security;
alter table public.eb_remediation_access_links enable row level security;
alter table public.eb_remediation_events enable row level security;
alter table public.eb_remediation_images enable row level security;

grant select, insert, update, delete on table
  public.eb_remediation_assignees,
  public.eb_remediation_tasks,
  public.eb_remediation_access_links,
  public.eb_remediation_events,
  public.eb_remediation_images
to authenticated;

drop policy if exists eb_remediation_assignees_member_all on public.eb_remediation_assignees;
create policy eb_remediation_assignees_member_all
  on public.eb_remediation_assignees
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_remediation_tasks_member_all on public.eb_remediation_tasks;
create policy eb_remediation_tasks_member_all
  on public.eb_remediation_tasks
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_remediation_access_links_member_all on public.eb_remediation_access_links;
create policy eb_remediation_access_links_member_all
  on public.eb_remediation_access_links
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_remediation_events_member_all on public.eb_remediation_events;
create policy eb_remediation_events_member_all
  on public.eb_remediation_events
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists eb_remediation_images_member_all on public.eb_remediation_images;
create policy eb_remediation_images_member_all
  on public.eb_remediation_images
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

comment on table public.eb_remediation_tasks is
  'Operational remediation tasks derived from EB notes. These rows are intentionally outside the locked statement data.';

comment on column public.eb_notes.remediation_assignee_id is
  'Project-specific Atgardas av value selected while editing the inspection note.';

comment on column public.eb_remediation_tasks.reported_remedied_at is
  'When the contractor reported remediation complete. This is not a formal inspection approval.';

comment on column public.eb_remediation_access_links.token_hash is
  'SHA-256 hash of the accountless access token. Plain tokens are never stored.';
