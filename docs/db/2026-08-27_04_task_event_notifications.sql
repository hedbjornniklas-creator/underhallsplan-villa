-- Uppdrag: durable notifications for human business events.
--
-- Deployment order matters: deploy the backward-compatible application worker
-- first and wait until the rollout has fully replaced old application pods,
-- then apply this migration. Once the trigger exists, the generic worker will
-- start claiming job_type = 'send_message' rows immediately. The prepare RPC
-- still detects a legacy delivery as defense in depth during rollout overlap.

-- ---------------------------------------------------------------------
-- Explicit source/recipient identity on the existing message outbox
-- ---------------------------------------------------------------------

alter table public.task_messages
  add column if not exists source_event_id uuid;

alter table public.task_message_deliveries
  add column if not exists source_event_id uuid,
  add column if not exists recipient_kind text,
  add column if not exists recipient_profile_id uuid,
  add column if not exists recipient_contact_id uuid,
  add column if not exists reconciliation_retry_for_delivery_id uuid,
  add column if not exists reconciliation_retry_for_attempt integer;

-- PostgreSQL can use this non-partial unique index as the target of the scoped
-- composite foreign keys below. It makes org/task mismatches impossible even
-- for service-role writes.
create unique index if not exists task_events_id_org_task_unique_idx
  on public.task_events (id, org_id, task_id);

create unique index if not exists task_messages_id_source_event_org_task_unique_idx
  on public.task_messages (id, source_event_id, org_id, task_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_messages_source_event_scope_fkey'
      and constraint_row.conrelid = 'public.task_messages'::regclass
  ) then
    alter table public.task_messages
      add constraint task_messages_source_event_scope_fkey
      foreign key (source_event_id, org_id, task_id)
      references public.task_events (id, org_id, task_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_message_event_scope_fkey'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_message_event_scope_fkey
      foreign key (message_id, source_event_id, org_id, task_id)
      references public.task_messages (id, source_event_id, org_id, task_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_source_event_scope_fkey'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_source_event_scope_fkey
      foreign key (source_event_id, org_id, task_id)
      references public.task_events (id, org_id, task_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_recipient_kind_check'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_recipient_kind_check
      check (
        (
          source_event_id is null
          and recipient_kind is null
          and recipient_profile_id is null
          and recipient_contact_id is null
        )
        or
        (
          source_event_id is not null
          and (
            (
              recipient_kind = 'profile'
              and recipient_profile_id is not null
              and recipient_contact_id is null
            )
            or
            (
              recipient_kind = 'contact'
              and recipient_contact_id is not null
              and recipient_profile_id is null
            )
          )
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_recipient_profile_fkey'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_recipient_profile_fkey
      foreign key (recipient_profile_id)
      references public.profiles (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_recipient_contact_fkey'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_recipient_contact_fkey
      foreign key (recipient_contact_id)
      references public.organization_contacts (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_reconciliation_attempt_check'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_reconciliation_attempt_check
      check (
        (
          reconciliation_retry_for_delivery_id is null
          and reconciliation_retry_for_attempt is null
        )
        or (
          reconciliation_retry_for_delivery_id is not null
          and reconciliation_retry_for_attempt between 1 and 20
        )
      );
  end if;
end
$$;

-- Every human event has one audit message. Primary/fallback deliveries reuse
-- that message and are unique for the event, exact recipient and channel.
create unique index if not exists task_messages_source_event_unique_idx
  on public.task_messages (source_event_id)
  where source_event_id is not null;

create unique index if not exists task_message_deliveries_event_profile_channel_unique_idx
  on public.task_message_deliveries (
    source_event_id,
    recipient_profile_id,
    channel
  )
  where source_event_id is not null
    and recipient_kind = 'profile';

create unique index if not exists task_message_deliveries_event_contact_channel_unique_idx
  on public.task_message_deliveries (
    source_event_id,
    recipient_contact_id,
    channel
  )
  where source_event_id is not null
    and recipient_kind = 'contact';

create index if not exists task_message_deliveries_source_event_idx
  on public.task_message_deliveries (source_event_id, created_at, id)
  where source_event_id is not null;

comment on column public.task_messages.source_event_id is
  'Business event that caused this token-free notification audit message.';
comment on column public.task_message_deliveries.source_event_id is
  'Business event that caused this delivery. Used with explicit recipient identity for hard idempotency.';
comment on column public.task_message_deliveries.reconciliation_retry_for_delivery_id is
  'Delivery whose confirmed-not-sent outcome authorized the current reconciliation attempt on this row.';
comment on column public.task_message_deliveries.reconciliation_retry_for_attempt is
  'Attempt number on reconciliation_retry_for_delivery_id that authorized exactly one additional provider attempt.';

-- ---------------------------------------------------------------------
-- Reject credentials and generated bearer URLs from notification metadata
-- ---------------------------------------------------------------------

create or replace function public.task_notification_json_contains_secret(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  object_key text;
  object_value jsonb;
  array_value jsonb;
  normalized_key text;
  scalar_value text;
begin
  if p_value is null then
    return false;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      for object_key, object_value in
        select entry.key, entry.value
        from pg_catalog.jsonb_each(p_value) entry
      loop
        normalized_key := pg_catalog.regexp_replace(
          pg_catalog.lower(object_key),
          '[^a-z0-9]',
          '',
          'g'
        );
        if normalized_key in (
          'token',
          'accesstoken',
          'refreshtoken',
          'idtoken',
          'bearertoken',
          'secret',
          'clientsecret',
          'password',
          'credential',
          'credentials',
          'magiclink',
          'signedurl',
          'directurl',
          'actionurl',
          'accessurl'
        ) then
          return true;
        end if;
        if public.task_notification_json_contains_secret(object_value) then
          return true;
        end if;
      end loop;
    when 'array' then
      for array_value in
        select element.value
        from pg_catalog.jsonb_array_elements(p_value) element
      loop
        if public.task_notification_json_contains_secret(array_value) then
          return true;
        end if;
      end loop;
    when 'string' then
      scalar_value := p_value #>> '{}';
      if scalar_value ~* '^https?://'
        or scalar_value ~* '(^|[[:space:]])bearer[[:space:]]+'
        or scalar_value ~* '[?&](token|access_token|refresh_token|code|secret)='
      then
        return true;
      end if;
    else
      null;
  end case;

  return false;
end;
$$;

revoke all on function public.task_notification_json_contains_secret(jsonb)
  from public, anon, authenticated;
grant execute on function public.task_notification_json_contains_secret(jsonb)
  to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_messages_notification_metadata_token_free_check'
      and constraint_row.conrelid = 'public.task_messages'::regclass
  ) then
    alter table public.task_messages
      add constraint task_messages_notification_metadata_token_free_check
      check (
        source_event_id is null
        or (
          metadata ->> 'tokenPersisted' = 'false'
          and not public.task_notification_json_contains_secret(metadata)
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname = 'task_message_deliveries_notification_payload_token_free_check'
      and constraint_row.conrelid = 'public.task_message_deliveries'::regclass
  ) then
    alter table public.task_message_deliveries
      add constraint task_message_deliveries_notification_payload_token_free_check
      check (
        source_event_id is null
        or (
          provider_payload ->> 'tokenPersisted' = 'false'
          and not public.task_notification_json_contains_secret(provider_payload)
        )
      );
  end if;
end
$$;

-- A globally disabled recipient identity is an authorization boundary. Link
-- issuance must not be able to recreate access after the identity-disable
-- trigger has revoked existing links and grants. The row locks serialize a
-- concurrent disable with a new hash-only bearer insert.
create or replace function public.guard_task_access_link_recipient_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  identity_id uuid;
  identity_status text;
begin
  select contact.recipient_identity_id
  into identity_id
  from public.organization_contacts contact
  where contact.id = new.contact_id
    and contact.org_id = new.org_id
  for share;

  if identity_id is null then
    return new;
  end if;

  select identity.status
  into identity_status
  from public.task_recipient_identities identity
  where identity.id = identity_id
  for share;

  if identity_status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_task_access_link_recipient_identity()
  from public, anon, authenticated;

drop trigger if exists trg_guard_task_access_link_recipient_identity
  on public.task_access_links;
create trigger trg_guard_task_access_link_recipient_identity
before insert on public.task_access_links
for each row
execute function public.guard_task_access_link_recipient_identity();

-- Repair any bearer that an older issuer path may have minted after the
-- identity was disabled but before the insert guard existed.
update public.task_access_links access_link
set revoked_at = coalesce(access_link.revoked_at, clock_timestamp())
from public.organization_contacts contact
join public.task_recipient_identities identity
  on identity.id = contact.recipient_identity_id
where access_link.contact_id = contact.id
  and access_link.org_id = contact.org_id
  and identity.status = 'disabled'
  and access_link.revoked_at is null;

-- `sending` means that a provider call may already have begun. An archive or
-- other concurrent cancellation may cancel a reservation only while the new
-- worker has explicitly persisted providerCallStarted=false. Older workers do
-- not write that marker, so their in-flight outcomes fail closed as ambiguous.
create or replace function public.guard_task_delivery_inflight_cancellation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.status = 'sending'
    and new.status = 'cancelled'
    and old.provider_payload ->> 'providerCallStarted' is distinct from 'false'
  then
    new.status := 'ambiguous';
    new.failed_at := null;
    new.next_attempt_at := null;
    new.error_message := 'TASK_DELIVERY_RECONCILIATION_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_task_delivery_inflight_cancellation()
  from public, anon, authenticated;

drop trigger if exists trg_guard_task_delivery_inflight_cancellation
  on public.task_message_deliveries;
create trigger trg_guard_task_delivery_inflight_cancellation
before update of status on public.task_message_deliveries
for each row
execute function public.guard_task_delivery_inflight_cancellation();

-- ---------------------------------------------------------------------
-- Canonical lock order for bearer issuance and delivery reconciliation
-- ---------------------------------------------------------------------

-- The original bearer issuer from migration 25 locks task -> contact ->
-- access-link rows. Recipient disable already owns the identity row before it
-- revokes links. Wrap the established RPC so every supported caller instead
-- locks task -> contact -> identity before the original implementation can
-- touch access-link rows. The insert trigger above remains a final invariant.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.issue_task_bearer_access_link_without_identity_guard(uuid,uuid,text,timestamptz,uuid,boolean)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.issue_task_bearer_access_link(uuid,uuid,text,timestamptz,uuid,boolean)'
    ) is null then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_ACCESS_BEARER_ISSUER_PREREQUISITE_MISSING';
    end if;

    alter function public.issue_task_bearer_access_link(
      uuid,
      uuid,
      text,
      timestamptz,
      uuid,
      boolean
    ) rename to issue_task_bearer_access_link_without_identity_guard;
  end if;
end
$$;

revoke all on function public.issue_task_bearer_access_link_without_identity_guard(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  boolean
) from public, anon, authenticated, service_role;

create or replace function public.issue_task_bearer_access_link(
  p_task_id uuid,
  p_contact_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by_profile_id uuid,
  p_issued_by_system boolean default false
)
returns public.task_access_links
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  contact_identity_id uuid;
  identity_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_BEARER_ISSUE_FORBIDDEN';
  end if;

  if p_task_id is null
    or p_contact_id is null
    or p_created_by_profile_id is null
    or p_token_hash is null
    or pg_catalog.char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= pg_catalog.now()
    or p_expires_at > pg_catalog.now() + interval '180 days' + interval '1 hour'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ACCESS_BEARER_ISSUE_INPUT_INVALID';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOT_FOUND';
  end if;

  select contact.recipient_identity_id
  into contact_identity_id
  from public.organization_contacts contact
  where contact.id = p_contact_id
    and contact.org_id = task_row.org_id
    and contact.is_active = true
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_CONTACT_NOT_FOUND';
  end if;

  if task_row.assignee_contact_id is distinct from p_contact_id then
    raise exception using
      errcode = '23514',
      message = 'TASK_ACCESS_LINK_ASSIGNEE_INVALID';
  end if;

  if contact_identity_id is not null then
    select identity.status
    into identity_status
    from public.task_recipient_identities identity
    where identity.id = contact_identity_id
    for share;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_RECIPIENT_IDENTITY_NOT_FOUND';
    end if;
    if identity_status = 'disabled' then
      raise exception using
        errcode = '42501',
        message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
    end if;
  end if;

  return public.issue_task_bearer_access_link_without_identity_guard(
    p_task_id,
    p_contact_id,
    p_token_hash,
    p_expires_at,
    p_created_by_profile_id,
    p_issued_by_system
  );
end;
$$;

revoke all on function public.issue_task_bearer_access_link(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  boolean
) from public, anon, authenticated;
grant execute on function public.issue_task_bearer_access_link(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  boolean
) to service_role;

comment on function public.issue_task_bearer_access_link(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  boolean
) is
  'Service-only bearer issuance with canonical task, contact, recipient-identity and access-link lock order.';

-- Migration 02 originally locks delivery -> message -> task during operator
-- reconciliation, while task archiving locks task -> delivery. Preserve the
-- public RPC signature but acquire and revalidate task -> delivery first, then
-- let the existing audited implementation finish under those held locks.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.resolve_task_message_delivery_without_canonical_lock_order(uuid,text,text,text)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.resolve_task_message_delivery(uuid,text,text,text)'
    ) is null then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_DELIVERY_RESOLVER_PREREQUISITE_MISSING';
    end if;

    alter function public.resolve_task_message_delivery(uuid, text, text, text)
      rename to resolve_task_message_delivery_without_canonical_lock_order;
  end if;
end
$$;

revoke all on function public.resolve_task_message_delivery_without_canonical_lock_order(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

create or replace function public.resolve_task_message_delivery(
  p_delivery_id uuid,
  p_resolution text,
  p_provider_message_id text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  delivery_org_id uuid;
  delivery_task_id uuid;
  delivery_source_event_id uuid;
begin
  if p_delivery_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_RESOLUTION_ID_REQUIRED';
  end if;

  select delivery.org_id, delivery.task_id, delivery.source_event_id
  into delivery_org_id, delivery_task_id, delivery_source_event_id
  from public.task_message_deliveries delivery
  where delivery.id = p_delivery_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DELIVERY_NOT_FOUND';
  end if;

  perform 1
  from public.operational_tasks task
  where task.id = delivery_task_id
    and task.org_id = delivery_org_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DELIVERY_TASK_NOT_FOUND';
  end if;

  -- Human-event reconciliation updates this exact route job from its delivery
  -- trigger. Lock it before the delivery so archiving, stale recovery and
  -- operator reconciliation all agree on task -> job -> delivery.
  if delivery_source_event_id is not null then
    perform 1
    from public.task_automation_jobs job
    where job.org_id = delivery_org_id
      and job.task_id = delivery_task_id
      and job.idempotency_key = 'task-notification:' || delivery_source_event_id::text
    for update;
  end if;

  perform 1
  from public.task_message_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.task_id = delivery_task_id
    and delivery.org_id = delivery_org_id
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'TASK_DELIVERY_SCOPE_CHANGED';
  end if;

  return public.resolve_task_message_delivery_without_canonical_lock_order(
    p_delivery_id,
    p_resolution,
    p_provider_message_id,
    p_note
  );
end;
$$;

revoke all on function public.resolve_task_message_delivery(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_task_message_delivery(uuid, text, text, text)
  to service_role;

comment on function public.resolve_task_message_delivery(uuid, text, text, text) is
  'Service-only audited provider reconciliation with canonical task-before-delivery lock order.';

-- ---------------------------------------------------------------------
-- Exact target resolution shared by enqueue and delivery preparation
-- ---------------------------------------------------------------------

-- Mirrors src/lib/tasks/internalAccess.ts for an arbitrary profile. A legacy
-- organization/dashboard admin is accepted only while that profile has no
-- current normalized Dashboard assignment; once normalized access exists, an
-- exact active tasks-module assignment for this organization is required.
create or replace function public.task_profile_has_module_access(
  p_org_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.org_members member
    join public.profiles profile
      on profile.id = member.profile_id
    where member.org_id = p_org_id
      and member.profile_id = p_profile_id
      and member.is_active = true
      and (
        exists (
          select 1
          from public.platform_access_assignments assignment
          join public.platform_products product
            on product.id = assignment.product_id
           and product.key = 'dashboard'
          join public.platform_modules module
            on module.id = assignment.module_id
           and module.product_id = product.id
           and module.key = 'tasks'
          where assignment.profile_id = p_profile_id
            and assignment.is_active = true
            and (
              assignment.expires_at is null
              or assignment.expires_at >= now()
            )
            and assignment.scope_type = 'organization'
            and assignment.scope_id = p_org_id::text
        )
        or (
          (member.role = 'admin' or coalesce(profile.is_admin, false))
          and not exists (
            select 1
            from public.platform_access_assignments normalized_assignment
            join public.platform_products normalized_product
              on normalized_product.id = normalized_assignment.product_id
             and normalized_product.key = 'dashboard'
            where normalized_assignment.profile_id = p_profile_id
              and normalized_assignment.is_active = true
              and (
                normalized_assignment.expires_at is null
                or normalized_assignment.expires_at >= now()
              )
          )
        )
      )
  );
$$;

revoke all on function public.task_profile_has_module_access(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.resolve_task_event_notification_target(
  p_event_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  event_row public.task_events%rowtype;
  task_row public.operational_tasks%rowtype;
  target_value text;
  recipient_kind_value text;
  recipient_id_value uuid;
  recipient_name_value text;
  default_channel_value text;
  actor_is_issuer boolean := false;
  actor_is_assignee boolean := false;
  actor_is_admin boolean := false;
  actor_is_system boolean := false;
  recipient_is_active boolean := false;
  recipient_has_module_access boolean := false;
begin
  if p_event_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_EVENT_ID_REQUIRED';
  end if;

  select event.*
  into event_row
  from public.task_events event
  where event.id = p_event_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOTIFICATION_EVENT_NOT_FOUND';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = event_row.task_id
    and task.org_id = event_row.org_id;

  if not found or task_row.archived_at is not null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'task_unavailable',
      'eventId', event_row.id,
      'taskId', event_row.task_id
    );
  end if;

  actor_is_issuer := event_row.actor_type = 'profile'
    and event_row.actor_profile_id = task_row.issuer_profile_id;
  actor_is_assignee := (
    event_row.actor_type = 'profile'
    and task_row.assignee_profile_id is not null
    and event_row.actor_profile_id = task_row.assignee_profile_id
  ) or (
    event_row.actor_type = 'contact'
    and task_row.assignee_contact_id is not null
    and event_row.actor_contact_id = task_row.assignee_contact_id
  );
  actor_is_system := event_row.actor_type in ('system', 'ai');
  actor_is_admin := event_row.actor_type = 'profile'
    and event_row.actor_profile_id is not null
    and exists (
      select 1
      from public.org_members member
      where member.org_id = task_row.org_id
        and member.profile_id = event_row.actor_profile_id
        and member.is_active = true
        and member.role = 'admin'
    );

  if event_row.event_type = 'comment' then
    if actor_is_assignee then
      target_value := 'creator';
    elsif actor_is_issuer or actor_is_admin then
      target_value := 'assignee';
    else
      return jsonb_build_object(
        'skipped', true,
        'reason', 'actor_invalid',
        'eventId', event_row.id,
        'taskId', task_row.id
      );
    end if;
  elsif event_row.event_type = 'deadline_change_requested' then
    if not actor_is_assignee then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'actor_invalid',
        'eventId', event_row.id,
        'taskId', task_row.id
      );
    end if;
    target_value := 'creator';
  elsif event_row.event_type in (
    'deadline_change_approved',
    'deadline_change_rejected'
  ) then
    if not (actor_is_issuer or actor_is_admin) then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'actor_invalid',
        'eventId', event_row.id,
        'taskId', task_row.id
      );
    end if;
    target_value := 'assignee';
  elsif event_row.event_type = 'status_changed'
    and event_row.to_status in ('waiting', 'ready_for_review')
  then
    if not (actor_is_assignee or actor_is_admin or actor_is_system) then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'actor_invalid',
        'eventId', event_row.id,
        'taskId', task_row.id
      );
    end if;
    target_value := 'creator';
  elsif event_row.event_type = 'status_changed'
    and event_row.to_status in ('returned', 'approved', 'cancelled')
  then
    if not (actor_is_issuer or actor_is_admin) then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'actor_invalid',
        'eventId', event_row.id,
        'taskId', task_row.id
      );
    end if;
    target_value := 'assignee';
  else
    return jsonb_build_object(
      'skipped', true,
      'reason', 'event_not_notifiable',
      'eventId', event_row.id,
      'taskId', task_row.id
    );
  end if;

  if target_value = 'creator' then
    recipient_kind_value := 'profile';
    recipient_id_value := task_row.issuer_profile_id;
    default_channel_value := 'email';
  elsif task_row.assignee_profile_id is not null then
    recipient_kind_value := 'profile';
    recipient_id_value := task_row.assignee_profile_id;
    default_channel_value := task_row.primary_channel;
  elsif task_row.assignee_contact_id is not null then
    recipient_kind_value := 'contact';
    recipient_id_value := task_row.assignee_contact_id;
    default_channel_value := task_row.primary_channel;
  else
    return jsonb_build_object(
      'skipped', true,
      'reason', 'recipient_missing',
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', target_value
    );
  end if;

  if event_row.actor_type = recipient_kind_value
    and (
      (recipient_kind_value = 'profile' and event_row.actor_profile_id = recipient_id_value)
      or
      (recipient_kind_value = 'contact' and event_row.actor_contact_id = recipient_id_value)
    )
  then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'self_recipient',
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', target_value
    );
  end if;

  if recipient_kind_value = 'profile' then
    select
      coalesce(
        nullif(btrim(profile.full_name), ''),
        nullif(btrim(profile.email), ''),
        'Mottagare'
      ),
      exists (
        select 1
        from public.org_members member
        where member.org_id = task_row.org_id
          and member.profile_id = recipient_id_value
          and member.is_active = true
      )
    into recipient_name_value, recipient_is_active
    from public.profiles profile
    where profile.id = recipient_id_value;

    recipient_has_module_access := recipient_is_active
      and public.task_profile_has_module_access(
        task_row.org_id,
        recipient_id_value
      );
  else
    select
      coalesce(nullif(btrim(contact.name), ''), 'Mottagare'),
      contact.is_active
        and contact.org_id = task_row.org_id
        and coalesce(identity.status <> 'disabled', true)
    into recipient_name_value, recipient_is_active
    from public.organization_contacts contact
    left join public.task_recipient_identities identity
      on identity.id = contact.recipient_identity_id
    where contact.id = recipient_id_value;
  end if;

  if not found then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'recipient_missing',
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', target_value
    );
  end if;

  if not recipient_is_active then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'recipient_inactive',
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', target_value,
      'recipientKind', recipient_kind_value,
      'recipientId', recipient_id_value
    );
  end if;

  if recipient_kind_value = 'profile' and not recipient_has_module_access then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'recipient_access_denied',
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', target_value,
      'recipientKind', recipient_kind_value,
      'recipientId', recipient_id_value
    );
  end if;

  return jsonb_build_object(
    'skipped', false,
    'eventId', event_row.id,
    'eventType', event_row.event_type,
    'taskId', task_row.id,
    'orgId', task_row.org_id,
    'target', target_value,
    'recipientKind', recipient_kind_value,
    'recipientId', recipient_id_value,
    'recipientName', recipient_name_value,
    'defaultChannel', default_channel_value,
    'fallbackChannel', case
      when target_value = 'assignee' then task_row.fallback_channel
      else null
    end,
    'taskStatus', task_row.status,
    'primaryChannel', task_row.primary_channel
  );
end;
$$;

revoke all on function public.resolve_task_event_notification_target(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Durable event enqueue (also exposed service-only for safe replay)
-- ---------------------------------------------------------------------

create or replace function public.enqueue_task_event_notification(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolution jsonb;
  job_row public.task_automation_jobs%rowtype;
  skipped_reason text;
  skipped_event_type text;
  skipped_org_id uuid;
  skipped_task_id uuid;
  inserted_count integer := 0;
begin
  if auth.role() <> 'service_role' and pg_trigger_depth() = 0 then
    raise exception using
      errcode = '42501',
      message = 'TASK_NOTIFICATION_ENQUEUE_FORBIDDEN';
  end if;

  resolution := public.resolve_task_event_notification_target(p_event_id);
  if coalesce((resolution ->> 'skipped')::boolean, true) then
    skipped_reason := resolution ->> 'reason';
    if skipped_reason in (
      'actor_invalid',
      'recipient_missing',
      'recipient_inactive',
      'recipient_access_denied'
    ) then
      select event.org_id, event.task_id, event.event_type
      into skipped_org_id, skipped_task_id, skipped_event_type
      from public.task_events event
      where event.id = p_event_id;

      insert into public.task_automation_jobs (
        org_id,
        task_id,
        job_type,
        status,
        available_at,
        attempt_count,
        idempotency_key,
        payload,
        error_message,
        completed_at
      )
      values (
        skipped_org_id,
        skipped_task_id,
        'send_message',
        'dead_letter',
        clock_timestamp(),
        0,
        'task-notification:' || p_event_id::text,
        jsonb_build_object(
          'notificationEventId', p_event_id,
          'eventType', skipped_event_type,
          'phase', 'deliver'
        ),
        'TASK_NOTIFICATION_' || upper(skipped_reason),
        clock_timestamp()
      )
      on conflict (org_id, idempotency_key) do nothing
      returning * into job_row;

      if job_row.id is null then
        select job.*
        into job_row
        from public.task_automation_jobs job
        where job.org_id = skipped_org_id
          and job.idempotency_key = 'task-notification:' || p_event_id::text;
      end if;

      return resolution || jsonb_build_object(
        'jobId', job_row.id,
        'jobStatus', job_row.status,
        'idempotencyKey', job_row.idempotency_key,
        'persistentFailure', true
      );
    end if;
    return resolution;
  end if;

  -- Manual service replay is allowed only for a definitive, repairable
  -- failure. An unknown provider outcome must first be resolved through the
  -- dedicated reconciliation RPC; it must never be replayed from this helper.
  if pg_trigger_depth() = 0 and exists (
    select 1
    from public.task_message_deliveries unresolved_delivery
    where unresolved_delivery.source_event_id = p_event_id
      and unresolved_delivery.status in ('sending', 'ambiguous')
  ) then
    raise exception using
      errcode = '55000',
      message = 'TASK_NOTIFICATION_REPLAY_RECONCILIATION_REQUIRED';
  end if;

  insert into public.task_automation_jobs as existing_job (
    org_id,
    task_id,
    job_type,
    status,
    available_at,
    idempotency_key,
    payload
  )
  values (
    (resolution ->> 'orgId')::uuid,
    (resolution ->> 'taskId')::uuid,
    'send_message',
    'queued',
    clock_timestamp(),
    'task-notification:' || p_event_id::text,
    jsonb_build_object(
      'notificationEventId', p_event_id,
      'eventType', resolution ->> 'eventType',
      'target', resolution ->> 'target',
      'recipientKind', resolution ->> 'recipientKind',
      'recipientId', resolution ->> 'recipientId',
      'phase', 'deliver'
    )
  )
  on conflict (org_id, idempotency_key) do update
  set
    message_id = case
      when existing_job.payload ->> 'target' in ('creator', 'assignee')
        and existing_job.payload ->> 'recipientKind' in ('profile', 'contact')
        and nullif(existing_job.payload ->> 'recipientId', '') is not null
        and existing_job.payload ->> 'phase' in ('deliver', 'reconcile')
        then existing_job.message_id
      else null
    end,
    delivery_id = case
      when existing_job.payload ->> 'target' in ('creator', 'assignee')
        and existing_job.payload ->> 'recipientKind' in ('profile', 'contact')
        and nullif(existing_job.payload ->> 'recipientId', '') is not null
        and existing_job.payload ->> 'phase' in ('deliver', 'reconcile')
        then existing_job.delivery_id
      else null
    end,
    status = 'queued',
    available_at = clock_timestamp(),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    attempt_count = 0,
    error_message = null,
    completed_at = null,
    payload = case
      when existing_job.payload ->> 'target' in ('creator', 'assignee')
        and existing_job.payload ->> 'recipientKind' in ('profile', 'contact')
        and nullif(existing_job.payload ->> 'recipientId', '') is not null
        and existing_job.payload ->> 'phase' in ('deliver', 'reconcile')
        then existing_job.payload
      else excluded.payload
    end,
    updated_at = clock_timestamp()
  where existing_job.status = 'dead_letter'
  returning * into job_row;
  get diagnostics inserted_count = row_count;

  -- Only the caller that actually inserted/reopened the route job may grant
  -- one additional definitive delivery attempt. Concurrent or repeated replay
  -- calls observe inserted_count = 0 and cannot inflate the attempt budget.
  if pg_trigger_depth() = 0 and inserted_count = 1 then
    update public.task_message_deliveries delivery
    set
      max_attempts = least(20, delivery.attempt_count + 1),
      next_attempt_at = clock_timestamp()
    where delivery.source_event_id = p_event_id
      and delivery.status = 'failed';
  end if;

  if inserted_count = 0 then
    select job.*
    into job_row
    from public.task_automation_jobs job
    where job.org_id = (resolution ->> 'orgId')::uuid
      and job.idempotency_key = 'task-notification:' || p_event_id::text;
  end if;

  if job_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOTIFICATION_JOB_NOT_FOUND';
  end if;

  return resolution || jsonb_build_object(
    'jobId', job_row.id,
    'jobStatus', job_row.status,
    'idempotencyKey', job_row.idempotency_key,
    'isNew', inserted_count = 1
  );
end;
$$;

revoke all on function public.enqueue_task_event_notification(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_task_event_notification(uuid)
  to service_role;

create or replace function public.enqueue_task_event_notification_from_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.enqueue_task_event_notification(new.id);
  return new;
end;
$$;

revoke all on function public.enqueue_task_event_notification_from_trigger()
  from public, anon, authenticated;

drop trigger if exists trg_enqueue_task_event_notification
  on public.task_events;
create trigger trg_enqueue_task_event_notification
after insert on public.task_events
for each row
when (
  new.event_type in (
    'comment',
    'deadline_change_requested',
    'deadline_change_approved',
    'deadline_change_rejected'
  )
  or (
    new.event_type = 'status_changed'
    and new.to_status in (
      'waiting',
      'ready_for_review',
      'returned',
      'approved',
      'cancelled'
    )
  )
)
execute function public.enqueue_task_event_notification_from_trigger();

-- ---------------------------------------------------------------------
-- Atomic, idempotent message + delivery preparation for the worker
-- ---------------------------------------------------------------------

create or replace function public.prepare_task_event_notification_delivery(
  p_event_id uuid,
  p_body_text text,
  p_channel text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_provider_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolution jsonb;
  event_row public.task_events%rowtype;
  task_row public.operational_tasks%rowtype;
  message_row public.task_messages%rowtype;
  delivery_row public.task_message_deliveries%rowtype;
  profile_row public.profiles%rowtype;
  contact_row public.organization_contacts%rowtype;
  channel_value text;
  recipient_kind_value text;
  recipient_id_value uuid;
  recipient_name_value text;
  recipient_address_value text;
  provider_value text;
  message_type_value text;
  idempotency_key_value text;
  metadata_value jsonb;
  provider_payload_value jsonb;
  initial_status text;
  initial_error text;
  message_inserted_count integer := 0;
  delivery_inserted_count integer := 0;
  activation_email_override boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_NOTIFICATION_PREPARE_FORBIDDEN';
  end if;

  if p_event_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_EVENT_ID_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_body_text, '')), '') is null
    or length(p_body_text) > 10000
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_BODY_INVALID';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or p_provider_payload is null
    or jsonb_typeof(p_provider_payload) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_METADATA_INVALID';
  end if;
  if public.task_notification_json_contains_secret(p_metadata)
    or public.task_notification_json_contains_secret(p_provider_payload)
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_SECRET_PERSISTENCE_FORBIDDEN';
  end if;

  -- A worker retry after creating the message but before creating its delivery
  -- must converge on the same rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_id::text, 0)
  );

  resolution := public.resolve_task_event_notification_target(p_event_id);
  if coalesce((resolution ->> 'skipped')::boolean, true) then
    return resolution;
  end if;

  select event.*
  into event_row
  from public.task_events event
  where event.id = p_event_id;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = (resolution ->> 'taskId')::uuid
    and task.org_id = (resolution ->> 'orgId')::uuid;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOTIFICATION_TASK_NOT_FOUND';
  end if;

  recipient_kind_value := resolution ->> 'recipientKind';
  recipient_id_value := (resolution ->> 'recipientId')::uuid;
  recipient_name_value := resolution ->> 'recipientName';
  channel_value := lower(btrim(coalesce(
    p_channel,
    resolution ->> 'defaultChannel'
  )));

  activation_email_override :=
    resolution ->> 'target' = 'assignee'
    and recipient_kind_value = 'contact'
    and resolution ->> 'primaryChannel' = 'whatsapp'
    and channel_value = 'email'
    and p_metadata ->> 'accountActivation' = 'true'
    and task_row.status in ('approved', 'cancelled')
    and event_row.event_type = 'status_changed'
    and event_row.to_status in ('approved', 'cancelled')
    and exists (
      select 1
      from public.organization_contacts activation_contact
      join public.task_recipient_identities activation_identity
        on activation_identity.id = activation_contact.recipient_identity_id
       and activation_identity.status in ('dormant', 'invited')
       and public.task_recipient_normalize_email(activation_contact.email)
         = activation_identity.email_normalized
      where activation_contact.id = recipient_id_value
        and activation_contact.org_id = task_row.org_id
        and activation_contact.is_active = true
        and task_row.assignee_contact_id = activation_contact.id
    );

  if resolution ->> 'target' = 'creator' then
    if channel_value <> 'email' then
      raise exception using
        errcode = '22023',
        message = 'TASK_NOTIFICATION_CHANNEL_INVALID';
    end if;
  elsif channel_value <> resolution ->> 'defaultChannel'
    and channel_value is distinct from nullif(resolution ->> 'fallbackChannel', '')
    and not activation_email_override
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_CHANNEL_INVALID';
  end if;

  if channel_value not in ('email', 'whatsapp', 'in_app') then
    raise exception using
      errcode = '22023',
      message = 'TASK_NOTIFICATION_CHANNEL_INVALID';
  end if;

  -- A normal fallback becomes eligible only after a definitive primary
  -- failure. The special activation email establishes account trust and is
  -- deliberately independent of provider delivery outcome.
  if not activation_email_override
    and channel_value is distinct from resolution ->> 'defaultChannel'
    and not exists (
      select 1
      from public.task_message_deliveries primary_delivery
      where primary_delivery.source_event_id = p_event_id
        and primary_delivery.org_id = task_row.org_id
        and primary_delivery.task_id = task_row.id
        and primary_delivery.recipient_kind = recipient_kind_value
        and (
          (recipient_kind_value = 'profile'
            and primary_delivery.recipient_profile_id = recipient_id_value)
          or
          (recipient_kind_value = 'contact'
            and primary_delivery.recipient_contact_id = recipient_id_value)
        )
        and primary_delivery.channel = resolution ->> 'defaultChannel'
        and primary_delivery.status = 'failed'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'TASK_NOTIFICATION_FALLBACK_NOT_READY';
  end if;

  if recipient_kind_value = 'profile' then
    select profile.*
    into profile_row
    from public.profiles profile
    where profile.id = recipient_id_value;
    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_NOTIFICATION_RECIPIENT_NOT_FOUND';
    end if;

    recipient_address_value := case channel_value
      when 'email' then nullif(btrim(profile_row.email), '')
      when 'whatsapp' then nullif(btrim(to_jsonb(profile_row) ->> 'phone'), '')
      else 'profile:' || recipient_id_value::text
    end;
  else
    select contact.*
    into contact_row
    from public.organization_contacts contact
    where contact.id = recipient_id_value
      and contact.org_id = task_row.org_id
      and contact.is_active = true;
    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_NOTIFICATION_RECIPIENT_NOT_FOUND';
    end if;

    recipient_address_value := case channel_value
      when 'email' then nullif(btrim(contact_row.email), '')
      when 'whatsapp' then coalesce(
        nullif(btrim(contact_row.whatsapp_number), ''),
        nullif(btrim(contact_row.phone), '')
      )
      else 'contact:' || recipient_id_value::text
    end;
  end if;

  -- Rolling-deploy defense: the previous application version synchronously
  -- persisted comment notifications after inserting the event. If that
  -- delivery already succeeded or has an unknown outcome, never create a
  -- second provider attempt from the new route job.
  select legacy_delivery.*
  into delivery_row
  from public.task_messages legacy_message
  join public.task_message_deliveries legacy_delivery
    on legacy_delivery.message_id = legacy_message.id
   and legacy_delivery.org_id = legacy_message.org_id
   and legacy_delivery.task_id = legacy_message.task_id
  where legacy_message.org_id = task_row.org_id
    and legacy_message.task_id = task_row.id
    and legacy_message.source_event_id is null
    and legacy_message.metadata ->> 'eventId' = event_row.id::text
    and legacy_message.metadata ->> 'recipientKind' = recipient_kind_value
    and legacy_message.metadata ->> 'recipientId' = recipient_id_value::text
    and legacy_delivery.status in (
      'queued',
      'sending',
      'ambiguous',
      'sent',
      'delivered',
      'read',
      'replied'
    )
  order by
    case
      when legacy_delivery.status in ('queued', 'sending', 'ambiguous') then 0
      else 1
    end,
    legacy_delivery.created_at desc,
    legacy_delivery.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'skipped', true,
      'reason', case
        when delivery_row.status in ('queued', 'sending', 'ambiguous')
          then 'legacy_delivery_unresolved'
        else 'legacy_delivery_exists'
      end,
      'eventId', event_row.id,
      'taskId', task_row.id,
      'target', resolution ->> 'target',
      'deliveryId', delivery_row.id,
      'messageId', delivery_row.message_id,
      'recipientKind', recipient_kind_value,
      'recipientId', recipient_id_value,
      'recipientName', recipient_name_value,
      'recipientAddress', delivery_row.recipient_address,
      'channel', delivery_row.channel,
      'provider', delivery_row.provider,
      'status', delivery_row.status,
      'idempotencyKey', delivery_row.idempotency_key
    );
  end if;

  provider_value := case channel_value
    when 'email' then 'resend'
    when 'whatsapp' then 'meta_whatsapp'
    else 'hushub'
  end;
  message_type_value := case
    when event_row.event_type = 'comment' then 'comment'
    when event_row.event_type in (
      'deadline_change_approved',
      'deadline_change_rejected'
    ) then 'decision'
    when event_row.event_type = 'status_changed'
      and event_row.to_status in ('returned', 'approved', 'cancelled')
      then 'decision'
    else 'status_request'
  end;

  metadata_value := p_metadata || jsonb_build_object(
    'notification', true,
    'sourceEventId', event_row.id,
    'eventType', event_row.event_type,
    'target', resolution ->> 'target',
    'recipientKind', recipient_kind_value,
    'recipientId', recipient_id_value,
    'tokenPersisted', false
  );
  provider_payload_value := p_provider_payload || jsonb_build_object(
    'sourceEventId', event_row.id,
    'eventType', event_row.event_type,
    'target', resolution ->> 'target',
    'recipientKind', recipient_kind_value,
    'recipientId', recipient_id_value,
    'tokenPersisted', false
  );

  insert into public.task_messages (
    org_id,
    task_id,
    source_event_id,
    direction,
    message_type,
    actor_type,
    actor_name,
    body_text,
    generated_by_ai,
    metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    event_row.id,
    'outbound',
    message_type_value,
    'system',
    'HusHub',
    btrim(p_body_text),
    false,
    metadata_value
  )
  on conflict (source_event_id) where source_event_id is not null do nothing
  returning * into message_row;
  get diagnostics message_inserted_count = row_count;

  if message_inserted_count = 0 then
    select message.*
    into message_row
    from public.task_messages message
    where message.source_event_id = event_row.id
      and message.org_id = task_row.org_id
      and message.task_id = task_row.id;
  end if;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOTIFICATION_MESSAGE_NOT_FOUND';
  end if;

  idempotency_key_value := 'task-notification:'
    || event_row.id::text
    || ':' || channel_value
    || ':' || recipient_kind_value
    || ':' || recipient_id_value::text;

  initial_status := case
    when channel_value = 'in_app' then 'delivered'
    when recipient_address_value is null then 'failed'
    else 'queued'
  end;
  initial_error := case
    when recipient_address_value is null
      then 'TASK_NOTIFICATION_RECIPIENT_ADDRESS_MISSING'
    else null
  end;
  recipient_address_value := coalesce(
    recipient_address_value,
    'missing:' || recipient_kind_value || ':' || recipient_id_value::text
  );

  insert into public.task_message_deliveries (
    org_id,
    task_id,
    message_id,
    source_event_id,
    recipient_kind,
    recipient_profile_id,
    recipient_contact_id,
    channel,
    recipient_address,
    provider,
    status,
    is_fallback,
    scheduled_at,
    delivered_at,
    failed_at,
    attempt_count,
    max_attempts,
    next_attempt_at,
    error_message,
    idempotency_key,
    provider_payload
  )
  values (
    task_row.org_id,
    task_row.id,
    message_row.id,
    event_row.id,
    recipient_kind_value,
    case when recipient_kind_value = 'profile' then recipient_id_value else null end,
    case when recipient_kind_value = 'contact' then recipient_id_value else null end,
    channel_value,
    recipient_address_value,
    provider_value,
    initial_status,
    channel_value is distinct from resolution ->> 'defaultChannel',
    clock_timestamp(),
    case when initial_status = 'delivered' then clock_timestamp() else null end,
    case when initial_status = 'failed' then clock_timestamp() else null end,
    0,
    case when channel_value in ('whatsapp', 'in_app') then 1 else 5 end,
    null,
    initial_error,
    idempotency_key_value,
    provider_payload_value
  )
  on conflict (org_id, idempotency_key) do nothing
  returning * into delivery_row;
  get diagnostics delivery_inserted_count = row_count;

  if delivery_inserted_count = 0 then
    select delivery.*
    into delivery_row
    from public.task_message_deliveries delivery
    where delivery.org_id = task_row.org_id
      and delivery.idempotency_key = idempotency_key_value
      and delivery.source_event_id = event_row.id
      and delivery.task_id = task_row.id
      and delivery.message_id = message_row.id
      and delivery.channel = channel_value
      and delivery.recipient_kind = recipient_kind_value
      and (
        (recipient_kind_value = 'profile'
          and delivery.recipient_profile_id = recipient_id_value)
        or
        (recipient_kind_value = 'contact'
          and delivery.recipient_contact_id = recipient_id_value)
      );
  end if;

  if not found then
    raise exception using
      errcode = '23505',
      message = 'TASK_NOTIFICATION_DELIVERY_IDEMPOTENCY_CONFLICT';
  end if;

  return jsonb_build_object(
    'skipped', false,
    'eventId', event_row.id,
    'taskId', task_row.id,
    'target', resolution ->> 'target',
    'deliveryId', delivery_row.id,
    'messageId', message_row.id,
    'recipientKind', recipient_kind_value,
    'recipientId', recipient_id_value,
    'recipientName', recipient_name_value,
    'recipientAddress', delivery_row.recipient_address,
    'channel', delivery_row.channel,
    'provider', delivery_row.provider,
    'status', delivery_row.status,
    'idempotencyKey', delivery_row.idempotency_key,
    'isNew', delivery_inserted_count = 1
  );
end;
$$;

revoke all on function public.prepare_task_event_notification_delivery(
  uuid,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.prepare_task_event_notification_delivery(
  uuid,
  text,
  text,
  jsonb,
  jsonb
) to service_role;

comment on function public.enqueue_task_event_notification(uuid) is
  'Service-only idempotent replay endpoint. Normal enqueue occurs atomically from the task_events AFTER INSERT trigger.';
comment on function public.prepare_task_event_notification_delivery(uuid, text, text, jsonb, jsonb) is
  'Service-only token-free preparation of one durable delivery. Recipient, address and allowed channel are derived and validated against the source event and task.';

-- An ambiguous provider outcome is deliberately not retried. Once the
-- service-only operator RPC confirms that it was not sent, reopen the exact
-- human-event route job so the worker can apply its validated fallback policy.
create or replace function public.requeue_task_event_notification_after_resolution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.status <> 'ambiguous'
    or new.status <> 'failed'
    or new.source_event_id is null
  then
    return new;
  end if;

  insert into public.task_automation_jobs as existing_job (
    org_id,
    task_id,
    message_id,
    delivery_id,
    job_type,
    status,
    available_at,
    attempt_count,
    idempotency_key,
    payload
  )
  select
    new.org_id,
    new.task_id,
    new.message_id,
    new.id,
    'send_message',
    'queued',
    clock_timestamp(),
    0,
    'task-notification:' || new.source_event_id::text,
    jsonb_build_object(
      'notificationEventId', new.source_event_id,
      'eventType', coalesce(
        new.provider_payload ->> 'eventType',
        source_event.event_type
      ),
      'target', new.provider_payload ->> 'target',
      'recipientKind', new.recipient_kind,
      'recipientId', coalesce(
        new.recipient_profile_id,
        new.recipient_contact_id
      ),
      'phase', 'reconcile',
      'retryDeliveryId', new.id,
      'retryAttemptCount', new.attempt_count
    )
  from public.task_events source_event
  join public.operational_tasks task
    on task.id = source_event.task_id
   and task.org_id = source_event.org_id
   and task.archived_at is null
  where source_event.id = new.source_event_id
    and source_event.task_id = new.task_id
    and source_event.org_id = new.org_id
  on conflict (org_id, idempotency_key) do update
  set
    message_id = excluded.message_id,
    delivery_id = excluded.delivery_id,
    status = 'queued',
    available_at = clock_timestamp(),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    attempt_count = 0,
    error_message = null,
    completed_at = null,
    payload = excluded.payload,
    updated_at = clock_timestamp()
  where existing_job.status in (
    'processing',
    'completed',
    'failed',
    'dead_letter',
    'cancelled'
  );

  return new;
end;
$$;

revoke all on function public.requeue_task_event_notification_after_resolution()
  from public, anon, authenticated;

drop trigger if exists trg_requeue_task_event_notification_after_resolution
  on public.task_message_deliveries;
create trigger trg_requeue_task_event_notification_after_resolution
after update of status on public.task_message_deliveries
for each row
when (
  old.status = 'ambiguous'
  and new.status = 'failed'
  and new.source_event_id is not null
)
execute function public.requeue_task_event_notification_after_resolution();

-- A dormant current recipient must still be able to activate their account
-- from an approved/cancelled notification. This does not reopen task actions:
-- portal write actor resolution retains its terminal-status guard. Preview and
-- accept continue to require this exact task/contact/grant, while only a
-- SHA-256 hash (never the plaintext token) is stored here.
create or replace function public.rotate_task_recipient_activation(
  p_contact_id uuid,
  p_task_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.task_recipient_activation_tokens
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  identity_row public.task_recipient_identities%rowtype;
  contact_row public.organization_contacts%rowtype;
  token_row public.task_recipient_activation_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_ROTATE_FORBIDDEN';
  end if;

  if p_contact_id is null
    or p_task_id is null
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_ACTIVATION_INPUT_INVALID';
  end if;

  -- Preserve the canonical task -> contact/identity lock order.
  perform 1
  from public.operational_tasks task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_TASK_FORBIDDEN';
  end if;

  identity_row := public.ensure_task_recipient_identity_for_contact(p_contact_id);

  select contact.*
  into contact_row
  from public.organization_contacts contact
  join public.operational_tasks task
    on task.id = p_task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
  where contact.id = p_contact_id
    and contact.is_active = true
    and contact.recipient_identity_id = identity_row.id
    and task.archived_at is null
  for update of contact, task;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_TASK_FORBIDDEN';
  end if;

  if identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
  end if;

  insert into public.task_recipient_portal_grants as existing_grant (
    recipient_identity_id,
    org_id,
    contact_id,
    task_id,
    grant_role
  )
  values (
    identity_row.id,
    contact_row.org_id,
    contact_row.id,
    p_task_id,
    'assignee'
  )
  on conflict (task_id, recipient_identity_id, contact_id) do update
  set
    revoked_at = null,
    revocation_reason = null,
    granted_at = case
      when existing_grant.revoked_at is not null then now()
      else existing_grant.granted_at
    end,
    updated_at = now();

  insert into public.task_recipient_activation_tokens (
    recipient_identity_id,
    contact_id,
    task_id,
    token_hash,
    expires_at
  )
  values (
    identity_row.id,
    p_contact_id,
    p_task_id,
    p_token_hash,
    p_expires_at
  )
  returning * into token_row;

  update public.task_recipient_identities identity
  set
    status = case
      when identity.status = 'dormant' then 'invited'
      else identity.status
    end,
    invited_at = coalesce(identity.invited_at, now()),
    updated_at = now()
  where identity.id = identity_row.id
    and identity.status <> 'disabled';

  return token_row;
end;
$$;

revoke all on function public.rotate_task_recipient_activation(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.rotate_task_recipient_activation(
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

-- ---------------------------------------------------------------------
-- Prefer immediate human-event messages over periodic evaluations
-- ---------------------------------------------------------------------

create or replace function public.claim_task_automation_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_stale_after interval default interval '15 minutes'
)
returns setof jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  stale_job record;
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

  -- A final-attempt worker can die after reserving a provider call but before
  -- recording its outcome. Lock job -> delivery, matching task archiving and
  -- the task -> job -> delivery reconciliation wrapper above. Both human-event
  -- and periodic reminder providers use the same sending reservation and must
  -- become operator-reconcilable before their final job is dead-lettered.
  for stale_job in
    select
      job.id,
      job.org_id,
      job.task_id,
      job.job_type,
      job.delivery_id,
      job.payload
    from public.task_automation_jobs job
    where job.status = 'processing'
      and coalesce(job.heartbeat_at, job.locked_at) < now() - p_stale_after
      and job.attempt_count >= job.max_attempts
    order by job.id
    for update of job skip locked
  loop
    update public.task_message_deliveries delivery
    set
      status = 'ambiguous',
      failed_at = null,
      next_attempt_at = null,
      error_message = 'TASK_DELIVERY_RECONCILIATION_REQUIRED'
    where delivery.org_id = stale_job.org_id
      and delivery.task_id = stale_job.task_id
      and delivery.status = 'sending'
      and (
        (
          stale_job.job_type = 'send_message'
          and (
            (stale_job.delivery_id is not null and delivery.id = stale_job.delivery_id)
            or (
              delivery.source_event_id is not null
              and delivery.source_event_id::text
                = stale_job.payload ->> 'notificationEventId'
            )
          )
        )
        or (
          stale_job.job_type = 'evaluate_followup'
          and exists (
            select 1
            from public.task_messages message
            where message.id = delivery.message_id
              and message.org_id = stale_job.org_id
              and message.task_id = stale_job.task_id
              and message.metadata ->> 'jobId' = stale_job.id::text
          )
        )
      );

    update public.task_automation_jobs job
    set
      status = 'dead_letter',
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = coalesce(job.error_message, 'TASK_WORKER_STALE_AFTER_FINAL_ATTEMPT')
    where job.id = stale_job.id
      and job.status = 'processing';
  end loop;

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
    order by
      case when job.job_type = 'send_message' then 0 else 1 end,
      job.available_at,
      job.created_at,
      job.id
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

revoke all on function public.claim_task_automation_jobs(text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_task_automation_jobs(text, integer, interval)
  to service_role;

-- The queue's critical ordering now includes job_type priority. The partial
-- expression index keeps the claim bounded without changing queue semantics.
create index if not exists task_automation_jobs_claim_priority_idx
  on public.task_automation_jobs (
    (case when job_type = 'send_message' then 0 else 1 end),
    available_at,
    created_at,
    id
  )
  include (attempt_count, max_attempts)
  where status in ('queued', 'failed');
