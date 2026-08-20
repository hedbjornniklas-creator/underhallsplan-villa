-- Uppdrag v1: operational task and follow-up foundation
-- Date: 2026-08-20
-- Prerequisites:
--  - 2026-02-20_01_assignments_org_foundation.sql
--  - 2026-04-08_02_platform_access_foundation.sql
-- Scope:
-- 1) Seed the independently grantable Dashboard module "Uppdrag"
-- 2) Add organization-scoped internal/external recipients and hierarchical tasks
-- 3) Persist audit events, evidence, requirements and deadline-change decisions
-- 4) Add hash-only accountless access, per-task follow-up rules and durable communication jobs
-- 5) Store auditable AI runs and human-reviewed task suggestions with anti-loop limits
--
-- Design rules:
--  - "assignments" remains the inspection-order domain and "actions" remains maintenance planning.
--  - Every task has exactly one issuer and exactly one current assignee.
--  - AI may propose tasks, but a human/service workflow must accept a suggestion before a task is created.
--  - Risk/overdue are derived conditions, not workflow statuses.
--  - Plain access tokens are never stored.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Dashboard module and explicit initial access
-- ---------------------------------------------------------------------

insert into public.platform_modules (
  product_id,
  key,
  label,
  description,
  is_active,
  sort_order
)
select
  product.id,
  'tasks',
  'Uppdrag',
  'Delegering, uppfoljning, paminnelser och kontroll av operativa uppdrag.',
  true,
  350
from public.platform_products product
where product.key = 'dashboard'
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.platform_roles (
  product_id,
  key,
  label,
  description,
  is_active,
  sort_order
)
select
  product.id,
  seeded.key,
  seeded.label,
  seeded.description,
  true,
  seeded.sort_order
from public.platform_products product
join (
  values
    ('task_member', 'Uppdragsanvandare', 'Kan skapa, ta emot och folja upp uppdrag inom sin organisation.', 350),
    ('task_coordinator', 'Uppdragsansvarig', 'Kan samordna uppdrag, regler, kontakter och eskalering inom sin organisation.', 360)
) as seeded(key, label, description, sort_order)
  on true
where product.key = 'dashboard'
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- Initial rollout is intentionally admin-only. Project leaders/inspectors
-- receive task_member explicitly through normalized access administration.
with task_access_refs as (
  select
    product.id as product_id,
    module.id as module_id,
    role.id as role_id,
    role.key as role_key
  from public.platform_products product
  join public.platform_modules module
    on module.product_id = product.id
   and module.key = 'tasks'
  join public.platform_roles role
    on role.product_id = product.id
   and role.key in ('task_member', 'task_coordinator')
  where product.key = 'dashboard'
)
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_reason,
  source_system,
  source_record_id
)
select
  member.profile_id,
  refs.product_id,
  refs.module_id,
  refs.role_id,
  'organization',
  member.org_id::text,
  true,
  'Initial Uppdrag v1 access from org_members',
  'org_members_tasks_v1',
  member.id::text
from public.org_members member
join task_access_refs refs
  on refs.role_key = case
    when member.role = 'admin' then 'task_coordinator'
    else 'task_member'
  end
where member.is_active = true
  and member.role = 'admin'
  and not exists (
    select 1
    from public.platform_access_assignments existing
    where existing.profile_id = member.profile_id
      and existing.product_id = refs.product_id
      and existing.module_id = refs.module_id
      and existing.role_id = refs.role_id
      and existing.scope_type = 'organization'
      and existing.scope_id = member.org_id::text
  );

-- ---------------------------------------------------------------------
-- Shared helpers and organization parameters
-- ---------------------------------------------------------------------

create or replace function public.operational_tasks_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.operational_task_set_updated_at_and_version()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create table if not exists public.task_organization_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- A root task is depth 0; v1 therefore permits two delegated levels.
  max_subtask_depth integer not null default 2,
  max_open_children_per_task integer not null default 5,
  max_ai_children_per_task integer not null default 5,
  max_pending_ai_suggestions_per_root integer not null default 3,
  max_active_descendants integer not null default 15,
  timezone text not null default 'Europe/Stockholm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_organization_settings_depth_check
    check (max_subtask_depth between 1 and 4),
  constraint task_organization_settings_ai_children_check
    check (max_ai_children_per_task between 1 and 50),
  constraint task_organization_settings_open_children_check
    check (max_open_children_per_task between 1 and 50),
  constraint task_organization_settings_ai_pending_check
    check (max_pending_ai_suggestions_per_root between 1 and 100),
  constraint task_organization_settings_active_descendants_check
    check (max_active_descendants between 1 and 500),
  constraint task_organization_settings_timezone_check
    check (btrim(timezone) <> '')
);

insert into public.task_organization_settings (org_id)
select organization.id
from public.organizations organization
on conflict (org_id) do nothing;

create or replace function public.ensure_task_organization_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.task_organization_settings (org_id)
  values (new.id)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_task_organization_settings
  on public.organizations;
create trigger trg_ensure_task_organization_settings
after insert on public.organizations
for each row execute function public.ensure_task_organization_settings();

drop trigger if exists trg_task_organization_settings_set_updated_at
  on public.task_organization_settings;
create trigger trg_task_organization_settings_set_updated_at
before update on public.task_organization_settings
for each row execute function public.operational_tasks_set_updated_at();

-- ---------------------------------------------------------------------
-- Organization contacts
-- ---------------------------------------------------------------------

create table if not exists public.organization_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete restrict,
  name text not null,
  company_name text,
  email text,
  phone text,
  whatsapp_number text,
  preferred_channel text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_contacts_name_check
    check (btrim(name) <> ''),
  constraint organization_contacts_address_check
    check (
      profile_id is not null
      or nullif(btrim(coalesce(email, '')), '') is not null
      or nullif(btrim(coalesce(phone, '')), '') is not null
      or nullif(btrim(coalesce(whatsapp_number, '')), '') is not null
    ),
  constraint organization_contacts_preferred_channel_check
    check (
      preferred_channel is null
      or preferred_channel in ('email', 'whatsapp', 'in_app')
    ),
  constraint organization_contacts_email_channel_check
    check (
      preferred_channel <> 'email'
      or nullif(btrim(coalesce(email, '')), '') is not null
    ),
  constraint organization_contacts_whatsapp_channel_check
    check (
      preferred_channel <> 'whatsapp'
      or coalesce(
        nullif(btrim(coalesce(whatsapp_number, '')), ''),
        nullif(btrim(coalesce(phone, '')), '')
      ) is not null
    )
);

create unique index if not exists organization_contacts_org_profile_unique_idx
  on public.organization_contacts (org_id, profile_id)
  where profile_id is not null;

create index if not exists organization_contacts_org_active_name_idx
  on public.organization_contacts (org_id, is_active, name);

create index if not exists organization_contacts_org_email_idx
  on public.organization_contacts (org_id, lower(email))
  where email is not null;

create index if not exists organization_contacts_org_whatsapp_idx
  on public.organization_contacts (org_id, whatsapp_number)
  where whatsapp_number is not null;

create or replace function public.validate_organization_contact_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.profile_id is not null and not exists (
    select 1
    from public.org_members member
    where member.org_id = new.org_id
      and member.profile_id = new.profile_id
      and member.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_CONTACT_PROFILE_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_organization_contact_scope
  on public.organization_contacts;
create trigger trg_validate_organization_contact_scope
before insert or update on public.organization_contacts
for each row execute function public.validate_organization_contact_scope();

drop trigger if exists trg_organization_contacts_set_updated_at
  on public.organization_contacts;
create trigger trg_organization_contacts_set_updated_at
before update on public.organization_contacts
for each row execute function public.operational_tasks_set_updated_at();

-- ---------------------------------------------------------------------
-- Operational tasks
-- ---------------------------------------------------------------------

create table if not exists public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  parent_task_id uuid references public.operational_tasks (id) on delete restrict,
  root_task_id uuid not null references public.operational_tasks (id) on delete restrict,
  depth integer not null default 0,
  issuer_profile_id uuid not null references public.profiles (id) on delete restrict,
  assignee_profile_id uuid references public.profiles (id) on delete restrict,
  assignee_contact_id uuid references public.organization_contacts (id) on delete restrict,
  title text not null,
  description text,
  task_kind text not null default 'simple',
  status text not null default 'assigned',
  due_at timestamptz not null,
  next_followup_at timestamptz not null,
  primary_channel text not null default 'in_app',
  fallback_channel text,
  context_label text,
  evidence_requirement text not null default 'optional',
  review_round integer not null default 0,
  version integer not null default 1,
  created_source text not null default 'manual',
  source_ai_suggestion_id uuid,
  submitted_for_review_at timestamptz,
  approved_at timestamptz,
  approved_by_profile_id uuid references public.profiles (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_tasks_title_check
    check (btrim(title) <> ''),
  constraint operational_tasks_depth_check
    check (depth >= 0),
  constraint operational_tasks_hierarchy_shape_check
    check (
      (parent_task_id is null and depth = 0 and root_task_id = id)
      or
      (parent_task_id is not null and depth > 0 and root_task_id <> id)
    ),
  constraint operational_tasks_one_assignee_check
    check (num_nonnulls(assignee_profile_id, assignee_contact_id) = 1),
  constraint operational_tasks_kind_check
    check (task_kind in (
      'simple', 'paid_external', 'warranty',
      'general', 'additional_work', 'inspection_remediation', 'custom'
    )),
  constraint operational_tasks_status_check
    check (status in (
      'draft',
      'assigned',
      'in_progress',
      'waiting',
      'ready_for_review',
      'returned',
      'approved',
      'cancelled'
    )),
  constraint operational_tasks_primary_channel_check
    check (primary_channel in ('email', 'whatsapp', 'in_app')),
  constraint operational_tasks_fallback_channel_check
    check (
      fallback_channel is null
      or fallback_channel in ('email', 'whatsapp', 'in_app')
    ),
  constraint operational_tasks_distinct_channels_check
    check (fallback_channel is null or fallback_channel <> primary_channel),
  constraint operational_tasks_evidence_requirement_check
    check (evidence_requirement in ('optional', 'text', 'photo', 'document', 'any')),
  constraint operational_tasks_review_round_check
    check (review_round >= 0),
  constraint operational_tasks_version_check
    check (version > 0),
  constraint operational_tasks_created_source_check
    check (created_source in (
      'manual',
      'ai_suggestion',
      'system',
      'import',
      'eb_remediation',
      'maintenance_action'
    )),
  constraint operational_tasks_ai_source_check
    check (created_source <> 'ai_suggestion' or source_ai_suggestion_id is not null),
  constraint operational_tasks_review_state_check
    check (
      (status <> 'approved')
      or (
        submitted_for_review_at is not null
        and approved_at is not null
        and approved_by_profile_id is not null
      )
    )
);

create index if not exists operational_tasks_org_status_due_idx
  on public.operational_tasks (org_id, status, due_at, next_followup_at)
  where archived_at is null;

create index if not exists operational_tasks_root_depth_idx
  on public.operational_tasks (root_task_id, depth, created_at);

create index if not exists operational_tasks_parent_status_idx
  on public.operational_tasks (parent_task_id, status, due_at)
  where parent_task_id is not null and archived_at is null;

create index if not exists operational_tasks_issuer_idx
  on public.operational_tasks (org_id, issuer_profile_id, status, due_at)
  where archived_at is null;

create index if not exists operational_tasks_assignee_profile_idx
  on public.operational_tasks (org_id, assignee_profile_id, status, due_at)
  where assignee_profile_id is not null and archived_at is null;

create index if not exists operational_tasks_assignee_contact_idx
  on public.operational_tasks (org_id, assignee_contact_id, status, due_at)
  where assignee_contact_id is not null and archived_at is null;

create index if not exists operational_tasks_followup_due_idx
  on public.operational_tasks (next_followup_at, org_id)
  where archived_at is null
    and status not in ('approved', 'cancelled');

create unique index if not exists operational_tasks_source_ai_suggestion_unique_idx
  on public.operational_tasks (source_ai_suggestion_id)
  where source_ai_suggestion_id is not null;

create or replace function public.prepare_operational_task_hierarchy()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  parent_row public.operational_tasks%rowtype;
  configured_max_depth integer;
  configured_max_open_children integer;
  configured_max_active_descendants integer;
  open_children integer;
  active_descendants integer;
begin
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id
      or new.parent_task_id is distinct from old.parent_task_id
      or new.root_task_id is distinct from old.root_task_id
      or new.depth is distinct from old.depth
      or new.issuer_profile_id is distinct from old.issuer_profile_id
      or new.created_by_profile_id is distinct from old.created_by_profile_id
      or new.created_source is distinct from old.created_source
      or new.source_ai_suggestion_id is distinct from old.source_ai_suggestion_id
    then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_IMMUTABLE_FIELDS';
    end if;

    if new.due_at is distinct from old.due_at and exists (
      select 1
      from public.operational_tasks child
      where child.parent_task_id = new.id
        and child.archived_at is null
        and child.status not in ('approved', 'cancelled')
        and child.due_at > new.due_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_PARENT_BEFORE_CHILD_DUE';
    end if;
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1
    from public.org_members member
    where member.org_id = new.org_id
      and member.profile_id = new.issuer_profile_id
      and member.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'OPERATIONAL_TASK_ISSUER_SCOPE_INVALID';
  end if;

  if new.assignee_profile_id is not null
    and (tg_op = 'INSERT' or new.assignee_profile_id is distinct from old.assignee_profile_id)
    and not exists (
    select 1
    from public.org_members member
    where member.org_id = new.org_id
      and member.profile_id = new.assignee_profile_id
      and member.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'OPERATIONAL_TASK_ASSIGNEE_SCOPE_INVALID';
  end if;

  if new.assignee_contact_id is not null
    and (tg_op = 'INSERT' or new.assignee_contact_id is distinct from old.assignee_contact_id)
    and not exists (
    select 1
    from public.organization_contacts contact
    where contact.id = new.assignee_contact_id
      and contact.org_id = new.org_id
      and contact.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'OPERATIONAL_TASK_ASSIGNEE_SCOPE_INVALID';
  end if;

  if new.parent_task_id is null then
    new.root_task_id := new.id;
    new.depth := 0;
  else
    if new.parent_task_id = new.id then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_HIERARCHY_CYCLE';
    end if;

    select task.*
    into parent_row
    from public.operational_tasks task
    where task.id = new.parent_task_id
    for share;

    if not found or parent_row.org_id <> new.org_id then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_PARENT_SCOPE_INVALID';
    end if;

    if parent_row.status in ('approved', 'cancelled') or parent_row.archived_at is not null then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_PARENT_CLOSED';
    end if;

    new.root_task_id := parent_row.root_task_id;
    new.depth := parent_row.depth + 1;

    if new.due_at > parent_row.due_at then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_CHILD_AFTER_PARENT_DUE';
    end if;
  end if;

  select
    settings.max_subtask_depth,
    settings.max_open_children_per_task,
    settings.max_active_descendants
  into configured_max_depth, configured_max_open_children, configured_max_active_descendants
  from public.task_organization_settings settings
  where settings.org_id = new.org_id;

  configured_max_depth := coalesce(configured_max_depth, 2);
  if tg_op = 'INSERT' and new.depth > configured_max_depth then
    raise exception using
      errcode = '23514',
      message = 'OPERATIONAL_TASK_MAX_DEPTH_EXCEEDED';
  end if;

  if tg_op = 'INSERT' and new.parent_task_id is not null then
    -- Serialize capacity checks for the same tree so concurrent API requests
    -- cannot both pass the descendant budget.
    perform pg_advisory_xact_lock(hashtextextended(new.root_task_id::text, 0));
    configured_max_open_children := coalesce(configured_max_open_children, 5);
    configured_max_active_descendants := coalesce(configured_max_active_descendants, 15);

    select count(*)
    into open_children
    from public.operational_tasks task
    where task.parent_task_id = new.parent_task_id
      and task.archived_at is null
      and task.status not in ('approved', 'cancelled');

    if open_children >= configured_max_open_children then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_MAX_OPEN_CHILDREN_EXCEEDED';
    end if;

    select count(*)
    into active_descendants
    from public.operational_tasks task
    where task.root_task_id = new.root_task_id
      and task.id <> task.root_task_id
      and task.archived_at is null
      and task.status not in ('approved', 'cancelled');

    if active_descendants >= configured_max_active_descendants then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_MAX_ACTIVE_DESCENDANTS_EXCEEDED';
    end if;
  end if;

  if tg_op = 'INSERT' and new.created_source = 'ai_suggestion' and not exists (
    select 1
    from public.task_ai_suggestions suggestion
    where suggestion.id = new.source_ai_suggestion_id
      and suggestion.org_id = new.org_id
      and suggestion.root_task_id = new.root_task_id
      and suggestion.task_id = new.parent_task_id
      and suggestion.suggestion_type = 'create_subtask'
      and suggestion.status = 'pending'
  ) then
    raise exception using
      errcode = '23514',
      message = 'OPERATIONAL_TASK_AI_SUGGESTION_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_operational_task_hierarchy
  on public.operational_tasks;
create trigger trg_prepare_operational_task_hierarchy
before insert or update on public.operational_tasks
for each row execute function public.prepare_operational_task_hierarchy();

drop trigger if exists trg_operational_task_set_updated_at_and_version
  on public.operational_tasks;
create trigger trg_operational_task_set_updated_at_and_version
before update on public.operational_tasks
for each row execute function public.operational_task_set_updated_at_and_version();

comment on table public.operational_tasks is
  'Organization-scoped operational assignments. Kept separate from inspection orders (assignments), maintenance actions and EB remediation snapshots.';
comment on column public.operational_tasks.root_task_id is
  'Denormalized root used for complete-tree overview, access scoping and AI budgets. Set by trigger.';
comment on column public.operational_tasks.next_followup_at is
  'The next moment Signe or a human must act. Required even when the business due date is later.';
comment on column public.operational_tasks.created_source is
  'Origin of the task. ai_suggestion requires a reviewed source_ai_suggestion_id.';

-- ---------------------------------------------------------------------
-- Hash-only external access
-- ---------------------------------------------------------------------

create table if not exists public.task_access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  root_task_id uuid not null references public.operational_tasks (id) on delete cascade,
  contact_id uuid not null references public.organization_contacts (id) on delete cascade,
  role text not null default 'assignee',
  scope text not null default 'task',
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  sent_at timestamptz,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_access_links_role_check
    check (role in ('assignee', 'delegator', 'viewer')),
  constraint task_access_links_scope_check
    check (scope in ('task', 'branch')),
  constraint task_access_links_token_hash_check
    check (char_length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'),
  constraint task_access_links_token_hash_unique
    unique (token_hash),
  constraint task_access_links_expiry_check
    check (expires_at > created_at)
);

create index if not exists task_access_links_task_idx
  on public.task_access_links (task_id, role, created_at desc);

create index if not exists task_access_links_root_contact_idx
  on public.task_access_links (root_task_id, contact_id, expires_at)
  where revoked_at is null;

create unique index if not exists task_access_links_active_task_contact_unique_idx
  on public.task_access_links (task_id, contact_id)
  where revoked_at is null;

create index if not exists task_access_links_active_hash_idx
  on public.task_access_links (token_hash, expires_at)
  where revoked_at is null;

drop trigger if exists trg_task_access_links_set_updated_at
  on public.task_access_links;
create trigger trg_task_access_links_set_updated_at
before update on public.task_access_links
for each row execute function public.operational_tasks_set_updated_at();

create or replace function public.revoke_task_access_links_for_inactive_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.is_active = true and new.is_active = false then
    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.contact_id = new.id
      and access_link.org_id = new.org_id
      and access_link.revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_revoke_task_links_for_inactive_contact
  on public.organization_contacts;
create trigger trg_revoke_task_links_for_inactive_contact
after update of is_active on public.organization_contacts
for each row execute function public.revoke_task_access_links_for_inactive_contact();

comment on column public.task_access_links.token_hash is
  'SHA-256 hash of a random access token. A plain token must never be persisted.';

-- ---------------------------------------------------------------------
-- Append-only task events
-- ---------------------------------------------------------------------

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_contact_id uuid references public.organization_contacts (id) on delete set null,
  actor_access_link_id uuid references public.task_access_links (id) on delete set null,
  actor_name text,
  message text,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_events_type_check
    check (btrim(event_type) <> ''),
  constraint task_events_actor_type_check
    check (actor_type in ('profile', 'contact', 'ai', 'system')),
  constraint task_events_actor_shape_check
    check (
      (actor_type = 'profile' and actor_profile_id is not null and actor_contact_id is null)
      or
      (actor_type = 'contact' and actor_contact_id is not null and actor_profile_id is null)
      or
      (actor_type in ('ai', 'system') and actor_profile_id is null and actor_contact_id is null)
    ),
  constraint task_events_from_status_check
    check (
      from_status is null
      or from_status in (
        'draft', 'assigned', 'in_progress', 'waiting', 'ready_for_review',
        'returned', 'approved', 'cancelled'
      )
    ),
  constraint task_events_to_status_check
    check (
      to_status is null
      or to_status in (
        'draft', 'assigned', 'in_progress', 'waiting', 'ready_for_review',
        'returned', 'approved', 'cancelled'
      )
    ),
  constraint task_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists task_events_task_created_idx
  on public.task_events (task_id, created_at, id);

create index if not exists task_events_org_created_idx
  on public.task_events (org_id, created_at desc);

create index if not exists task_events_transcription_profile_created_idx
  on public.task_events (actor_profile_id, created_at desc)
  where event_type = 'transcription_requested'
    and actor_profile_id is not null;

create index if not exists task_events_transcription_contact_created_idx
  on public.task_events (actor_contact_id, created_at desc)
  where event_type = 'transcription_requested'
    and actor_contact_id is not null;

create unique index if not exists task_events_task_created_unique_idx
  on public.task_events (task_id, event_type)
  where event_type = 'task_created';

comment on table public.task_events is
  'Append-only audit trail for human, external, AI and system activity.';

-- ---------------------------------------------------------------------
-- Completion evidence: images, documents, typed text and voice
-- ---------------------------------------------------------------------

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  event_id uuid references public.task_events (id) on delete set null,
  attachment_type text not null,
  title text,
  storage_bucket text,
  file_path text,
  file_name text,
  content_type text,
  file_size_bytes bigint,
  text_content text,
  transcript_text text,
  transcription_model text,
  audio_duration_seconds integer,
  is_completion_evidence boolean not null default false,
  uploaded_by_profile_id uuid references public.profiles (id) on delete set null,
  uploaded_by_contact_id uuid references public.organization_contacts (id) on delete set null,
  uploaded_by_access_link_id uuid references public.task_access_links (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_attachments_type_check
    check (attachment_type in ('photo', 'document', 'audio', 'text')),
  constraint task_attachments_payload_check
    check (
      (attachment_type = 'text' and nullif(btrim(coalesce(text_content, '')), '') is not null)
      or
      (attachment_type <> 'text'
        and nullif(btrim(coalesce(storage_bucket, '')), '') is not null
        and nullif(btrim(coalesce(file_path, '')), '') is not null)
    ),
  constraint task_attachments_file_size_check
    check (file_size_bytes is null or file_size_bytes >= 0),
  constraint task_attachments_audio_duration_check
    check (audio_duration_seconds is null or audio_duration_seconds >= 0),
  constraint task_attachments_uploader_check
    check (
      num_nonnulls(uploaded_by_profile_id, uploaded_by_contact_id) = 1
      and (uploaded_by_access_link_id is null or uploaded_by_contact_id is not null)
    )
);

create index if not exists task_attachments_task_created_idx
  on public.task_attachments (task_id, created_at);

create index if not exists task_attachments_completion_idx
  on public.task_attachments (task_id, is_completion_evidence, created_at)
  where is_completion_evidence = true;

create index if not exists task_attachments_event_idx
  on public.task_attachments (event_id)
  where event_id is not null;

comment on table public.task_attachments is
  'Private task evidence metadata. Binary content is stored in task-evidence; typed text can be stored directly.';

-- ---------------------------------------------------------------------
-- Data-driven gates instead of endless AI-created subtasks
-- ---------------------------------------------------------------------

create table if not exists public.task_requirement_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  task_kind text not null,
  requirement_key text not null,
  label text not null,
  description text,
  is_required boolean not null default true,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_requirement_templates_kind_check
    check (task_kind in (
      'simple', 'paid_external', 'warranty',
      'general', 'additional_work', 'inspection_remediation', 'custom'
    )),
  constraint task_requirement_templates_key_check
    check (btrim(requirement_key) <> ''),
  constraint task_requirement_templates_label_check
    check (btrim(label) <> ''),
  constraint task_requirement_templates_sort_order_check
    check (sort_order >= 0)
);

create unique index if not exists task_requirement_templates_scope_unique_idx
  on public.task_requirement_templates (
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    task_kind,
    requirement_key
  );

create index if not exists task_requirement_templates_lookup_idx
  on public.task_requirement_templates (task_kind, org_id, is_active, sort_order);

insert into public.task_requirement_templates (
  org_id,
  task_kind,
  requirement_key,
  label,
  description,
  is_required,
  sort_order
)
select
  null,
  seeded.task_kind,
  seeded.requirement_key,
  seeded.label,
  seeded.description,
  true,
  seeded.sort_order
from (
  values
    (
      'paid_external',
      'written_quote',
      'Skriftlig offert fran utforaren',
      'Offerten ska finnas sparad innan bestallarens godkannande och utforande drivs vidare.',
      100
    ),
    (
      'paid_external',
      'written_client_approval',
      'Skriftligt godkannande fran bestallaren',
      'Bestallarens skriftliga accept ska finnas innan arbetet bestalls eller godkanns som klart.',
      200
    ),
    (
      'warranty',
      'warranty_basis',
      'Garantiansvaret ar dokumenterat',
      'Underlag ska visa varfor atgarden hanteras som garanti och vem som ansvarar.',
      100
    )
) as seeded(task_kind, requirement_key, label, description, sort_order)
where not exists (
  select 1
  from public.task_requirement_templates existing
  where existing.org_id is null
    and existing.task_kind = seeded.task_kind
    and existing.requirement_key = seeded.requirement_key
);

drop trigger if exists trg_task_requirement_templates_set_updated_at
  on public.task_requirement_templates;
create trigger trg_task_requirement_templates_set_updated_at
before update on public.task_requirement_templates
for each row execute function public.operational_tasks_set_updated_at();

create table if not exists public.task_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  requirement_key text not null,
  label text not null,
  status text not null default 'pending',
  is_required boolean not null default true,
  description text,
  evidence_attachment_id uuid references public.task_attachments (id) on delete set null,
  verified_by_profile_id uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_requirements_key_check
    check (btrim(requirement_key) <> ''),
  constraint task_requirements_label_check
    check (btrim(label) <> ''),
  constraint task_requirements_status_check
    check (status in (
      'pending', 'evidence_detected', 'verified', 'not_required', 'waived'
    )),
  constraint task_requirements_verification_pair_check
    check (
      (status not in ('verified', 'not_required', 'waived')
        and verified_by_profile_id is null and verified_at is null)
      or
      (status in ('verified', 'not_required', 'waived')
        and verified_by_profile_id is not null and verified_at is not null)
    ),
  constraint task_requirements_sort_order_check
    check (sort_order >= 0),
  constraint task_requirements_unique
    unique (task_id, requirement_key)
);

create index if not exists task_requirements_task_status_idx
  on public.task_requirements (task_id, is_required, status, sort_order);

drop trigger if exists trg_task_requirements_set_updated_at
  on public.task_requirements;
create trigger trg_task_requirements_set_updated_at
before update on public.task_requirements
for each row execute function public.operational_tasks_set_updated_at();

create or replace function public.register_task_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  expected_type text;
begin
  if not new.is_completion_evidence then
    return new;
  end if;

  select case task.evidence_requirement
    when 'text' then 'text'
    when 'photo' then 'photo'
    when 'document' then 'document'
    else null
  end
  into expected_type
  from public.operational_tasks task
  where task.id = new.task_id;

  if expected_type is not null and not (
    new.attachment_type = expected_type
    or (
      expected_type = 'text'
      and new.attachment_type = 'audio'
      and nullif(btrim(coalesce(new.transcript_text, '')), '') is not null
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_COMPLETION_EVIDENCE_TYPE_INVALID';
  end if;

  update public.task_requirements requirement
  set
    status = 'evidence_detected',
    evidence_attachment_id = new.id,
    verified_by_profile_id = null,
    verified_at = null
  where requirement.task_id = new.task_id
    and requirement.requirement_key = 'completion_evidence'
    and requirement.status in ('pending', 'evidence_detected');

  return new;
end;
$$;

drop trigger if exists trg_register_task_completion_evidence
  on public.task_attachments;
create trigger trg_register_task_completion_evidence
after insert on public.task_attachments
for each row execute function public.register_task_completion_evidence();

-- ---------------------------------------------------------------------
-- Deadline extension requests
-- ---------------------------------------------------------------------

create table if not exists public.task_deadline_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  requested_by_profile_id uuid references public.profiles (id) on delete set null,
  requested_by_contact_id uuid references public.organization_contacts (id) on delete set null,
  requested_by_access_link_id uuid references public.task_access_links (id) on delete set null,
  current_due_at timestamptz not null,
  requested_due_at timestamptz not null,
  reason text not null,
  status text not null default 'pending',
  decided_by_profile_id uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_deadline_change_requests_requester_check
    check (num_nonnulls(requested_by_profile_id, requested_by_contact_id) = 1),
  constraint task_deadline_change_requests_due_check
    check (requested_due_at > current_due_at),
  constraint task_deadline_change_requests_reason_check
    check (btrim(reason) <> ''),
  constraint task_deadline_change_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint task_deadline_change_requests_decision_check
    check (
      (status = 'pending' and decided_by_profile_id is null and decided_at is null)
      or
      (status = 'cancelled')
      or
      (status in ('approved', 'rejected')
        and decided_by_profile_id is not null
        and decided_at is not null)
    )
);

create unique index if not exists task_deadline_change_requests_pending_unique_idx
  on public.task_deadline_change_requests (task_id)
  where status = 'pending';

create index if not exists task_deadline_change_requests_org_status_idx
  on public.task_deadline_change_requests (org_id, status, created_at desc);

drop trigger if exists trg_task_deadline_change_requests_set_updated_at
  on public.task_deadline_change_requests;
create trigger trg_task_deadline_change_requests_set_updated_at
before update on public.task_deadline_change_requests
for each row execute function public.operational_tasks_set_updated_at();

-- ---------------------------------------------------------------------
-- Per-task follow-up plan
-- ---------------------------------------------------------------------

create table if not exists public.task_followup_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  unacknowledged_after_hours integer not null default 48,
  reminder_offsets_hours jsonb not null default '[72, 24, 0]'::jsonb,
  overdue_interval_hours integer not null default 24,
  escalate_after_overdue_hours integer not null default 48,
  fallback_after_hours integer not null default 24,
  max_reminders integer not null default 20,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_followup_rules_task_unique
    unique (task_id),
  constraint task_followup_rules_unacknowledged_check
    check (unacknowledged_after_hours between 1 and 8760),
  constraint task_followup_rules_offsets_check
    check (jsonb_typeof(reminder_offsets_hours) = 'array'),
  constraint task_followup_rules_overdue_check
    check (overdue_interval_hours between 1 and 8760),
  constraint task_followup_rules_escalation_check
    check (escalate_after_overdue_hours between 1 and 8760),
  constraint task_followup_rules_fallback_check
    check (fallback_after_hours between 1 and 8760),
  constraint task_followup_rules_max_reminders_check
    check (max_reminders between 1 and 100)
);

create index if not exists task_followup_rules_org_active_idx
  on public.task_followup_rules (org_id, is_active, updated_at desc);

drop trigger if exists trg_task_followup_rules_set_updated_at
  on public.task_followup_rules;
create trigger trg_task_followup_rules_set_updated_at
before update on public.task_followup_rules
for each row execute function public.operational_tasks_set_updated_at();

-- ---------------------------------------------------------------------
-- Auditable AI runs and suggestions
-- ---------------------------------------------------------------------

create table if not exists public.task_ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  root_task_id uuid not null references public.operational_tasks (id) on delete cascade,
  operation text not null,
  status text not null default 'queued',
  model text not null,
  ruleset_key text not null default 'signe_tasks_v1',
  ruleset_version integer not null default 1,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  error_message text,
  attempt_count integer not null default 0,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_ai_runs_operation_check
    check (operation in (
      'followup_message',
      'status_interpretation',
      'risk_assessment',
      'next_task_suggestions'
    )),
  constraint task_ai_runs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint task_ai_runs_model_check
    check (btrim(model) <> ''),
  constraint task_ai_runs_ruleset_check
    check (btrim(ruleset_key) <> '' and ruleset_version > 0),
  constraint task_ai_runs_input_check
    check (jsonb_typeof(input_snapshot) = 'object'),
  constraint task_ai_runs_output_check
    check (output_payload is null or jsonb_typeof(output_payload) = 'object'),
  constraint task_ai_runs_attempt_count_check
    check (attempt_count >= 0)
);

create index if not exists task_ai_runs_task_created_idx
  on public.task_ai_runs (task_id, created_at desc);

create index if not exists task_ai_runs_root_created_idx
  on public.task_ai_runs (root_task_id, created_at desc);

create index if not exists task_ai_runs_queue_idx
  on public.task_ai_runs (status, created_at)
  where status in ('queued', 'processing');

create unique index if not exists task_ai_runs_active_operation_idx
  on public.task_ai_runs (task_id, operation)
  where status in ('queued', 'processing');

drop trigger if exists trg_task_ai_runs_set_updated_at
  on public.task_ai_runs;
create trigger trg_task_ai_runs_set_updated_at
before update on public.task_ai_runs
for each row execute function public.operational_tasks_set_updated_at();

create table if not exists public.task_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  root_task_id uuid not null references public.operational_tasks (id) on delete cascade,
  run_id uuid not null references public.task_ai_runs (id) on delete cascade,
  suggestion_type text not null,
  title text not null,
  description text,
  proposed_payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending',
  reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  accepted_task_id uuid references public.operational_tasks (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_ai_suggestions_type_check
    check (suggestion_type in (
      'create_subtask',
      'request_evidence',
      'schedule_followup',
      'escalate',
      'status_update'
    )),
  constraint task_ai_suggestions_title_check
    check (btrim(title) <> ''),
  constraint task_ai_suggestions_payload_check
    check (jsonb_typeof(proposed_payload) = 'object'),
  constraint task_ai_suggestions_dedupe_key_check
    check (dedupe_key is null or btrim(dedupe_key) <> ''),
  constraint task_ai_suggestions_status_check
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  constraint task_ai_suggestions_review_check
    check (
      (status = 'pending' and reviewed_by_profile_id is null and reviewed_at is null)
      or
      (status = 'expired')
      or
      (status in ('accepted', 'rejected')
        and reviewed_by_profile_id is not null
        and reviewed_at is not null)
    ),
  constraint task_ai_suggestions_acceptance_check
    check (
      (status = 'accepted' and suggestion_type <> 'create_subtask')
      or (status = 'accepted' and suggestion_type = 'create_subtask' and accepted_task_id is not null)
      or (status <> 'accepted' and accepted_task_id is null)
    )
);

create index if not exists task_ai_suggestions_task_status_idx
  on public.task_ai_suggestions (task_id, status, created_at desc);

create index if not exists task_ai_suggestions_root_status_idx
  on public.task_ai_suggestions (root_task_id, status, created_at desc);

create unique index if not exists task_ai_suggestions_pending_dedupe_idx
  on public.task_ai_suggestions (root_task_id, dedupe_key)
  where status = 'pending' and dedupe_key is not null;

drop trigger if exists trg_task_ai_suggestions_set_updated_at
  on public.task_ai_suggestions;
create trigger trg_task_ai_suggestions_set_updated_at
before update on public.task_ai_suggestions
for each row execute function public.operational_tasks_set_updated_at();

-- Complete the intentionally deferred circular link. A task created from AI
-- must point back to the reviewed suggestion that produced it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_tasks_source_ai_suggestion_fkey'
      and conrelid = 'public.operational_tasks'::regclass
  ) then
    alter table public.operational_tasks
      add constraint operational_tasks_source_ai_suggestion_fkey
      foreign key (source_ai_suggestion_id)
      references public.task_ai_suggestions (id)
      on delete restrict;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Conversation, provider delivery and durable automation outbox
-- ---------------------------------------------------------------------

create table if not exists public.task_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  direction text not null,
  message_type text not null default 'comment',
  actor_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_contact_id uuid references public.organization_contacts (id) on delete set null,
  actor_access_link_id uuid references public.task_access_links (id) on delete set null,
  actor_name text,
  body_text text not null,
  in_reply_to_message_id uuid references public.task_messages (id) on delete set null,
  provider_thread_id text,
  provider_message_id text,
  generated_by_ai boolean not null default false,
  ai_run_id uuid references public.task_ai_runs (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_messages_direction_check
    check (direction in ('inbound', 'outbound', 'internal', 'system')),
  constraint task_messages_type_check
    check (message_type in ('assignment', 'reminder', 'status_request', 'reply', 'comment', 'escalation', 'decision')),
  constraint task_messages_actor_type_check
    check (actor_type in ('profile', 'contact', 'ai', 'system')),
  constraint task_messages_actor_shape_check
    check (
      (actor_type = 'profile' and actor_profile_id is not null and actor_contact_id is null)
      or
      (actor_type = 'contact' and actor_contact_id is not null and actor_profile_id is null)
      or
      (actor_type in ('ai', 'system') and actor_profile_id is null and actor_contact_id is null)
    ),
  constraint task_messages_body_check
    check (btrim(body_text) <> ''),
  constraint task_messages_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint task_messages_ai_shape_check
    check (not generated_by_ai or ai_run_id is not null)
);

create index if not exists task_messages_task_created_idx
  on public.task_messages (task_id, created_at, id);

create index if not exists task_messages_provider_message_idx
  on public.task_messages (provider_message_id)
  where provider_message_id is not null;

create table if not exists public.task_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  message_id uuid not null references public.task_messages (id) on delete cascade,
  channel text not null,
  recipient_address text not null,
  provider text,
  provider_message_id text,
  status text not null default 'queued',
  is_fallback boolean not null default false,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  error_message text,
  idempotency_key text not null,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_message_deliveries_channel_check
    check (channel in ('email', 'whatsapp', 'in_app')),
  constraint task_message_deliveries_recipient_check
    check (btrim(recipient_address) <> ''),
  constraint task_message_deliveries_status_check
    check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'replied', 'failed', 'cancelled')),
  constraint task_message_deliveries_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint task_message_deliveries_idempotency_check
    check (btrim(idempotency_key) <> ''),
  constraint task_message_deliveries_payload_check
    check (jsonb_typeof(provider_payload) = 'object'),
  constraint task_message_deliveries_org_idempotency_unique
    unique (org_id, idempotency_key)
);

create index if not exists task_message_deliveries_task_created_idx
  on public.task_message_deliveries (task_id, created_at desc);

create index if not exists task_message_deliveries_due_idx
  on public.task_message_deliveries (coalesce(next_attempt_at, scheduled_at), created_at)
  where status in ('queued', 'failed');

create index if not exists task_message_deliveries_provider_idx
  on public.task_message_deliveries (provider, provider_message_id)
  where provider_message_id is not null;

drop trigger if exists trg_task_message_deliveries_set_updated_at
  on public.task_message_deliveries;
create trigger trg_task_message_deliveries_set_updated_at
before update on public.task_message_deliveries
for each row execute function public.operational_tasks_set_updated_at();

create table if not exists public.task_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  message_id uuid references public.task_messages (id) on delete cascade,
  delivery_id uuid references public.task_message_deliveries (id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_automation_jobs_type_check
    check (job_type in (
      'evaluate_followup',
      'send_message',
      'send_reminder',
      'request_status',
      'escalate',
      'process_inbound',
      'run_ai'
    )),
  constraint task_automation_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'dead_letter')),
  constraint task_automation_jobs_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint task_automation_jobs_idempotency_check
    check (btrim(idempotency_key) <> ''),
  constraint task_automation_jobs_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint task_automation_jobs_lock_check
    check (
      (status = 'processing' and locked_at is not null and nullif(btrim(coalesce(locked_by, '')), '') is not null)
      or status <> 'processing'
    ),
  constraint task_automation_jobs_org_idempotency_unique
    unique (org_id, idempotency_key)
);

create index if not exists task_automation_jobs_due_idx
  on public.task_automation_jobs (available_at, created_at)
  where status in ('queued', 'failed');

create index if not exists task_automation_jobs_task_status_idx
  on public.task_automation_jobs (task_id, status, available_at);

create index if not exists task_automation_jobs_processing_idx
  on public.task_automation_jobs (heartbeat_at, locked_at)
  where status = 'processing';

drop trigger if exists trg_task_automation_jobs_set_updated_at
  on public.task_automation_jobs;
create trigger trg_task_automation_jobs_set_updated_at
before update on public.task_automation_jobs
for each row execute function public.operational_tasks_set_updated_at();

comment on table public.task_automation_jobs is
  'Durable, idempotent outbox for reminders, fallback delivery, escalation and AI work. Workers must claim jobs atomically.';

-- ---------------------------------------------------------------------
-- Private evidence bucket (service-role upload + signed read URLs)
-- ---------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'task-evidence',
  'task-evidence',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/aac'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.task_attachments is
  'Metadata for evidence in the private task-evidence bucket. API handlers use service_role for upload and short-lived signed URLs for reads.';

-- No storage.objects policy is added intentionally: browser clients cannot
-- enumerate/upload files directly. The API validates task/link scope first.

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

-- Declared before policies so PostgreSQL can resolve policy expressions.
create or replace function public.has_operational_task_module_access(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select public.is_org_member(p_org_id) and exists (
    select 1
    from public.platform_access_assignments access_assignment
    join public.platform_products product
      on product.id = access_assignment.product_id
     and product.key = 'dashboard'
     and product.is_active = true
    join public.platform_modules module
      on module.id = access_assignment.module_id
     and module.product_id = product.id
     and module.key = 'tasks'
     and module.is_active = true
    where access_assignment.profile_id = auth.uid()
      and access_assignment.is_active = true
      and (
        access_assignment.expires_at is null
        or access_assignment.expires_at > now()
      )
      and (
        access_assignment.scope_type = 'global'
        or (
          access_assignment.scope_type = 'organization'
          and access_assignment.scope_id = p_org_id::text
        )
      )
  );
$$;

create or replace function public.can_work_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.operational_tasks task
    where task.id = p_task_id
      and public.has_operational_task_module_access(task.org_id)
      and (
        public.is_org_admin(task.org_id)
        or task.issuer_profile_id = auth.uid()
        or task.assignee_profile_id = auth.uid()
      )
  );
$$;

create or replace function public.can_manage_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.operational_tasks task
    where task.id = p_task_id
      and public.has_operational_task_module_access(task.org_id)
      and (
        public.is_org_admin(task.org_id)
        or task.issuer_profile_id = auth.uid()
      )
  );
$$;

create or replace function public.can_view_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with recursive
  target as (
    select task.id, task.org_id
    from public.operational_tasks task
    where task.id = p_task_id
  ),
  directly_involved as (
    select task.id, task.parent_task_id, task.org_id
    from public.operational_tasks task
    join target on target.org_id = task.org_id
    where task.issuer_profile_id = auth.uid()
       or task.assignee_profile_id = auth.uid()
  ),
  visible_ancestors as (
    select task.id, task.parent_task_id, task.org_id
    from directly_involved task
    union
    select parent.id, parent.parent_task_id, parent.org_id
    from public.operational_tasks parent
    join visible_ancestors child
      on parent.id = child.parent_task_id
  ),
  visible_descendants as (
    select task.id, task.org_id
    from directly_involved task
    union
    select child.id, child.org_id
    from public.operational_tasks child
    join visible_descendants parent
      on child.parent_task_id = parent.id
  )
  select exists (
    select 1
    from target
    where public.has_operational_task_module_access(target.org_id)
      and (
        public.is_org_admin(target.org_id)
        or exists (select 1 from visible_ancestors where visible_ancestors.id = target.id)
        or exists (select 1 from visible_descendants where visible_descendants.id = target.id)
      )
  );
$$;

alter table public.task_organization_settings enable row level security;
alter table public.organization_contacts enable row level security;
alter table public.operational_tasks enable row level security;
alter table public.task_access_links enable row level security;
alter table public.task_events enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_requirement_templates enable row level security;
alter table public.task_requirements enable row level security;
alter table public.task_deadline_change_requests enable row level security;
alter table public.task_followup_rules enable row level security;
alter table public.task_ai_runs enable row level security;
alter table public.task_ai_suggestions enable row level security;
alter table public.task_messages enable row level security;
alter table public.task_message_deliveries enable row level security;
alter table public.task_automation_jobs enable row level security;

grant select on table
  public.task_organization_settings,
  public.organization_contacts,
  public.operational_tasks,
  public.task_access_links,
  public.task_events,
  public.task_attachments,
  public.task_requirement_templates,
  public.task_requirements,
  public.task_deadline_change_requests,
  public.task_followup_rules,
  public.task_ai_runs,
  public.task_ai_suggestions,
  public.task_messages,
  public.task_message_deliveries,
  public.task_automation_jobs
to authenticated;

-- All operational writes below go through the server-only service role or an
-- audited SECURITY DEFINER RPC. Keeping the RLS policies is defense in depth
-- if a narrowly scoped grant is introduced later.
revoke insert, update, delete on table public.task_organization_settings from authenticated;
revoke insert, update, delete on table public.organization_contacts from authenticated;
revoke insert, update, delete on table public.task_access_links from authenticated;
revoke insert, update, delete on table public.task_events from authenticated;
revoke insert, update, delete on table public.task_attachments from authenticated;
revoke insert, update, delete on table public.task_requirements from authenticated;
revoke insert, update, delete on table public.task_deadline_change_requests from authenticated;
revoke insert, update, delete on table public.task_followup_rules from authenticated;
revoke insert, update, delete on table public.task_ai_runs from authenticated;
revoke insert, update, delete on table public.task_ai_suggestions from authenticated;
revoke insert, update, delete on table public.task_messages from authenticated;
revoke insert, update, delete on table public.task_message_deliveries from authenticated;
revoke insert, update, delete on table public.task_automation_jobs from authenticated;
revoke insert, update, delete on table public.task_requirement_templates from authenticated;

drop policy if exists task_organization_settings_select_member
  on public.task_organization_settings;
create policy task_organization_settings_select_member
  on public.task_organization_settings
  for select to authenticated
  using (public.has_operational_task_module_access(org_id));

drop policy if exists task_organization_settings_update_admin
  on public.task_organization_settings;
create policy task_organization_settings_update_admin
  on public.task_organization_settings
  for update to authenticated
  using (
    public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  )
  with check (
    public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  );

drop policy if exists organization_contacts_select_member
  on public.organization_contacts;
create policy organization_contacts_select_member
  on public.organization_contacts
  for select to authenticated
  using (public.has_operational_task_module_access(org_id));

drop policy if exists organization_contacts_insert_member
  on public.organization_contacts;
create policy organization_contacts_insert_member
  on public.organization_contacts
  for insert to authenticated
  with check (
    public.has_operational_task_module_access(org_id)
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists organization_contacts_update_member
  on public.organization_contacts;
create policy organization_contacts_update_member
  on public.organization_contacts
  for update to authenticated
  using (public.has_operational_task_module_access(org_id))
  with check (
    public.has_operational_task_module_access(org_id)
    and (updated_by is null or updated_by = auth.uid())
  );

drop policy if exists organization_contacts_delete_admin
  on public.organization_contacts;
create policy organization_contacts_delete_admin
  on public.organization_contacts
  for delete to authenticated
  using (
    public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  );

drop policy if exists operational_tasks_select_visible
  on public.operational_tasks;
create policy operational_tasks_select_visible
  on public.operational_tasks
  for select to authenticated
  using (public.can_view_operational_task(id));

drop policy if exists operational_tasks_insert_issuer
  on public.operational_tasks;

-- There is deliberately no authenticated INSERT/UPDATE/DELETE policy for
-- tasks. Creation, state, deadlines and review use audited RPCs.

drop policy if exists task_access_links_select_manager
  on public.task_access_links;
create policy task_access_links_select_manager
  on public.task_access_links
  for select to authenticated
  using (public.can_manage_operational_task(task_id));

drop policy if exists task_access_links_insert_manager
  on public.task_access_links;
create policy task_access_links_insert_manager
  on public.task_access_links
  for insert to authenticated
  with check (
    public.can_manage_operational_task(task_id)
    and created_by_profile_id = auth.uid()
  );

drop policy if exists task_access_links_update_manager
  on public.task_access_links;
create policy task_access_links_update_manager
  on public.task_access_links
  for update to authenticated
  using (public.can_manage_operational_task(task_id))
  with check (public.can_manage_operational_task(task_id));

drop policy if exists task_events_select_visible
  on public.task_events;
create policy task_events_select_visible
  on public.task_events
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_events_insert_actor
  on public.task_events;
create policy task_events_insert_actor
  on public.task_events
  for insert to authenticated
  with check (
    public.can_work_operational_task(task_id)
    and actor_type = 'profile'
    and actor_profile_id = auth.uid()
    and actor_contact_id is null
    and actor_access_link_id is null
  );

drop policy if exists task_attachments_select_visible
  on public.task_attachments;
create policy task_attachments_select_visible
  on public.task_attachments
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_attachments_insert_actor
  on public.task_attachments;
create policy task_attachments_insert_actor
  on public.task_attachments
  for insert to authenticated
  with check (
    public.can_work_operational_task(task_id)
    and uploaded_by_profile_id = auth.uid()
    and uploaded_by_contact_id is null
    and uploaded_by_access_link_id is null
  );

drop policy if exists task_requirement_templates_select_member
  on public.task_requirement_templates;
create policy task_requirement_templates_select_member
  on public.task_requirement_templates
  for select to authenticated
  using (org_id is null or public.has_operational_task_module_access(org_id));

drop policy if exists task_requirement_templates_insert_admin
  on public.task_requirement_templates;
create policy task_requirement_templates_insert_admin
  on public.task_requirement_templates
  for insert to authenticated
  with check (
    org_id is not null
    and public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  );

drop policy if exists task_requirement_templates_update_admin
  on public.task_requirement_templates;
create policy task_requirement_templates_update_admin
  on public.task_requirement_templates
  for update to authenticated
  using (
    org_id is not null
    and public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  )
  with check (
    org_id is not null
    and public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  );

drop policy if exists task_requirement_templates_delete_admin
  on public.task_requirement_templates;
create policy task_requirement_templates_delete_admin
  on public.task_requirement_templates
  for delete to authenticated
  using (
    org_id is not null
    and public.has_operational_task_module_access(org_id)
    and public.is_org_admin(org_id)
  );

drop policy if exists task_requirements_select_visible
  on public.task_requirements;
create policy task_requirements_select_visible
  on public.task_requirements
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_requirements_insert_worker
  on public.task_requirements;

drop policy if exists task_requirements_update_manager
  on public.task_requirements;

-- Requirement decisions are update-denied at table level. Issuer/admin use
-- decide_operational_task_requirement so evidence, version and audit are one
-- transaction.

drop policy if exists task_deadline_requests_select_visible
  on public.task_deadline_change_requests;
create policy task_deadline_requests_select_visible
  on public.task_deadline_change_requests
  for select to authenticated
  using (public.can_view_operational_task(task_id));

-- Direct writes are denied despite table grants; callers use the atomic RPCs.

drop policy if exists task_followup_rules_select_visible
  on public.task_followup_rules;
create policy task_followup_rules_select_visible
  on public.task_followup_rules
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_followup_rules_insert_manager
  on public.task_followup_rules;
create policy task_followup_rules_insert_manager
  on public.task_followup_rules
  for insert to authenticated
  with check (public.can_manage_operational_task(task_id));

drop policy if exists task_followup_rules_update_manager
  on public.task_followup_rules;
create policy task_followup_rules_update_manager
  on public.task_followup_rules
  for update to authenticated
  using (public.can_manage_operational_task(task_id))
  with check (public.can_manage_operational_task(task_id));

drop policy if exists task_ai_runs_select_visible
  on public.task_ai_runs;
create policy task_ai_runs_select_visible
  on public.task_ai_runs
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_ai_suggestions_select_visible
  on public.task_ai_suggestions;
create policy task_ai_suggestions_select_visible
  on public.task_ai_suggestions
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_messages_select_visible
  on public.task_messages;
create policy task_messages_select_visible
  on public.task_messages
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_messages_insert_actor
  on public.task_messages;
create policy task_messages_insert_actor
  on public.task_messages
  for insert to authenticated
  with check (
    public.can_work_operational_task(task_id)
    and actor_type = 'profile'
    and actor_profile_id = auth.uid()
    and actor_contact_id is null
    and actor_access_link_id is null
  );

drop policy if exists task_message_deliveries_select_visible
  on public.task_message_deliveries;
create policy task_message_deliveries_select_visible
  on public.task_message_deliveries
  for select to authenticated
  using (public.can_view_operational_task(task_id));

drop policy if exists task_automation_jobs_select_manager
  on public.task_automation_jobs;
create policy task_automation_jobs_select_manager
  on public.task_automation_jobs
  for select to authenticated
  using (public.can_manage_operational_task(task_id));

comment on table public.task_access_links is
  'Accountless access is resolved only by the server: SHA-256 hash lookup, expiry/revocation check and task/branch scope validation.';
comment on table public.task_events is
  'Append-only business audit. Authenticated users can read visible trees and append only their own profile-authored events.';
comment on table public.task_ai_runs is
  'Immutable-input audit envelope for Signe model calls. Provider execution belongs in a durable worker, never in a database trigger.';

-- ---------------------------------------------------------------------
-- Activity projection and durable follow-up scheduling
-- ---------------------------------------------------------------------

create or replace function public.touch_operational_task_from_event()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.event_type in ('task_created', 'status_changed')
    or new.metadata ->> 'taskMutationApplied' = 'true'
  then
    return new;
  end if;

  update public.operational_tasks task
  set last_activity_at = greatest(task.last_activity_at, new.created_at)
  where task.id = new.task_id
    and new.created_at > task.last_activity_at;
  return new;
end;
$$;

drop trigger if exists trg_touch_operational_task_from_event
  on public.task_events;
create trigger trg_touch_operational_task_from_event
after insert on public.task_events
for each row execute function public.touch_operational_task_from_event();

create or replace function public.reject_task_event_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'TASK_EVENTS_ARE_APPEND_ONLY';
end;
$$;

drop trigger if exists trg_reject_task_event_update
  on public.task_events;
create trigger trg_reject_task_event_update
before update on public.task_events
for each row execute function public.reject_task_event_update();

create or replace function public.sync_operational_task_followup_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  schedule_at timestamptz;
begin
  insert into public.task_followup_rules (org_id, task_id)
  values (new.org_id, new.id)
  on conflict (task_id) do nothing;

  update public.task_automation_jobs job
  set
    status = 'cancelled',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    error_message = 'Superseded by task version ' || new.version::text
  where job.task_id = new.id
    and job.job_type = 'evaluate_followup'
    and job.status in ('queued', 'failed');

  if new.status in ('approved', 'cancelled') then
    -- Runs in the same transaction as every task status write, including the
    -- transition RPC, so a closed task never retains an active external link.
    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.task_id = new.id
      and access_link.revoked_at is null;
  end if;

  if new.archived_at is not null
    or new.status in ('draft', 'approved', 'cancelled')
  then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'assigned' then
    -- The first evaluation sends the assignment notification on the next
    -- worker/cron pass; later task changes retain the normal reminder cadence.
    schedule_at := now();
  else
    schedule_at := greatest(
      now(),
      least(
        new.next_followup_at,
        new.due_at - interval '3 days'
      )
    );
  end if;

  insert into public.task_automation_jobs (
    org_id,
    task_id,
    job_type,
    status,
    available_at,
    idempotency_key,
    payload
  )
  values (
    new.org_id,
    new.id,
    'evaluate_followup',
    'queued',
    schedule_at,
    'task-followup:' || new.id::text || ':v' || new.version::text,
    jsonb_build_object(
      'taskVersion', new.version,
      'scheduledFrom', 'operational_tasks'
    )
  )
  on conflict (org_id, idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_operational_task_followup_job
  on public.operational_tasks;
create trigger trg_sync_operational_task_followup_job
after insert or update of status, due_at, next_followup_at, last_activity_at, archived_at
on public.operational_tasks
for each row execute function public.sync_operational_task_followup_job();

-- Workers call this in a short transaction. SKIP LOCKED allows several
-- workers without double-claiming a reminder or AI decision job.
create or replace function public.claim_task_automation_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_stale_after interval default interval '15 minutes'
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_WORKER_ID_REQUIRED';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'TASK_WORKER_LIMIT_INVALID';
  end if;

  if p_stale_after < interval '1 minute' or p_stale_after > interval '24 hours' then
    raise exception using
      errcode = '22023',
      message = 'TASK_WORKER_STALE_INTERVAL_INVALID';
  end if;

  -- A process can die after claiming its final allowed attempt. Finalize those
  -- stale rows before claiming new work so they never remain in processing.
  update public.task_automation_jobs job
  set
    status = 'dead_letter',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    error_message = coalesce(job.error_message, 'TASK_WORKER_STALE_AFTER_FINAL_ATTEMPT')
  where job.status = 'processing'
    and coalesce(job.heartbeat_at, job.locked_at) < now() - p_stale_after
    and job.attempt_count >= job.max_attempts;

  return query
  with candidates as (
    select job.id
    from public.task_automation_jobs job
    where (
      job.status in ('queued', 'failed')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
    ) or (
      job.status = 'processing'
      and coalesce(job.heartbeat_at, job.locked_at) < now() - p_stale_after
      and job.attempt_count < job.max_attempts
    )
    order by job.available_at, job.created_at, job.id
    for update skip locked
    limit p_limit
  )
  update public.task_automation_jobs job
  set
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    heartbeat_at = now(),
    attempt_count = job.attempt_count + 1,
    error_message = null
  from candidates
  where job.id = candidates.id
  returning to_jsonb(job);
end;
$$;

create or replace function public.finish_task_automation_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error_message text default null,
  p_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  update public.task_automation_jobs job
  set
    status = case
      when p_succeeded then 'completed'
      when job.attempt_count >= job.max_attempts then 'dead_letter'
      else 'failed'
    end,
    available_at = case
      when p_succeeded then job.available_at
      else coalesce(p_retry_at, now() + interval '15 minutes')
    end,
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    completed_at = case
      when p_succeeded or job.attempt_count >= job.max_attempts then now()
      else null
    end,
    error_message = case
      when p_succeeded then null
      else left(coalesce(p_error_message, 'Unknown task worker error'), 4000)
    end
  where job.id = p_job_id
    and job.status = 'processing'
    and job.locked_by = p_worker_id
  returning to_jsonb(job) into result;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_JOB_CLAIM_NOT_FOUND';
  end if;

  return result;
end;
$$;

revoke all on function public.claim_task_automation_jobs(text, integer, interval) from public, anon, authenticated;
revoke all on function public.finish_task_automation_job(uuid, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_task_automation_jobs(text, integer, interval) to service_role;
grant execute on function public.finish_task_automation_job(uuid, text, boolean, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- Authorization helpers and atomic workflow RPCs
-- ---------------------------------------------------------------------

create or replace function public.task_access_link_covers(
  p_access_link_id uuid,
  p_task_id uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.task_access_links access_link
    join public.operational_tasks target_task
      on target_task.id = p_task_id
     and target_task.org_id = access_link.org_id
     and target_task.root_task_id = access_link.root_task_id
    join public.organization_contacts contact
      on contact.id = access_link.contact_id
     and contact.org_id = access_link.org_id
     and contact.is_active = true
    where access_link.id = p_access_link_id
      and access_link.contact_id = p_contact_id
      and access_link.role in ('assignee', 'delegator')
      and access_link.revoked_at is null
      and access_link.expires_at > now()
      and (
        (access_link.scope = 'task' and access_link.task_id = p_task_id)
        or
        (access_link.scope = 'branch' and exists (
          with recursive ancestors as (
            select task.id, task.parent_task_id
            from public.operational_tasks task
            where task.id = p_task_id
            union all
            select parent.id, parent.parent_task_id
            from public.operational_tasks parent
            join ancestors child on parent.id = child.parent_task_id
          )
          select 1
          from ancestors
          where ancestors.id = access_link.task_id
        ))
      )
  );
$$;

-- Atomically reserves a transcription attempt and appends its audit event.
-- A transaction-scoped advisory lock serializes requests for the same actor,
-- so parallel API calls cannot all pass the count before any event is stored.
create or replace function public.register_operational_task_transcription_attempt(
  p_org_id uuid,
  p_task_id uuid,
  p_actor_profile_id uuid,
  p_actor_contact_id uuid,
  p_actor_access_link_id uuid,
  p_byte_size bigint
)
returns public.task_events
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  event_row public.task_events%rowtype;
  actor_type_value text;
  actor_name_value text;
  bucket_key text;
  max_attempts integer;
  current_attempts bigint;
  access_role text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'TASK_TRANSCRIPTION_ATTEMPT_FORBIDDEN';
  end if;

  if p_org_id is null
    or p_task_id is null
    or p_byte_size is null
    or p_byte_size < 0
    or not (
      (
        p_actor_profile_id is not null
        and p_actor_contact_id is null
        and p_actor_access_link_id is null
      )
      or
      (
        p_actor_profile_id is null
        and p_actor_contact_id is not null
        and p_actor_access_link_id is not null
      )
    )
  then
    raise exception using errcode = '22023', message = 'TASK_TRANSCRIPTION_ATTEMPT_INPUT_INVALID';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.org_id = p_org_id
    and task.archived_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  if task_row.status in ('ready_for_review', 'approved', 'cancelled') then
    raise exception using errcode = '23514', message = 'TASK_ATTACHMENT_LOCKED';
  end if;

  if p_actor_profile_id is not null then
    select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Intern anvandare')
    into actor_name_value
    from public.org_members member
    join public.profiles profile on profile.id = member.profile_id
    where member.org_id = p_org_id
      and member.profile_id = p_actor_profile_id
      and member.is_active = true
      and (
        member.role = 'admin'
        or task_row.issuer_profile_id = p_actor_profile_id
        or task_row.assignee_profile_id = p_actor_profile_id
      );

    if not found then
      raise exception using errcode = '42501', message = 'TASK_TRANSCRIPTION_ACTOR_FORBIDDEN';
    end if;

    actor_type_value := 'profile';
    bucket_key := 'operational-task-transcription:profile:' || p_actor_profile_id::text;
    max_attempts := 30;
  else
    select contact.name, access_link.role
    into actor_name_value, access_role
    from public.organization_contacts contact
    join public.task_access_links access_link
      on access_link.contact_id = contact.id
     and access_link.org_id = contact.org_id
    where contact.id = p_actor_contact_id
      and contact.org_id = p_org_id
      and contact.is_active = true
      and access_link.id = p_actor_access_link_id
      and access_link.role in ('assignee', 'delegator')
      and access_link.revoked_at is null
      and access_link.expires_at > now();

    if not found
      or not public.task_access_link_covers(
        p_actor_access_link_id,
        p_task_id,
        p_actor_contact_id
      )
      or (
        access_role = 'assignee'
        and task_row.assignee_contact_id is distinct from p_actor_contact_id
      )
    then
      raise exception using errcode = '42501', message = 'TASK_TRANSCRIPTION_ACTOR_FORBIDDEN';
    end if;

    actor_type_value := 'contact';
    bucket_key := 'operational-task-transcription:contact:' || p_actor_contact_id::text;
    max_attempts := 10;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(bucket_key, 0)
  );

  if actor_type_value = 'profile' then
    select count(*)
    into current_attempts
    from public.task_events event
    where event.event_type = 'transcription_requested'
      and event.actor_profile_id = p_actor_profile_id
      and event.created_at >= now() - interval '1 hour';
  else
    select count(*)
    into current_attempts
    from public.task_events event
    where event.event_type = 'transcription_requested'
      and event.actor_contact_id = p_actor_contact_id
      and event.created_at >= now() - interval '1 hour';
  end if;

  if current_attempts >= max_attempts then
    raise exception using errcode = 'P0001', message = 'TASK_RATE_LIMITED';
  end if;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_contact_id,
    actor_access_link_id,
    actor_name,
    message,
    metadata
  )
  values (
    p_org_id,
    p_task_id,
    'transcription_requested',
    actor_type_value,
    p_actor_profile_id,
    p_actor_contact_id,
    p_actor_access_link_id,
    actor_name_value,
    'Taltranskribering begärdes.',
    jsonb_build_object(
      'taskMutationApplied', true,
      'byteSize', p_byte_size
    )
  )
  returning * into event_row;

  return event_row;
end;
$$;

create or replace function public.rotate_operational_task_access_link(
  p_task_id uuid,
  p_contact_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by_profile_id uuid,
  p_role text default 'assignee',
  p_scope text default 'branch'
)
returns public.task_access_links
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  link_row public.task_access_links%rowtype;
  creator_name text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'TASK_ACCESS_ROTATION_FORBIDDEN';
  end if;

  select task.* into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  if p_role not in ('assignee', 'delegator', 'viewer')
    or p_scope not in ('task', 'branch')
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
  then
    raise exception using errcode = '22023', message = 'TASK_ACCESS_ROTATION_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.organization_contacts contact
    where contact.id = p_contact_id
      and contact.org_id = task_row.org_id
      and contact.is_active = true
  ) then
    raise exception using errcode = '23514', message = 'TASK_CONTACT_NOT_FOUND';
  end if;

  if p_role in ('assignee', 'delegator')
    and task_row.assignee_contact_id <> p_contact_id
  then
    raise exception using errcode = '23514', message = 'TASK_ACCESS_LINK_ASSIGNEE_INVALID';
  end if;

  if not exists (
    select 1
    from public.org_members member
    where member.org_id = task_row.org_id
      and member.profile_id = p_created_by_profile_id
      and member.is_active = true
      and (
        task_row.issuer_profile_id = p_created_by_profile_id
        or member.role = 'admin'
      )
  ) then
    raise exception using errcode = '42501', message = 'TASK_ACCESS_ROTATION_CREATOR_FORBIDDEN';
  end if;

  update public.task_access_links access_link
  set revoked_at = now()
  where access_link.task_id = task_row.id
    and access_link.contact_id = p_contact_id
    and access_link.revoked_at is null;

  insert into public.task_access_links (
    org_id,
    task_id,
    root_task_id,
    contact_id,
    role,
    scope,
    token_hash,
    expires_at,
    created_by_profile_id
  )
  values (
    task_row.org_id,
    task_row.id,
    task_row.root_task_id,
    p_contact_id,
    p_role,
    p_scope,
    p_token_hash,
    p_expires_at,
    p_created_by_profile_id
  )
  returning * into link_row;

  select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Uppdragsgivare')
  into creator_name
  from public.profiles profile
  where profile.id = p_created_by_profile_id;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_name,
    message,
    metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    'access_link_rotated',
    'profile',
    p_created_by_profile_id,
    coalesce(creator_name, 'Uppdragsgivare'),
    'Extern atkomstlank skapades eller roterades.',
    jsonb_build_object(
      'accessLinkId', link_row.id,
      'contactId', p_contact_id,
      'role', p_role,
      'scope', p_scope,
      'expiresAt', p_expires_at
    )
  );

  return link_row;
end;
$$;

drop function if exists public.create_operational_task(uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid);

create or replace function public.create_operational_task(
  p_org_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_next_followup_at timestamptz,
  p_primary_channel text,
  p_task_kind text,
  p_evidence_requirement text,
  p_assignee_profile_id uuid default null,
  p_assignee_contact_id uuid default null,
  p_parent_task_id uuid default null,
  p_expected_parent_version integer default null,
  p_description text default null,
  p_context_label text default null,
  p_fallback_channel text default null,
  p_requirements jsonb default '[]'::jsonb,
  p_actor_profile_id uuid default null,
  p_actor_contact_id uuid default null,
  p_actor_access_link_id uuid default null,
  p_source_ai_suggestion_id uuid default null
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller_profile_id uuid := auth.uid();
  effective_profile_id uuid;
  actor_type_value text;
  actor_name_value text;
  issuer_profile_id_value uuid;
  task_id_value uuid := gen_random_uuid();
  root_task_id_value uuid;
  depth_value integer := 0;
  parent_row public.operational_tasks%rowtype;
  result public.operational_tasks%rowtype;
  configured_max_depth integer;
  configured_max_open_children integer;
  configured_max_active_descendants integer;
  open_children integer;
  active_descendants integer;
  suggestion_row public.task_ai_suggestions%rowtype;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null
    or p_due_at is null
    or p_next_followup_at is null
    or p_next_followup_at > p_due_at
    or num_nonnulls(p_assignee_profile_id, p_assignee_contact_id) <> 1
  then
    raise exception using errcode = '22023', message = 'TASK_CREATE_INPUT_INVALID';
  end if;

  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception using errcode = '22023', message = 'TASK_REQUIREMENTS_INPUT_INVALID';
  end if;

  if jsonb_array_length(p_requirements) > 50
    or exists (
      select 1
      from jsonb_array_elements(p_requirements) as requirement(value)
      where jsonb_typeof(requirement.value) <> 'object'
        or nullif(btrim(coalesce(requirement.value ->> 'requirement_key', '')), '') is null
        or nullif(btrim(coalesce(requirement.value ->> 'label', '')), '') is null
        or coalesce(nullif(requirement.value ->> 'status', ''), 'pending') <> 'pending'
    ) then
    raise exception using errcode = '22023', message = 'TASK_REQUIREMENTS_INPUT_INVALID';
  end if;

  if caller_profile_id is not null then
    if p_actor_contact_id is not null
      or p_actor_access_link_id is not null
      or (p_actor_profile_id is not null and p_actor_profile_id <> caller_profile_id)
    then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_SPOOFING_FORBIDDEN';
    end if;
    effective_profile_id := caller_profile_id;
  elsif auth.role() = 'service_role' then
    if num_nonnulls(p_actor_profile_id, p_actor_contact_id) <> 1 then
      raise exception using errcode = '22023', message = 'TASK_CREATE_ACTOR_REQUIRED';
    end if;
    effective_profile_id := p_actor_profile_id;
  else
    raise exception using errcode = '42501', message = 'TASK_CREATE_FORBIDDEN';
  end if;

  if effective_profile_id is not null then
    if p_actor_access_link_id is not null then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_SPOOFING_FORBIDDEN';
    end if;

    if not exists (
      select 1
      from public.org_members member
      where member.org_id = p_org_id
        and member.profile_id = effective_profile_id
        and member.is_active = true
    ) then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_NOT_IN_ORG';
    end if;

    if caller_profile_id is not null
      and not public.has_operational_task_module_access(p_org_id)
    then
      raise exception using errcode = '42501', message = 'TASK_MODULE_ACCESS_REQUIRED';
    end if;

    actor_type_value := 'profile';
    select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Intern anvandare')
    into actor_name_value
    from public.profiles profile
    where profile.id = effective_profile_id;
  else
    actor_type_value := 'contact';
    select contact.name
    into actor_name_value
    from public.organization_contacts contact
    where contact.id = p_actor_contact_id
      and contact.org_id = p_org_id
      and contact.is_active = true;

    if not found or p_actor_access_link_id is null then
      raise exception using errcode = '42501', message = 'TASK_EXTERNAL_ACTOR_FORBIDDEN';
    end if;

    if p_assignee_profile_id is not null then
      raise exception using errcode = '42501', message = 'TASK_EXTERNAL_PROFILE_ASSIGNMENT_FORBIDDEN';
    end if;
  end if;

  select
    settings.max_subtask_depth,
    settings.max_open_children_per_task,
    settings.max_active_descendants
  into
    configured_max_depth,
    configured_max_open_children,
    configured_max_active_descendants
  from public.task_organization_settings settings
  where settings.org_id = p_org_id
  for share;

  configured_max_depth := coalesce(configured_max_depth, 2);
  configured_max_open_children := coalesce(configured_max_open_children, 5);
  configured_max_active_descendants := coalesce(configured_max_active_descendants, 15);

  if p_parent_task_id is null then
    if p_actor_contact_id is not null then
      raise exception using errcode = '42501', message = 'TASK_EXTERNAL_ROOT_FORBIDDEN';
    end if;

    if p_expected_parent_version is not null then
      raise exception using errcode = '22023', message = 'TASK_PARENT_VERSION_NOT_ALLOWED';
    end if;

    if p_source_ai_suggestion_id is not null then
      raise exception using errcode = '22023', message = 'TASK_AI_SUGGESTION_PARENT_REQUIRED';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 2));
    root_task_id_value := task_id_value;
    issuer_profile_id_value := effective_profile_id;
  else
    if p_expected_parent_version is null or p_expected_parent_version <= 0 then
      raise exception using errcode = '22023', message = 'TASK_PARENT_VERSION_REQUIRED';
    end if;

    select task.*
    into parent_row
    from public.operational_tasks task
    where task.id = p_parent_task_id
      and task.org_id = p_org_id
      and task.archived_at is null
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'TASK_PARENT_NOT_FOUND';
    end if;

    if parent_row.version <> p_expected_parent_version then
      raise exception using errcode = '40001', message = 'TASK_PARENT_VERSION_CONFLICT';
    end if;

    if parent_row.status in ('approved', 'cancelled') then
      raise exception using errcode = '23514', message = 'TASK_PARENT_CLOSED';
    end if;

    if p_due_at > parent_row.due_at then
      raise exception using errcode = '23514', message = 'TASK_CHILD_AFTER_PARENT_DUE';
    end if;

    if effective_profile_id is not null then
      if parent_row.issuer_profile_id <> effective_profile_id
        and parent_row.assignee_profile_id <> effective_profile_id
        and not exists (
          select 1
          from public.org_members member
          where member.org_id = p_org_id
            and member.profile_id = effective_profile_id
            and member.is_active = true
            and member.role = 'admin'
        )
      then
        raise exception using errcode = '42501', message = 'TASK_SUBTASK_CREATE_FORBIDDEN';
      end if;
      issuer_profile_id_value := effective_profile_id;
    else
      if not public.task_access_link_covers(
        p_actor_access_link_id,
        parent_row.id,
        p_actor_contact_id
      ) or not exists (
        select 1
        from public.task_access_links access_link
        where access_link.id = p_actor_access_link_id
          and access_link.contact_id = p_actor_contact_id
          and access_link.role = 'delegator'
          and access_link.scope = 'branch'
          and access_link.revoked_at is null
          and access_link.expires_at > now()
      ) then
        raise exception using errcode = '42501', message = 'TASK_EXTERNAL_DELEGATION_FORBIDDEN';
      end if;
      issuer_profile_id_value := parent_row.issuer_profile_id;
    end if;

    root_task_id_value := parent_row.root_task_id;
    depth_value := parent_row.depth + 1;

    if p_source_ai_suggestion_id is not null then
      if effective_profile_id is null
        or (
          parent_row.issuer_profile_id <> effective_profile_id
          and not exists (
            select 1
            from public.org_members member
            where member.org_id = p_org_id
              and member.profile_id = effective_profile_id
              and member.is_active = true
              and member.role = 'admin'
          )
        )
      then
        raise exception using errcode = '42501', message = 'TASK_AI_SUGGESTION_ACCEPT_FORBIDDEN';
      end if;

      select suggestion.*
      into suggestion_row
      from public.task_ai_suggestions suggestion
      where suggestion.id = p_source_ai_suggestion_id
        and suggestion.org_id = p_org_id
        and suggestion.task_id = parent_row.id
        and suggestion.root_task_id = parent_row.root_task_id
        and suggestion.suggestion_type = 'create_subtask'
        and suggestion.status = 'pending'
      for update;

      if not found then
        raise exception using errcode = 'P0002', message = 'TASK_AI_SUGGESTION_NOT_PENDING';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(root_task_id_value::text, 0));

    if depth_value > configured_max_depth then
      raise exception using errcode = '23514', message = 'TASK_MAX_DEPTH_EXCEEDED';
    end if;

    select count(*) into open_children
    from public.operational_tasks child
    where child.parent_task_id = parent_row.id
      and child.archived_at is null
      and child.status not in ('approved', 'cancelled');

    if open_children >= configured_max_open_children then
      raise exception using errcode = '23514', message = 'TASK_MAX_OPEN_CHILDREN_EXCEEDED';
    end if;

    select count(*) into active_descendants
    from public.operational_tasks descendant
    where descendant.root_task_id = root_task_id_value
      and descendant.id <> descendant.root_task_id
      and descendant.archived_at is null
      and descendant.status not in ('approved', 'cancelled');

    if active_descendants >= configured_max_active_descendants then
      raise exception using errcode = '23514', message = 'TASK_MAX_ACTIVE_DESCENDANTS_EXCEEDED';
    end if;
  end if;

  insert into public.operational_tasks (
    id,
    org_id,
    parent_task_id,
    root_task_id,
    depth,
    issuer_profile_id,
    assignee_profile_id,
    assignee_contact_id,
    title,
    description,
    task_kind,
    status,
    due_at,
    next_followup_at,
    primary_channel,
    fallback_channel,
    context_label,
    evidence_requirement,
    created_source,
    source_ai_suggestion_id,
    created_by_profile_id
  )
  values (
    task_id_value,
    p_org_id,
    p_parent_task_id,
    root_task_id_value,
    depth_value,
    issuer_profile_id_value,
    p_assignee_profile_id,
    p_assignee_contact_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_task_kind,
    'assigned',
    p_due_at,
    p_next_followup_at,
    p_primary_channel,
    nullif(btrim(coalesce(p_fallback_channel, '')), ''),
    nullif(btrim(coalesce(p_context_label, '')), ''),
    p_evidence_requirement,
    case when p_source_ai_suggestion_id is null then 'manual' else 'ai_suggestion' end,
    p_source_ai_suggestion_id,
    effective_profile_id
  )
  returning * into result;

  if p_parent_task_id is not null then
    -- Treat a new child as a parent-tree mutation. This consumes the positive
    -- expected version so duplicate concurrent submissions cannot both pass.
    update public.operational_tasks parent_task
    set last_activity_at = now()
    where parent_task.id = p_parent_task_id
      and parent_task.version = p_expected_parent_version;

    if not found then
      raise exception using errcode = '40001', message = 'TASK_PARENT_VERSION_CONFLICT';
    end if;
  end if;

  insert into public.task_requirements (
    org_id,
    task_id,
    requirement_key,
    label,
    status,
    is_required,
    description,
    sort_order
  )
  select
    p_org_id,
    result.id,
    btrim(requirement.value ->> 'requirement_key'),
    btrim(requirement.value ->> 'label'),
    'pending',
    coalesce((requirement.value ->> 'is_required')::boolean, true),
    nullif(btrim(coalesce(requirement.value ->> 'description', '')), ''),
    coalesce(
      nullif(requirement.value ->> 'sort_order', '')::integer,
      (requirement.ordinality * 100)::integer
    )
  from jsonb_array_elements(p_requirements)
    with ordinality as requirement(value, ordinality);

  if p_source_ai_suggestion_id is not null then
    update public.task_ai_suggestions suggestion
    set
      status = 'accepted',
      reviewed_by_profile_id = effective_profile_id,
      reviewed_at = now(),
      review_note = 'Förslaget användes som underlag för en manuellt skapad underuppgift.',
      accepted_task_id = result.id
    where suggestion.id = p_source_ai_suggestion_id
      and suggestion.status = 'pending';

    if not found then
      raise exception using errcode = '40001', message = 'TASK_AI_SUGGESTION_NOT_PENDING';
    end if;
  end if;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_contact_id,
    actor_access_link_id,
    actor_name,
    message,
    to_status,
    metadata
  )
  values (
    p_org_id,
    result.id,
    'task_created',
    actor_type_value,
    effective_profile_id,
    p_actor_contact_id,
    p_actor_access_link_id,
    coalesce(actor_name_value, 'Uppdragsgivare'),
    case
      when p_parent_task_id is null then 'Uppgiften skapades och tilldelades.'
      else 'Underuppgiften skapades och tilldelades.'
    end,
    'assigned',
    jsonb_build_object(
      'parentTaskId', p_parent_task_id,
      'rootTaskId', result.root_task_id,
      'depth', result.depth,
      'sourceAiSuggestionId', p_source_ai_suggestion_id
    )
  );

  select task.* into result
  from public.operational_tasks task
  where task.id = task_id_value;

  return result;
end;
$$;

create or replace function public.transition_operational_task(
  p_task_id uuid,
  p_to_status text,
  p_message text default null,
  p_next_followup_at timestamptz default null,
  p_expected_version integer default null,
  p_actor_profile_id uuid default null,
  p_actor_contact_id uuid default null,
  p_actor_access_link_id uuid default null
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  result public.operational_tasks%rowtype;
  caller_profile_id uuid := auth.uid();
  effective_profile_id uuid;
  actor_type_value text;
  actor_name_value text;
  actor_is_admin boolean := false;
  actor_is_issuer boolean := false;
  actor_is_assignee boolean := false;
  transition_allowed boolean := false;
  required_attachment_type text;
begin
  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  if p_expected_version is null or p_expected_version <= 0 then
    raise exception using errcode = '22023', message = 'TASK_VERSION_REQUIRED';
  end if;

  if task_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'TASK_VERSION_CONFLICT';
  end if;

  if caller_profile_id is not null then
    if p_actor_contact_id is not null
      or (p_actor_profile_id is not null and p_actor_profile_id <> caller_profile_id)
    then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_SPOOFING_FORBIDDEN';
    end if;
    effective_profile_id := caller_profile_id;
  elsif auth.role() = 'service_role' then
    effective_profile_id := p_actor_profile_id;
  else
    raise exception using errcode = '42501', message = 'TASK_TRANSITION_FORBIDDEN';
  end if;

  if effective_profile_id is not null then
    if caller_profile_id is not null
      and not public.has_operational_task_module_access(task_row.org_id)
    then
      raise exception using errcode = '42501', message = 'TASK_MODULE_ACCESS_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.org_members member
      where member.org_id = task_row.org_id
        and member.profile_id = effective_profile_id
        and member.is_active = true
    ) then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_NOT_IN_ORG';
    end if;

    actor_type_value := 'profile';
    actor_is_admin := exists (
      select 1
      from public.org_members member
      where member.org_id = task_row.org_id
        and member.profile_id = effective_profile_id
        and member.is_active = true
        and member.role = 'admin'
    );
    actor_is_issuer := task_row.issuer_profile_id = effective_profile_id;
    actor_is_assignee := task_row.assignee_profile_id = effective_profile_id;
    select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Intern anvandare')
    into actor_name_value
    from public.profiles profile
    where profile.id = effective_profile_id;
  elsif p_actor_contact_id is not null then
    if task_row.assignee_contact_id <> p_actor_contact_id
      or not public.task_access_link_covers(
        p_actor_access_link_id,
        task_row.id,
        p_actor_contact_id
      )
    then
      raise exception using errcode = '42501', message = 'TASK_EXTERNAL_ACTOR_FORBIDDEN';
    end if;

    actor_type_value := 'contact';
    actor_is_assignee := true;
    select contact.name
    into actor_name_value
    from public.organization_contacts contact
    where contact.id = p_actor_contact_id;
  else
    -- A service worker may execute a constrained Signe/system transition.
    actor_type_value := 'system';
    actor_name_value := 'Signe';
    actor_is_assignee := true;
  end if;

  transition_allowed := case task_row.status
    when 'draft' then p_to_status in ('assigned', 'cancelled')
    when 'assigned' then p_to_status in ('in_progress', 'waiting', 'ready_for_review', 'cancelled')
    when 'in_progress' then p_to_status in ('waiting', 'ready_for_review', 'cancelled')
    when 'waiting' then p_to_status in ('in_progress', 'ready_for_review', 'cancelled')
    when 'ready_for_review' then p_to_status in ('approved', 'returned')
    when 'returned' then p_to_status in ('in_progress', 'waiting', 'ready_for_review', 'cancelled')
    else false
  end;

  if not transition_allowed then
    raise exception using errcode = '23514', message = 'TASK_TRANSITION_INVALID';
  end if;

  if p_to_status in ('approved', 'returned', 'cancelled')
    or (task_row.status = 'draft' and p_to_status = 'assigned')
  then
    if not (actor_is_issuer or actor_is_admin) then
      raise exception using errcode = '42501', message = 'TASK_REVIEW_ACTION_FORBIDDEN';
    end if;
  elsif not (actor_is_assignee or actor_is_admin) then
    raise exception using errcode = '42501', message = 'TASK_ASSIGNEE_ACTION_FORBIDDEN';
  end if;

  if p_to_status = 'in_progress' and exists (
    select 1
    from public.task_requirements requirement
    where requirement.task_id = task_row.id
      and requirement.is_required = true
      and requirement.requirement_key in (
        'written_quote',
        'written_client_approval',
        'warranty_basis'
      )
      and requirement.status not in ('verified', 'not_required', 'waived')
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_PRESTART_REQUIREMENTS_INCOMPLETE';
  end if;

  if p_to_status in ('waiting', 'returned', 'cancelled')
    and nullif(btrim(coalesce(p_message, '')), '') is null
  then
    raise exception using errcode = '22023', message = 'TASK_TRANSITION_MESSAGE_REQUIRED';
  end if;

  if p_to_status = 'waiting' then
    if p_next_followup_at is null or p_next_followup_at > task_row.due_at then
      raise exception using errcode = '22023', message = 'TASK_FOLLOWUP_INVALID';
    end if;
  end if;

  if p_to_status in ('ready_for_review', 'approved', 'cancelled') and exists (
    select 1
    from public.operational_tasks child
    where child.parent_task_id = task_row.id
      and child.archived_at is null
      and child.status not in ('approved', 'cancelled')
  ) then
    raise exception using errcode = '23514', message = 'TASK_CHILDREN_INCOMPLETE';
  end if;

  if p_to_status in ('ready_for_review', 'approved') then
    required_attachment_type := case task_row.evidence_requirement
      when 'text' then 'text'
      when 'photo' then 'photo'
      when 'document' then 'document'
      else null
    end;

    if exists (
      select 1
      from public.task_requirements requirement
      where requirement.task_id = task_row.id
        and requirement.is_required = true
        and not (
          requirement.status in ('verified', 'not_required', 'waived')
          or (
            p_to_status = 'ready_for_review'
            and requirement.requirement_key = 'completion_evidence'
            and requirement.status = 'evidence_detected'
            and requirement.evidence_attachment_id is not null
            and exists (
              select 1
              from public.task_attachments evidence
              where evidence.id = requirement.evidence_attachment_id
                and evidence.task_id = task_row.id
                and evidence.is_completion_evidence = true
                and (
                  required_attachment_type is null
                  or evidence.attachment_type = required_attachment_type
                  or (
                    required_attachment_type = 'text'
                    and evidence.attachment_type = 'audio'
                    and nullif(btrim(coalesce(evidence.transcript_text, '')), '') is not null
                  )
                )
            )
          )
        )
    ) then
      raise exception using errcode = '23514', message = 'TASK_REQUIREMENTS_INCOMPLETE';
    end if;

    if task_row.evidence_requirement <> 'optional' and not exists (
      select 1
      from public.task_attachments attachment
      where attachment.task_id = task_row.id
        and attachment.is_completion_evidence = true
        and (
          required_attachment_type is null
          or attachment.attachment_type = required_attachment_type
          or (
            required_attachment_type = 'text'
            and attachment.attachment_type = 'audio'
            and nullif(btrim(coalesce(attachment.transcript_text, '')), '') is not null
          )
        )
    ) then
      raise exception using errcode = '23514', message = 'TASK_COMPLETION_EVIDENCE_REQUIRED';
    end if;
  end if;

  update public.operational_tasks task
  set
    status = p_to_status,
    next_followup_at = case
      when p_to_status = 'waiting' then p_next_followup_at
      when p_to_status in ('returned', 'ready_for_review') then now()
      else task.next_followup_at
    end,
    review_round = case
      when p_to_status = 'returned' then task.review_round + 1
      else task.review_round
    end,
    submitted_for_review_at = case
      when p_to_status = 'ready_for_review' then now()
      when p_to_status = 'returned' then null
      else task.submitted_for_review_at
    end,
    approved_at = case
      when p_to_status = 'approved' then now()
      when p_to_status in ('returned', 'ready_for_review') then null
      else task.approved_at
    end,
    approved_by_profile_id = case
      when p_to_status = 'approved' then effective_profile_id
      when p_to_status in ('returned', 'ready_for_review') then null
      else task.approved_by_profile_id
    end,
    last_activity_at = now()
  where task.id = task_row.id;

  if p_to_status in ('approved', 'cancelled') then
    update public.task_deadline_change_requests request
    set status = 'cancelled'
    where request.task_id = task_row.id
      and request.status = 'pending';
  end if;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_contact_id,
    actor_access_link_id,
    actor_name,
    message,
    from_status,
    to_status
  )
  values (
    task_row.org_id,
    task_row.id,
    'status_changed',
    actor_type_value,
    effective_profile_id,
    p_actor_contact_id,
    p_actor_access_link_id,
    coalesce(actor_name_value, 'Signe'),
    nullif(btrim(coalesce(p_message, '')), ''),
    task_row.status,
    p_to_status
  );

  select task.* into result
  from public.operational_tasks task
  where task.id = task_row.id;

  return result;
end;
$$;

create or replace function public.decide_operational_task_requirement(
  p_requirement_id uuid,
  p_status text,
  p_evidence_attachment_id uuid,
  p_reason text,
  p_expected_task_version integer,
  p_actor_profile_id uuid default null
)
returns public.task_requirements
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  requirement_task_id uuid;
  requirement_row public.task_requirements%rowtype;
  task_row public.operational_tasks%rowtype;
  caller_profile_id uuid := auth.uid();
  effective_profile_id uuid;
  actor_name_value text;
  evidence_id_value uuid;
  expected_attachment_type text;
  evidence_is_mandatory boolean;
begin
  if p_status not in ('pending', 'verified', 'not_required', 'waived')
    or p_expected_task_version is null
    or p_expected_task_version <= 0
  then
    raise exception using errcode = '22023', message = 'TASK_REQUIREMENT_DECISION_INVALID';
  end if;

  select requirement.task_id
  into requirement_task_id
  from public.task_requirements requirement
  where requirement.id = p_requirement_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_REQUIREMENT_NOT_FOUND';
  end if;

  select task.* into task_row
  from public.operational_tasks task
  where task.id = requirement_task_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  select requirement.* into requirement_row
  from public.task_requirements requirement
  where requirement.id = p_requirement_id
    and requirement.task_id = task_row.id
    and requirement.org_id = task_row.org_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_REQUIREMENT_NOT_FOUND';
  end if;

  if task_row.version <> p_expected_task_version then
    raise exception using errcode = '40001', message = 'TASK_VERSION_CONFLICT';
  end if;

  if task_row.status in ('approved', 'cancelled')
    or (task_row.status = 'ready_for_review' and p_status = 'pending')
  then
    raise exception using errcode = '23514', message = 'TASK_REQUIREMENT_DECISION_LOCKED';
  end if;

  if caller_profile_id is not null then
    if p_actor_profile_id is not null and p_actor_profile_id <> caller_profile_id then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_SPOOFING_FORBIDDEN';
    end if;
    effective_profile_id := caller_profile_id;
  elsif auth.role() = 'service_role' then
    effective_profile_id := p_actor_profile_id;
  else
    raise exception using errcode = '42501', message = 'TASK_REQUIREMENT_DECISION_FORBIDDEN';
  end if;

  if effective_profile_id is null or not exists (
    select 1
    from public.org_members member
    where member.org_id = task_row.org_id
      and member.profile_id = effective_profile_id
      and member.is_active = true
      and (
        task_row.issuer_profile_id = effective_profile_id
        or member.role = 'admin'
      )
  ) then
    raise exception using errcode = '42501', message = 'TASK_REQUIREMENT_DECISION_FORBIDDEN';
  end if;

  if caller_profile_id is not null
    and not public.has_operational_task_module_access(task_row.org_id)
  then
    raise exception using errcode = '42501', message = 'TASK_MODULE_ACCESS_REQUIRED';
  end if;

  if p_status in ('waived', 'not_required')
    and nullif(btrim(coalesce(p_reason, '')), '') is null
  then
    raise exception using errcode = '22023', message = 'TASK_REQUIREMENT_REASON_REQUIRED';
  end if;

  evidence_is_mandatory := requirement_row.requirement_key in (
    'written_quote',
    'written_client_approval',
    'warranty_basis',
    'completion_evidence'
  );

  expected_attachment_type := case
    when requirement_row.requirement_key <> 'completion_evidence' then null
    when task_row.evidence_requirement = 'text' then 'text'
    when task_row.evidence_requirement = 'photo' then 'photo'
    when task_row.evidence_requirement = 'document' then 'document'
    else null
  end;

  if p_status = 'verified' then
    if p_evidence_attachment_id is not null then
      select attachment.id into evidence_id_value
      from public.task_attachments attachment
      where attachment.id = p_evidence_attachment_id
        and attachment.task_id = task_row.id
        and (
          not evidence_is_mandatory
          or (
            requirement_row.requirement_key = 'completion_evidence'
            and attachment.is_completion_evidence = true
            and (
              expected_attachment_type is null
              or attachment.attachment_type = expected_attachment_type
              or (
                expected_attachment_type = 'text'
                and attachment.attachment_type = 'audio'
                and nullif(btrim(coalesce(attachment.transcript_text, '')), '') is not null
              )
            )
          )
          or (
            requirement_row.requirement_key in (
              'written_quote',
              'written_client_approval',
              'warranty_basis'
            )
            and attachment.attachment_type in ('document', 'photo', 'text')
          )
        );
    elsif evidence_is_mandatory then
      select attachment.id into evidence_id_value
      from public.task_attachments attachment
      where attachment.task_id = task_row.id
        and (
          not evidence_is_mandatory
          or (
            requirement_row.requirement_key = 'completion_evidence'
            and attachment.is_completion_evidence = true
            and (
              expected_attachment_type is null
              or attachment.attachment_type = expected_attachment_type
              or (
                expected_attachment_type = 'text'
                and attachment.attachment_type = 'audio'
                and nullif(btrim(coalesce(attachment.transcript_text, '')), '') is not null
              )
            )
          )
          or (
            requirement_row.requirement_key in (
              'written_quote',
              'written_client_approval',
              'warranty_basis'
            )
            and attachment.attachment_type in ('document', 'photo', 'text')
          )
        )
      order by attachment.created_at desc, attachment.id desc
      limit 1;
    end if;

    if p_evidence_attachment_id is not null and evidence_id_value is null then
      raise exception using errcode = '23514', message = 'TASK_REQUIREMENT_EVIDENCE_INVALID';
    end if;

    if evidence_is_mandatory and evidence_id_value is null then
      raise exception using errcode = '23514', message = 'TASK_REQUIREMENT_EVIDENCE_REQUIRED';
    end if;
  elsif p_evidence_attachment_id is not null then
    raise exception using errcode = '22023', message = 'TASK_REQUIREMENT_EVIDENCE_NOT_ALLOWED';
  end if;

  update public.task_requirements requirement
  set
    status = p_status,
    evidence_attachment_id = case
      when p_status = 'verified' then evidence_id_value
      else null
    end,
    verified_by_profile_id = case
      when p_status in ('verified', 'not_required', 'waived') then effective_profile_id
      else null
    end,
    verified_at = case
      when p_status in ('verified', 'not_required', 'waived') then now()
      else null
    end
  where requirement.id = requirement_row.id
  returning * into requirement_row;

  update public.operational_tasks task
  set
    submitted_for_review_at = case
      when task.status = 'ready_for_review' then task.submitted_for_review_at
      else null
    end,
    approved_at = null,
    approved_by_profile_id = null,
    last_activity_at = now()
  where task.id = task_row.id;

  select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Uppdragsgivare')
  into actor_name_value
  from public.profiles profile
  where profile.id = effective_profile_id;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_name,
    message,
    metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    'requirement_updated',
    'profile',
    effective_profile_id,
    coalesce(actor_name_value, 'Uppdragsgivare'),
    coalesce(
      nullif(btrim(coalesce(p_reason, '')), ''),
      requirement_row.label || ': ' || p_status
    ),
    jsonb_build_object(
      'requirementId', requirement_row.id,
      'requirementKey', requirement_row.requirement_key,
      'status', p_status,
      'evidenceAttachmentId', evidence_id_value,
      'taskMutationApplied', true
    )
  );

  return requirement_row;
end;
$$;

create or replace function public.request_operational_task_deadline_change(
  p_task_id uuid,
  p_requested_due_at timestamptz,
  p_reason text,
  p_actor_profile_id uuid default null,
  p_actor_contact_id uuid default null,
  p_actor_access_link_id uuid default null
)
returns public.task_deadline_change_requests
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  request_row public.task_deadline_change_requests%rowtype;
  caller_profile_id uuid := auth.uid();
  effective_profile_id uuid;
  actor_type_value text;
  actor_name_value text;
  actor_is_admin boolean := false;
begin
  select task.* into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or p_requested_due_at <= task_row.due_at
  then
    raise exception using errcode = '22023', message = 'TASK_DEADLINE_REQUEST_INVALID';
  end if;

  if caller_profile_id is not null then
    if p_actor_contact_id is not null
      or (p_actor_profile_id is not null and p_actor_profile_id <> caller_profile_id)
    then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_SPOOFING_FORBIDDEN';
    end if;
    effective_profile_id := caller_profile_id;
  elsif auth.role() = 'service_role' then
    effective_profile_id := p_actor_profile_id;
  else
    raise exception using errcode = '42501', message = 'TASK_DEADLINE_REQUEST_FORBIDDEN';
  end if;

  if effective_profile_id is not null then
    if caller_profile_id is not null
      and not public.has_operational_task_module_access(task_row.org_id)
    then
      raise exception using errcode = '42501', message = 'TASK_MODULE_ACCESS_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.org_members member
      where member.org_id = task_row.org_id
        and member.profile_id = effective_profile_id
        and member.is_active = true
    ) then
      raise exception using errcode = '42501', message = 'TASK_ACTOR_NOT_IN_ORG';
    end if;

    select
      coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Intern anvandare'),
      exists (
        select 1
        from public.org_members member
        where member.org_id = task_row.org_id
          and member.profile_id = effective_profile_id
          and member.is_active = true
          and member.role = 'admin'
      )
    into actor_name_value, actor_is_admin
    from public.profiles profile
    where profile.id = effective_profile_id;

    if task_row.assignee_profile_id <> effective_profile_id and not actor_is_admin then
      raise exception using errcode = '42501', message = 'TASK_DEADLINE_REQUEST_FORBIDDEN';
    end if;
    actor_type_value := 'profile';
  elsif p_actor_contact_id is not null then
    if task_row.assignee_contact_id <> p_actor_contact_id
      or not public.task_access_link_covers(p_actor_access_link_id, task_row.id, p_actor_contact_id)
    then
      raise exception using errcode = '42501', message = 'TASK_DEADLINE_REQUEST_FORBIDDEN';
    end if;
    actor_type_value := 'contact';
    select contact.name into actor_name_value
    from public.organization_contacts contact
    where contact.id = p_actor_contact_id;
  else
    raise exception using errcode = '42501', message = 'TASK_DEADLINE_REQUEST_FORBIDDEN';
  end if;

  insert into public.task_deadline_change_requests (
    org_id,
    task_id,
    requested_by_profile_id,
    requested_by_contact_id,
    requested_by_access_link_id,
    current_due_at,
    requested_due_at,
    reason
  )
  values (
    task_row.org_id,
    task_row.id,
    effective_profile_id,
    p_actor_contact_id,
    p_actor_access_link_id,
    task_row.due_at,
    p_requested_due_at,
    btrim(p_reason)
  )
  returning * into request_row;

  -- A deadline request moves the operational ball to the issuer immediately.
  -- Updating the task also refreshes the durable follow-up job in this same
  -- transaction so the request cannot remain hidden until the old cadence.
  update public.operational_tasks task
  set
    next_followup_at = now(),
    last_activity_at = now()
  where task.id = task_row.id;

  insert into public.task_events (
    org_id, task_id, event_type, actor_type,
    actor_profile_id, actor_contact_id, actor_access_link_id,
    actor_name, message, metadata
  )
  values (
    task_row.org_id, task_row.id, 'deadline_change_requested', actor_type_value,
    effective_profile_id, p_actor_contact_id, p_actor_access_link_id,
    coalesce(actor_name_value, 'Mottagare'), btrim(p_reason),
    jsonb_build_object(
      'currentDueAt', task_row.due_at,
      'requestedDueAt', p_requested_due_at,
      'requestId', request_row.id,
      'taskMutationApplied', true
    )
  );

  return request_row;
end;
$$;

create or replace function public.decide_operational_task_deadline_change(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null,
  p_expected_task_version integer default null,
  p_actor_profile_id uuid default null
)
returns public.task_deadline_change_requests
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  request_row public.task_deadline_change_requests%rowtype;
  task_row public.operational_tasks%rowtype;
  caller_profile_id uuid := auth.uid();
  effective_profile_id uuid;
  actor_name_value text;
  actor_is_admin boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'TASK_DEADLINE_DECISION_INVALID';
  end if;

  select request.* into request_row
  from public.task_deadline_change_requests request
  where request.id = p_request_id
  for update;

  if not found or request_row.status <> 'pending' then
    raise exception using errcode = 'P0002', message = 'TASK_DEADLINE_REQUEST_NOT_PENDING';
  end if;

  select task.* into task_row
  from public.operational_tasks task
  where task.id = request_row.task_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND';
  end if;

  if task_row.status in ('approved', 'cancelled') then
    raise exception using errcode = '23514', message = 'TASK_TERMINAL';
  end if;

  effective_profile_id := case
    when caller_profile_id is not null then caller_profile_id
    when auth.role() = 'service_role' then p_actor_profile_id
    else null
  end;

  if effective_profile_id is null
    or (caller_profile_id is not null
      and p_actor_profile_id is not null
      and p_actor_profile_id <> caller_profile_id)
  then
    raise exception using errcode = '42501', message = 'TASK_DEADLINE_DECISION_FORBIDDEN';
  end if;

  if caller_profile_id is not null
    and not public.has_operational_task_module_access(task_row.org_id)
  then
    raise exception using errcode = '42501', message = 'TASK_MODULE_ACCESS_REQUIRED';
  end if;

  actor_is_admin := exists (
    select 1
    from public.org_members member
    where member.org_id = task_row.org_id
      and member.profile_id = effective_profile_id
      and member.is_active = true
      and member.role = 'admin'
  );

  if task_row.issuer_profile_id <> effective_profile_id and not actor_is_admin then
    raise exception using errcode = '42501', message = 'TASK_DEADLINE_DECISION_FORBIDDEN';
  end if;

  if p_expected_task_version is null or p_expected_task_version <= 0 then
    raise exception using errcode = '22023', message = 'TASK_VERSION_REQUIRED';
  end if;

  if task_row.version <> p_expected_task_version then
    raise exception using errcode = '40001', message = 'TASK_VERSION_CONFLICT';
  end if;

  if p_decision = 'approved' and task_row.parent_task_id is not null and exists (
    select 1
    from public.operational_tasks parent
    where parent.id = task_row.parent_task_id
      and request_row.requested_due_at > parent.due_at
  ) then
    raise exception using errcode = '23514', message = 'TASK_CHILD_AFTER_PARENT_DUE';
  end if;

  update public.task_deadline_change_requests request
  set
    status = p_decision,
    decided_by_profile_id = effective_profile_id,
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where request.id = request_row.id
  returning * into request_row;

  if p_decision = 'approved' then
    update public.operational_tasks task
    set
      due_at = request_row.requested_due_at,
      last_activity_at = now()
    where task.id = task_row.id;
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Uppdragsgivare')
  into actor_name_value
  from public.profiles profile
  where profile.id = effective_profile_id;

  insert into public.task_events (
    org_id, task_id, event_type, actor_type, actor_profile_id,
    actor_name, message, metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    case
      when p_decision = 'approved' then 'deadline_change_approved'
      else 'deadline_change_rejected'
    end,
    'profile',
    effective_profile_id,
    coalesce(actor_name_value, 'Uppdragsgivare'),
    nullif(btrim(coalesce(p_decision_note, '')), ''),
    jsonb_build_object(
      'requestedDueAt', request_row.requested_due_at,
      'requestId', request_row.id
    )
  );

  return request_row;
end;
$$;

revoke all on function public.task_access_link_covers(uuid, uuid, uuid) from public, anon;
revoke all on function public.has_operational_task_module_access(uuid) from public, anon;
revoke all on function public.rotate_operational_task_access_link(uuid, uuid, text, timestamptz, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.create_operational_task(uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid)
  from public, anon;
revoke all on function public.can_work_operational_task(uuid) from public, anon;
revoke all on function public.can_manage_operational_task(uuid) from public, anon;
revoke all on function public.can_view_operational_task(uuid) from public, anon;
grant execute on function public.can_work_operational_task(uuid) to authenticated;
grant execute on function public.can_manage_operational_task(uuid) to authenticated;
grant execute on function public.can_view_operational_task(uuid) to authenticated;
grant execute on function public.has_operational_task_module_access(uuid) to authenticated;
grant execute on function public.task_access_link_covers(uuid, uuid, uuid) to service_role;
revoke all on function public.register_operational_task_transcription_attempt(uuid, uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.register_operational_task_transcription_attempt(uuid, uuid, uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.rotate_operational_task_access_link(uuid, uuid, text, timestamptz, uuid, text, text)
  to service_role;
grant execute on function public.create_operational_task(uuid, text, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

revoke all on function public.transition_operational_task(uuid, text, text, timestamptz, integer, uuid, uuid, uuid)
  from public, anon;
revoke all on function public.request_operational_task_deadline_change(uuid, timestamptz, text, uuid, uuid, uuid)
  from public, anon;
revoke all on function public.decide_operational_task_deadline_change(uuid, text, text, integer, uuid)
  from public, anon;
revoke all on function public.decide_operational_task_requirement(uuid, text, uuid, text, integer, uuid)
  from public, anon;
grant execute on function public.transition_operational_task(uuid, text, text, timestamptz, integer, uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.request_operational_task_deadline_change(uuid, timestamptz, text, uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.decide_operational_task_deadline_change(uuid, text, text, integer, uuid)
  to authenticated, service_role;
grant execute on function public.decide_operational_task_requirement(uuid, text, uuid, text, integer, uuid)
  to authenticated, service_role;

create or replace function public.guard_task_ai_suggestion_budget()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  source_task public.operational_tasks%rowtype;
  max_depth integer;
  max_children integer;
  max_pending integer;
  max_active_descendants integer;
  pending_for_parent integer;
  pending_for_root integer;
  active_descendants integer;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select task.*
  into source_task
  from public.operational_tasks task
  where task.id = new.task_id
    and task.org_id = new.org_id;

  if not found
    or source_task.root_task_id <> new.root_task_id
    or source_task.archived_at is not null
    or source_task.status in ('approved', 'cancelled')
  then
    raise exception using
      errcode = '23514',
      message = 'TASK_AI_SUGGESTION_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from public.task_ai_runs run
    where run.id = new.run_id
      and run.org_id = new.org_id
      and run.task_id = new.task_id
      and run.root_task_id = new.root_task_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_AI_SUGGESTION_RUN_SCOPE_INVALID';
  end if;

  select
    settings.max_subtask_depth,
    settings.max_ai_children_per_task,
    settings.max_pending_ai_suggestions_per_root,
    settings.max_active_descendants
  into max_depth, max_children, max_pending, max_active_descendants
  from public.task_organization_settings settings
  where settings.org_id = new.org_id;

  max_depth := coalesce(max_depth, 2);
  max_children := coalesce(max_children, 5);
  max_pending := coalesce(max_pending, 3);
  max_active_descendants := coalesce(max_active_descendants, 15);

  perform pg_advisory_xact_lock(hashtextextended(new.root_task_id::text, 1));

  select count(*)
  into pending_for_root
  from public.task_ai_suggestions suggestion
  where suggestion.root_task_id = new.root_task_id
    and suggestion.status = 'pending'
    and suggestion.id <> new.id;

  if pending_for_root >= max_pending then
    raise exception using
      errcode = '23514',
      message = 'TASK_AI_PENDING_BUDGET_EXCEEDED';
  end if;

  if new.suggestion_type = 'create_subtask' then
    if source_task.depth + 1 > max_depth then
      raise exception using
        errcode = '23514',
        message = 'TASK_AI_MAX_DEPTH_EXCEEDED';
    end if;

    select
      (
        select count(*)
        from public.operational_tasks child
        where child.parent_task_id = new.task_id
          and child.archived_at is null
          and child.status not in ('approved', 'cancelled')
      ) + (
        select count(*)
        from public.task_ai_suggestions suggestion
        where suggestion.task_id = new.task_id
          and suggestion.suggestion_type = 'create_subtask'
          and suggestion.status = 'pending'
          and suggestion.id <> new.id
      )
    into pending_for_parent
    ;

    if pending_for_parent >= max_children then
      raise exception using
        errcode = '23514',
        message = 'TASK_AI_CHILD_BUDGET_EXCEEDED';
    end if;

    select count(*)
    into active_descendants
    from public.operational_tasks task
    where task.root_task_id = new.root_task_id
      and task.id <> task.root_task_id
      and task.archived_at is null
      and task.status not in ('approved', 'cancelled');

    if active_descendants >= max_active_descendants then
      raise exception using
        errcode = '23514',
        message = 'TASK_AI_ACTIVE_DESCENDANT_BUDGET_EXCEEDED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_task_ai_suggestion_budget
  on public.task_ai_suggestions;
create trigger trg_guard_task_ai_suggestion_budget
before insert or update on public.task_ai_suggestions
for each row execute function public.guard_task_ai_suggestion_budget();

comment on table public.task_ai_suggestions is
  'Signe proposals awaiting human review. A create_subtask proposal does not itself create an operational_tasks row.';

-- ---------------------------------------------------------------------
-- Cross-table tenant and access-link integrity
-- ---------------------------------------------------------------------

-- UUID foreign keys alone do not guarantee that a child row and its task are
-- in the same organization. This shared trigger closes that tenant-boundary
-- gap, including when a privileged backend writes through service_role.
create or replace function public.validate_task_scoped_record()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  row_data jsonb := to_jsonb(new);
  old_data jsonb := '{}'::jsonb;
  scoped_task_id uuid;
  scoped_org_id uuid;
  scoped_root_task_id uuid;
  field_name text;
  reference_id uuid;
  link_row public.task_access_links%rowtype;
  matching_contact_id uuid;
begin
  if tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
  end if;

  scoped_task_id := nullif(row_data ->> 'task_id', '')::uuid;
  if scoped_task_id is null then
    raise exception using
      errcode = '23514',
      message = 'TASK_SCOPED_RECORD_TASK_REQUIRED';
  end if;

  select task.org_id, task.root_task_id
  into scoped_org_id, scoped_root_task_id
  from public.operational_tasks task
  where task.id = scoped_task_id;

  if not found or scoped_org_id <> new.org_id then
    raise exception using
      errcode = '23514',
      message = 'TASK_SCOPED_RECORD_ORG_MISMATCH';
  end if;

  if row_data ? 'root_task_id'
    and nullif(row_data ->> 'root_task_id', '')::uuid is distinct from scoped_root_task_id
  then
    raise exception using
      errcode = '23514',
      message = 'TASK_SCOPED_RECORD_ROOT_MISMATCH';
  end if;

  foreach field_name in array array[
    'contact_id',
    'actor_contact_id',
    'uploaded_by_contact_id',
    'requested_by_contact_id'
  ] loop
    reference_id := nullif(row_data ->> field_name, '')::uuid;
    if tg_op = 'UPDATE' and row_data ->> field_name is not distinct from old_data ->> field_name then
      continue;
    end if;
    if reference_id is not null and not exists (
      select 1
      from public.organization_contacts contact
      where contact.id = reference_id
        and contact.org_id = new.org_id
        and contact.is_active = true
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_CONTACT_MISMATCH';
    end if;
  end loop;

  foreach field_name in array array[
    'actor_profile_id',
    'uploaded_by_profile_id',
    'requested_by_profile_id',
    'decided_by_profile_id',
    'verified_by_profile_id',
    'reviewed_by_profile_id',
    'created_by_profile_id'
  ] loop
    reference_id := nullif(row_data ->> field_name, '')::uuid;
    if tg_op = 'UPDATE' and row_data ->> field_name is not distinct from old_data ->> field_name then
      continue;
    end if;
    if reference_id is not null and not exists (
      select 1
      from public.org_members member
      where member.org_id = new.org_id
        and member.profile_id = reference_id
        and member.is_active = true
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_PROFILE_MISMATCH';
    end if;
  end loop;

  foreach field_name in array array[
    'actor_access_link_id',
    'uploaded_by_access_link_id',
    'requested_by_access_link_id'
  ] loop
    reference_id := nullif(row_data ->> field_name, '')::uuid;
    if tg_op = 'UPDATE' and row_data ->> field_name is not distinct from old_data ->> field_name then
      continue;
    end if;
    if reference_id is null then
      continue;
    end if;

    select access_link.*
    into link_row
    from public.task_access_links access_link
    where access_link.id = reference_id;

    if not found or link_row.org_id <> new.org_id then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_ACCESS_LINK_MISMATCH';
    end if;

    if link_row.scope = 'task' and link_row.task_id <> scoped_task_id then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_ACCESS_LINK_SCOPE_INVALID';
    end if;

    if link_row.scope = 'branch' and not exists (
      with recursive ancestors as (
        select task.id, task.parent_task_id
        from public.operational_tasks task
        where task.id = scoped_task_id
          and task.root_task_id = link_row.root_task_id
        union all
        select parent.id, parent.parent_task_id
        from public.operational_tasks parent
        join ancestors child
          on parent.id = child.parent_task_id
      )
      select 1
      from ancestors
      where ancestors.id = link_row.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_ACCESS_LINK_SCOPE_INVALID';
    end if;

    matching_contact_id := case field_name
      when 'actor_access_link_id' then nullif(row_data ->> 'actor_contact_id', '')::uuid
      when 'uploaded_by_access_link_id' then nullif(row_data ->> 'uploaded_by_contact_id', '')::uuid
      when 'requested_by_access_link_id' then nullif(row_data ->> 'requested_by_contact_id', '')::uuid
      else null
    end;

    if matching_contact_id is not null and matching_contact_id <> link_row.contact_id then
      raise exception using
        errcode = '23514',
        message = 'TASK_SCOPED_RECORD_ACCESS_LINK_CONTACT_INVALID';
    end if;
  end loop;

  if tg_table_name = 'task_access_links' then
    if new.role in ('assignee', 'delegator') and not exists (
      select 1
      from public.operational_tasks task
      where task.id = new.task_id
        and task.assignee_contact_id = new.contact_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_ACCESS_LINK_ASSIGNEE_INVALID';
    end if;
  elsif tg_table_name = 'task_attachments' then
    if new.event_id is not null and not exists (
      select 1
      from public.task_events event
      where event.id = new.event_id
        and event.org_id = new.org_id
        and event.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_ATTACHMENT_EVENT_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'task_requirements' then
    if new.evidence_attachment_id is not null and not exists (
      select 1
      from public.task_attachments attachment
      where attachment.id = new.evidence_attachment_id
        and attachment.org_id = new.org_id
        and attachment.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_REQUIREMENT_EVIDENCE_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'task_messages' then
    if new.in_reply_to_message_id is not null and not exists (
      select 1
      from public.task_messages parent_message
      where parent_message.id = new.in_reply_to_message_id
        and parent_message.org_id = new.org_id
        and parent_message.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_MESSAGE_REPLY_SCOPE_INVALID';
    end if;

    if new.ai_run_id is not null and not exists (
      select 1
      from public.task_ai_runs run
      where run.id = new.ai_run_id
        and run.org_id = new.org_id
        and run.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_MESSAGE_AI_RUN_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'task_ai_suggestions' then
    if not exists (
      select 1
      from public.task_ai_runs run
      where run.id = new.run_id
        and run.org_id = new.org_id
        and run.task_id = new.task_id
        and run.root_task_id = new.root_task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_AI_SUGGESTION_RUN_SCOPE_INVALID';
    end if;

    if new.accepted_task_id is not null and not exists (
      select 1
      from public.operational_tasks accepted_task
      where accepted_task.id = new.accepted_task_id
        and accepted_task.org_id = new.org_id
        and accepted_task.root_task_id = new.root_task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_AI_SUGGESTION_ACCEPTED_TASK_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'task_message_deliveries' then
    if not exists (
      select 1
      from public.task_messages message
      where message.id = new.message_id
        and message.org_id = new.org_id
        and message.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_DELIVERY_MESSAGE_SCOPE_INVALID';
    end if;
  elsif tg_table_name = 'task_automation_jobs' then
    if new.message_id is not null and not exists (
      select 1
      from public.task_messages message
      where message.id = new.message_id
        and message.org_id = new.org_id
        and message.task_id = new.task_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_JOB_MESSAGE_SCOPE_INVALID';
    end if;

    if new.delivery_id is not null and not exists (
      select 1
      from public.task_message_deliveries delivery
      where delivery.id = new.delivery_id
        and delivery.org_id = new.org_id
        and delivery.task_id = new.task_id
        and (new.message_id is null or delivery.message_id = new.message_id)
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_JOB_DELIVERY_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'task_access_links',
    'task_events',
    'task_attachments',
    'task_requirements',
    'task_deadline_change_requests',
    'task_followup_rules',
    'task_ai_runs',
    'task_ai_suggestions',
    'task_messages',
    'task_message_deliveries',
    'task_automation_jobs'
  ] loop
    execute format(
      'drop trigger if exists trg_validate_task_scope on public.%I',
      table_name
    );
    execute format(
      'create trigger trg_validate_task_scope before insert or update on public.%I for each row execute function public.validate_task_scoped_record()',
      table_name
    );
  end loop;
end
$$;
