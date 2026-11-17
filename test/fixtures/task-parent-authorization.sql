-- Synthetic task-authorization fixture. Source-only table shapes copied from
-- 2026-08-20_01_operational_tasks_foundation.sql; no production records.
-- Unrelated business triggers are intentionally outside this focused RPC test.
create table public.organizations(id uuid primary key);
create table public.profiles(id uuid primary key,full_name text,email text);
create table public.org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
create table public.organization_contacts(id uuid primary key,org_id uuid,name text,is_active boolean);
create table public.task_access_links(id uuid primary key,org_id uuid,root_task_id uuid,contact_id uuid,task_id uuid,role text,scope text,revoked_at timestamptz,expires_at timestamptz);
create table public.task_attachments(id uuid primary key);
create table public.task_ai_runs(id uuid primary key);
create table public.platform_products(id uuid primary key,key text,is_active boolean);
create table public.platform_modules(id uuid primary key,product_id uuid,key text,is_active boolean);
create table public.platform_access_assignments(profile_id uuid,product_id uuid,module_id uuid,is_active boolean,expires_at timestamptz,scope_type text,scope_id text);

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
