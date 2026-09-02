-- RenoApp AI-assisted flow builder foundation
-- Date: 2026-09-02
-- Scope:
-- 1) Persist auditable AI runs without letting the model write flow configuration
-- 2) Store source-grounded, reviewable change sets before any apply operation
-- 3) Preserve immutable flow snapshots for optimistic apply and rollback
-- 4) Keep the foundation isolated from the existing RenoApp configuration tables

create extension if not exists pgcrypto;

-- Mirrors the access check used by the /admin/renoapp layout. Keeping the
-- authorization decision in one SECURITY DEFINER helper makes every policy
-- fail closed for regular authenticated RenoApp users.
create or replace function public.is_hushub_renoapp_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id::text = auth.uid()::text
      and coalesce(profile.is_admin, false) = true
  )
  or exists (
    select 1
    from public.platform_access_assignments assignment
    join public.platform_products product
      on product.id = assignment.product_id
     and product.key = 'hushub_admin'
    join public.platform_modules module
      on module.id = assignment.module_id
     and module.key = 'renoapp_admin'
    join public.platform_roles role
      on role.id = assignment.role_id
     and role.key in ('hushub_superadmin', 'product_admin')
    where assignment.profile_id::text = auth.uid()::text
      and assignment.is_active = true
      and (assignment.expires_at is null or assignment.expires_at > now())
      and assignment.scope_type = 'global'
      and assignment.scope_id is null
  );
$$;

revoke all on function public.is_hushub_renoapp_admin() from public;
grant execute on function public.is_hushub_renoapp_admin() to authenticated;

create table if not exists public.renoapp_flow_ai_runs (
  id uuid primary key default gen_random_uuid(),
  action_type_id uuid references public.renovation_action_types (id) on delete set null,
  target_action_key text,
  operation text not null default 'review',
  status text not null default 'queued',
  command text not null,
  model text not null,
  prompt_version text not null default 'renoapp_flow_ai_v1',
  schema_version integer not null default 1,
  input_snapshot jsonb not null default '{}'::jsonb,
  input_snapshot_hash text,
  source_policy jsonb not null default '{}'::jsonb,
  provider_response_id text,
  attempt_count integer not null default 0,
  input_tokens integer,
  output_tokens integer,
  requested_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_flow_ai_runs_operation_check
    check (operation in ('create', 'review', 'extend')),
  constraint renoapp_flow_ai_runs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint renoapp_flow_ai_runs_command_check
    check (char_length(btrim(command)) between 3 and 4000),
  constraint renoapp_flow_ai_runs_model_check
    check (btrim(model) <> ''),
  constraint renoapp_flow_ai_runs_prompt_version_check
    check (btrim(prompt_version) <> ''),
  constraint renoapp_flow_ai_runs_schema_version_check
    check (schema_version > 0),
  constraint renoapp_flow_ai_runs_target_action_key_check
    check (
      target_action_key is null
      or (
        target_action_key = lower(target_action_key)
        and target_action_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'
      )
    ),
  constraint renoapp_flow_ai_runs_existing_target_check
    check (operation = 'create' or action_type_id is not null),
  constraint renoapp_flow_ai_runs_input_snapshot_check
    check (jsonb_typeof(input_snapshot) = 'object'),
  constraint renoapp_flow_ai_runs_source_policy_check
    check (jsonb_typeof(source_policy) = 'object'),
  constraint renoapp_flow_ai_runs_input_hash_check
    check (input_snapshot_hash is null or input_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint renoapp_flow_ai_runs_attempt_count_check
    check (attempt_count >= 0),
  constraint renoapp_flow_ai_runs_input_tokens_check
    check (input_tokens is null or input_tokens >= 0),
  constraint renoapp_flow_ai_runs_output_tokens_check
    check (output_tokens is null or output_tokens >= 0),
  constraint renoapp_flow_ai_runs_started_at_check
    check (started_at is null or started_at >= created_at),
  constraint renoapp_flow_ai_runs_completed_at_check
    check (
      completed_at is null
      or (
        completed_at >= created_at
        and (started_at is null or completed_at >= started_at)
      )
    )
);

create index if not exists renoapp_flow_ai_runs_status_idx
  on public.renoapp_flow_ai_runs (status, created_at);

create index if not exists renoapp_flow_ai_runs_action_history_idx
  on public.renoapp_flow_ai_runs (action_type_id, created_at desc)
  where action_type_id is not null;

create index if not exists renoapp_flow_ai_runs_requester_idx
  on public.renoapp_flow_ai_runs (requested_by, created_at desc)
  where requested_by is not null;

create unique index if not exists renoapp_flow_ai_runs_active_action_idx
  on public.renoapp_flow_ai_runs (action_type_id)
  where action_type_id is not null
    and status in ('queued', 'processing');

drop trigger if exists trg_renoapp_flow_ai_runs_set_updated_at
  on public.renoapp_flow_ai_runs;
create trigger trg_renoapp_flow_ai_runs_set_updated_at
before update on public.renoapp_flow_ai_runs
for each row execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_flow_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.renoapp_flow_ai_runs (id) on delete cascade,
  source_key text not null,
  source_type text not null,
  title text not null,
  publisher text not null,
  source_url text not null,
  claim text not null,
  citation_label text,
  reference text,
  jurisdiction text not null default 'SE',
  published_at date,
  effective_from date,
  effective_to date,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint renoapp_flow_sources_key_check
    check (btrim(source_key) <> '' and char_length(source_key) <= 200),
  constraint renoapp_flow_sources_type_check
    check (
      source_type in (
        'law',
        'regulation',
        'authority_guidance',
        'standard',
        'industry_practice',
        'municipal',
        'organization_policy'
      )
    ),
  constraint renoapp_flow_sources_title_check
    check (btrim(title) <> ''),
  constraint renoapp_flow_sources_publisher_check
    check (btrim(publisher) <> ''),
  constraint renoapp_flow_sources_url_check
    check (source_url ~ '^https://[^[:space:]]+$'),
  constraint renoapp_flow_sources_claim_check
    check (btrim(claim) <> ''),
  constraint renoapp_flow_sources_jurisdiction_check
    check (btrim(jurisdiction) <> ''),
  constraint renoapp_flow_sources_effective_range_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint renoapp_flow_sources_content_hash_check
    check (content_hash is null or content_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint renoapp_flow_sources_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists renoapp_flow_sources_run_idx
  on public.renoapp_flow_sources (run_id, source_type, retrieved_at desc);

create unique index if not exists renoapp_flow_sources_run_key_idx
  on public.renoapp_flow_sources (run_id, source_key);

create index if not exists renoapp_flow_sources_url_idx
  on public.renoapp_flow_sources (lower(source_url));

-- Versions are immutable snapshots of the whole action flow. Only lifecycle
-- columns may change; this prevents rollback history from silently drifting.
create table if not exists public.renoapp_flow_versions (
  id uuid primary key default gen_random_uuid(),
  action_type_id uuid not null references public.renovation_action_types (id) on delete restrict,
  version_number integer not null,
  status text not null default 'published',
  snapshot jsonb not null,
  snapshot_hash text not null,
  previous_version_id uuid references public.renoapp_flow_versions (id) on delete restrict,
  rollback_of_version_id uuid references public.renoapp_flow_versions (id) on delete restrict,
  source_change_set_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint renoapp_flow_versions_version_number_check
    check (version_number > 0),
  constraint renoapp_flow_versions_status_check
    check (status in ('published', 'superseded')),
  constraint renoapp_flow_versions_snapshot_check
    check (jsonb_typeof(snapshot) = 'object'),
  constraint renoapp_flow_versions_snapshot_hash_check
    check (snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint renoapp_flow_versions_self_reference_check
    check (
      (previous_version_id is null or previous_version_id <> id)
      and (rollback_of_version_id is null or rollback_of_version_id <> id)
    ),
  constraint renoapp_flow_versions_status_time_check
    check (
      (status = 'published' and superseded_at is null)
      or (status = 'superseded' and superseded_at is not null)
    ),
  constraint renoapp_flow_versions_action_number_unique
    unique (action_type_id, version_number)
);

create unique index if not exists renoapp_flow_versions_current_idx
  on public.renoapp_flow_versions (action_type_id)
  where status = 'published';

create index if not exists renoapp_flow_versions_history_idx
  on public.renoapp_flow_versions (action_type_id, version_number desc);

create index if not exists renoapp_flow_versions_previous_idx
  on public.renoapp_flow_versions (previous_version_id)
  where previous_version_id is not null;

create table if not exists public.renoapp_flow_change_sets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.renoapp_flow_ai_runs (id) on delete restrict,
  action_type_id uuid references public.renovation_action_types (id) on delete set null,
  target_action_key text not null,
  mode text not null,
  status text not null default 'proposed',
  summary text not null default '',
  base_version_id uuid references public.renoapp_flow_versions (id) on delete restrict,
  applied_version_id uuid unique references public.renoapp_flow_versions (id) on delete restrict,
  base_snapshot jsonb not null default '{}'::jsonb,
  base_snapshot_hash text,
  proposed_snapshot jsonb not null,
  proposed_snapshot_hash text not null,
  changes jsonb not null default '[]'::jsonb,
  validation_issues jsonb not null default '[]'::jsonb,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  applied_by uuid references public.profiles (id) on delete set null,
  applied_at timestamptz,
  reverted_by uuid references public.profiles (id) on delete set null,
  reverted_at timestamptz,
  apply_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_flow_change_sets_mode_check
    check (mode in ('create', 'review', 'extend')),
  constraint renoapp_flow_change_sets_status_check
    check (
      status in (
        'proposed',
        'approved',
        'rejected',
        'applying',
        'applied',
        'apply_failed',
        'superseded',
        'reverted'
      )
    ),
  constraint renoapp_flow_change_sets_target_key_check
    check (
      target_action_key = lower(target_action_key)
      and target_action_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'
    ),
  constraint renoapp_flow_change_sets_existing_target_check
    check (mode = 'create' or action_type_id is not null),
  constraint renoapp_flow_change_sets_base_snapshot_check
    check (jsonb_typeof(base_snapshot) = 'object'),
  constraint renoapp_flow_change_sets_proposed_snapshot_check
    check (jsonb_typeof(proposed_snapshot) = 'object'),
  constraint renoapp_flow_change_sets_changes_check
    check (jsonb_typeof(changes) = 'array'),
  constraint renoapp_flow_change_sets_validation_issues_check
    check (jsonb_typeof(validation_issues) = 'array'),
  constraint renoapp_flow_change_sets_base_hash_check
    check (base_snapshot_hash is null or base_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint renoapp_flow_change_sets_proposed_hash_check
    check (proposed_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint renoapp_flow_change_sets_apply_state_check
    check (
      status not in ('applied', 'reverted')
      or (applied_at is not null and applied_version_id is not null)
    ),
  constraint renoapp_flow_change_sets_reverted_state_check
    check (status <> 'reverted' or reverted_at is not null),
  constraint renoapp_flow_change_sets_rejected_state_check
    check (status <> 'rejected' or rejected_at is not null)
);

create index if not exists renoapp_flow_change_sets_action_history_idx
  on public.renoapp_flow_change_sets (action_type_id, created_at desc)
  where action_type_id is not null;

create index if not exists renoapp_flow_change_sets_status_idx
  on public.renoapp_flow_change_sets (status, created_at);

create unique index if not exists renoapp_flow_change_sets_open_action_idx
  on public.renoapp_flow_change_sets (action_type_id)
  where action_type_id is not null
    and status in ('proposed', 'approved', 'applying');

drop trigger if exists trg_renoapp_flow_change_sets_set_updated_at
  on public.renoapp_flow_change_sets;
create trigger trg_renoapp_flow_change_sets_set_updated_at
before update on public.renoapp_flow_change_sets
for each row execute function public.renoapp_set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'renoapp_flow_versions_source_change_set_fk'
      and conrelid = 'public.renoapp_flow_versions'::regclass
  ) then
    alter table public.renoapp_flow_versions
      add constraint renoapp_flow_versions_source_change_set_fk
      foreign key (source_change_set_id)
      references public.renoapp_flow_change_sets (id)
      on delete restrict;
  end if;
end
$$;

create index if not exists renoapp_flow_versions_change_set_idx
  on public.renoapp_flow_versions (source_change_set_id)
  where source_change_set_id is not null;

create or replace function public.guard_renoapp_flow_version_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.action_type_id is distinct from old.action_type_id
     or new.version_number is distinct from old.version_number
     or new.snapshot is distinct from old.snapshot
     or new.snapshot_hash is distinct from old.snapshot_hash
     or new.previous_version_id is distinct from old.previous_version_id
     or new.rollback_of_version_id is distinct from old.rollback_of_version_id
     or new.source_change_set_id is distinct from old.source_change_set_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.published_at is distinct from old.published_at
  then
    raise exception using
      errcode = '23514',
      message = 'RENOAPP_FLOW_VERSION_SNAPSHOT_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_renoapp_flow_version_snapshot
  on public.renoapp_flow_versions;
create trigger trg_guard_renoapp_flow_version_snapshot
before update on public.renoapp_flow_versions
for each row execute function public.guard_renoapp_flow_version_snapshot();

create table if not exists public.renoapp_flow_change_set_sources (
  change_set_id uuid not null references public.renoapp_flow_change_sets (id) on delete cascade,
  source_id uuid not null references public.renoapp_flow_sources (id) on delete restrict,
  claim_key text not null,
  source_role text not null default 'supports',
  citation_note text,
  created_at timestamptz not null default now(),
  constraint renoapp_flow_change_set_sources_pkey
    primary key (change_set_id, source_id, claim_key),
  constraint renoapp_flow_change_set_sources_claim_key_check
    check (btrim(claim_key) <> '' and char_length(claim_key) <= 500),
  constraint renoapp_flow_change_set_sources_role_check
    check (source_role in ('supports', 'context', 'contradicts'))
);

create index if not exists renoapp_flow_change_set_sources_source_idx
  on public.renoapp_flow_change_set_sources (source_id, change_set_id);

create or replace function public.validate_renoapp_flow_change_set_source_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.renoapp_flow_change_sets change_set
    join public.renoapp_flow_sources source
      on source.id = new.source_id
     and source.run_id = change_set.run_id
    where change_set.id = new.change_set_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'RENOAPP_FLOW_CHANGE_SET_SOURCE_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_renoapp_flow_change_set_source_scope
  on public.renoapp_flow_change_set_sources;
create trigger trg_validate_renoapp_flow_change_set_source_scope
before insert or update on public.renoapp_flow_change_set_sources
for each row execute function public.validate_renoapp_flow_change_set_source_scope();

create table if not exists public.renoapp_flow_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_kind text not null default 'user',
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action_type_id uuid references public.renovation_action_types (id) on delete restrict,
  run_id uuid references public.renoapp_flow_ai_runs (id) on delete restrict,
  change_set_id uuid references public.renoapp_flow_change_sets (id) on delete restrict,
  version_id uuid references public.renoapp_flow_versions (id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint renoapp_flow_audit_events_event_type_check
    check (event_type = lower(event_type) and event_type ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_flow_audit_events_actor_kind_check
    check (actor_kind in ('user', 'ai', 'system')),
  constraint renoapp_flow_audit_events_target_check
    check (
      action_type_id is not null
      or run_id is not null
      or change_set_id is not null
      or version_id is not null
    ),
  constraint renoapp_flow_audit_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists renoapp_flow_audit_events_created_idx
  on public.renoapp_flow_audit_events (created_at desc);

create index if not exists renoapp_flow_audit_events_action_idx
  on public.renoapp_flow_audit_events (action_type_id, created_at desc)
  where action_type_id is not null;

create index if not exists renoapp_flow_audit_events_run_idx
  on public.renoapp_flow_audit_events (run_id, created_at)
  where run_id is not null;

-- RLS intentionally exposes no DELETE policy. Sources, provenance links and
-- audit events are append-only to authenticated admins; lifecycle tables may
-- only be updated while their immutable snapshots remain protected above.
alter table public.renoapp_flow_ai_runs enable row level security;
alter table public.renoapp_flow_sources enable row level security;
alter table public.renoapp_flow_versions enable row level security;
alter table public.renoapp_flow_change_sets enable row level security;
alter table public.renoapp_flow_change_set_sources enable row level security;
alter table public.renoapp_flow_audit_events enable row level security;

revoke all on table
  public.renoapp_flow_ai_runs,
  public.renoapp_flow_sources,
  public.renoapp_flow_versions,
  public.renoapp_flow_change_sets,
  public.renoapp_flow_change_set_sources,
  public.renoapp_flow_audit_events
from anon;

grant select, insert, update on table
  public.renoapp_flow_ai_runs,
  public.renoapp_flow_versions,
  public.renoapp_flow_change_sets
to authenticated;

grant select, insert on table
  public.renoapp_flow_sources,
  public.renoapp_flow_change_set_sources,
  public.renoapp_flow_audit_events
to authenticated;

drop policy if exists renoapp_flow_ai_runs_admin_select on public.renoapp_flow_ai_runs;
create policy renoapp_flow_ai_runs_admin_select
  on public.renoapp_flow_ai_runs for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_ai_runs_admin_insert on public.renoapp_flow_ai_runs;
create policy renoapp_flow_ai_runs_admin_insert
  on public.renoapp_flow_ai_runs for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_ai_runs_admin_update on public.renoapp_flow_ai_runs;
create policy renoapp_flow_ai_runs_admin_update
  on public.renoapp_flow_ai_runs for update to authenticated
  using (public.is_hushub_renoapp_admin())
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_sources_admin_select on public.renoapp_flow_sources;
create policy renoapp_flow_sources_admin_select
  on public.renoapp_flow_sources for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_sources_admin_insert on public.renoapp_flow_sources;
create policy renoapp_flow_sources_admin_insert
  on public.renoapp_flow_sources for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_versions_admin_select on public.renoapp_flow_versions;
create policy renoapp_flow_versions_admin_select
  on public.renoapp_flow_versions for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_versions_admin_insert on public.renoapp_flow_versions;
create policy renoapp_flow_versions_admin_insert
  on public.renoapp_flow_versions for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_versions_admin_update on public.renoapp_flow_versions;
create policy renoapp_flow_versions_admin_update
  on public.renoapp_flow_versions for update to authenticated
  using (public.is_hushub_renoapp_admin())
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_change_sets_admin_select on public.renoapp_flow_change_sets;
create policy renoapp_flow_change_sets_admin_select
  on public.renoapp_flow_change_sets for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_change_sets_admin_insert on public.renoapp_flow_change_sets;
create policy renoapp_flow_change_sets_admin_insert
  on public.renoapp_flow_change_sets for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_change_sets_admin_update on public.renoapp_flow_change_sets;
create policy renoapp_flow_change_sets_admin_update
  on public.renoapp_flow_change_sets for update to authenticated
  using (public.is_hushub_renoapp_admin())
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_change_set_sources_admin_select
  on public.renoapp_flow_change_set_sources;
create policy renoapp_flow_change_set_sources_admin_select
  on public.renoapp_flow_change_set_sources for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_change_set_sources_admin_insert
  on public.renoapp_flow_change_set_sources;
create policy renoapp_flow_change_set_sources_admin_insert
  on public.renoapp_flow_change_set_sources for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_audit_events_admin_select
  on public.renoapp_flow_audit_events;
create policy renoapp_flow_audit_events_admin_select
  on public.renoapp_flow_audit_events for select to authenticated
  using (public.is_hushub_renoapp_admin());

drop policy if exists renoapp_flow_audit_events_admin_insert
  on public.renoapp_flow_audit_events;
create policy renoapp_flow_audit_events_admin_insert
  on public.renoapp_flow_audit_events for insert to authenticated
  with check (public.is_hushub_renoapp_admin());

comment on table public.renoapp_flow_ai_runs is
  'Auditable AI requests. A run may propose a change set but never mutates live RenoApp flow configuration.';
comment on table public.renoapp_flow_sources is
  'Per-run source metadata with explicit legal and guidance classification; full copyrighted source bodies are not stored.';
comment on table public.renoapp_flow_change_sets is
  'Human-reviewable proposal with base/proposed snapshots and optimistic-concurrency hashes.';
comment on table public.renoapp_flow_change_set_sources is
  'Claim-level provenance linking proposed flow changes to sources from the same AI run.';
comment on table public.renoapp_flow_versions is
  'Immutable action-flow snapshots used to publish, compare and create compensating rollback versions.';
comment on table public.renoapp_flow_audit_events is
  'Append-only business audit for AI runs, human approval, apply and rollback activity.';
