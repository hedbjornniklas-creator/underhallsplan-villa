-- Uppdrag: recipient-wide digests for automatic email reminders.
--
-- Prerequisites:
--   2026-08-27_02_task_reminder_schedule_and_supabase_cron.sql
--   2026-08-27_04_task_event_notifications.sql
--
-- This migration deliberately does not create another cron job. The existing
-- five-minute /api/cron/tasks/followup dispatcher claims both the established
-- task automation queue and these digest batches after the application rollout.
-- Human business-event notifications and initial assignments remain immediate.

-- ---------------------------------------------------------------------
-- Organization digest policy
-- ---------------------------------------------------------------------

alter table public.task_organization_settings
  add column if not exists reminder_digest_enabled boolean not null default true,
  add column if not exists reminder_digest_send_times time without time zone[]
    not null default array[time '08:00', time '15:00'],
  add column if not exists reminder_digest_min_interval_hours smallint
    not null default 4,
  add column if not exists reminder_digest_collection_minutes smallint
    not null default 10,
  add column if not exists reminder_same_task_cooldown_hours smallint
    not null default 24,
  add column if not exists reminder_digest_max_visible_items smallint
    not null default 10;

-- Preserve the 08:00/15:00 defaults whenever the existing organization window
-- permits them. A previously customized narrow window receives one safe slot at
-- its own start instead of making this migration or the next settings update fail.
update public.task_organization_settings settings
set reminder_digest_send_times = array[settings.reminder_send_window_start]
where settings.reminder_digest_send_times = array[time '08:00', time '15:00']
  and not (
  time '08:00' >= settings.reminder_send_window_start
  and time '08:00' < settings.reminder_send_window_end
  and time '15:00' >= settings.reminder_send_window_start
  and time '15:00' < settings.reminder_send_window_end
);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_digest_interval_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_digest_interval_check
      check (reminder_digest_min_interval_hours between 1 and 24);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_digest_collection_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_digest_collection_check
      check (reminder_digest_collection_minutes between 1 and 30);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_digest_cooldown_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_digest_cooldown_check
      check (reminder_same_task_cooldown_hours between 1 and 168);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_digest_visible_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_digest_visible_check
      check (reminder_digest_max_visible_items between 1 and 100);
  end if;
end
$$;

create or replace function public.validate_task_organization_reminder_digest()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  normalized_times time without time zone[];
  adjacent_gap_seconds numeric;
begin
  if new.reminder_digest_send_times is null
    or cardinality(new.reminder_digest_send_times) not between 1 and 6
    or exists (
      select 1
      from pg_catalog.unnest(new.reminder_digest_send_times) send_time
      where send_time is null
    )
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_SEND_TIMES_INVALID';
  end if;

  select pg_catalog.array_agg(distinct send_time order by send_time)
  into normalized_times
  from pg_catalog.unnest(new.reminder_digest_send_times) send_time;

  if normalized_times is null or cardinality(normalized_times) not between 1 and 6 then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_SEND_TIMES_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(normalized_times) send_time
    where send_time < new.reminder_send_window_start
       or send_time >= new.reminder_send_window_end
  ) then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_SEND_TIME_OUTSIDE_WINDOW';
  end if;

  select pg_catalog.min(
    extract(epoch from (ordered.next_time - ordered.send_time))
  )
  into adjacent_gap_seconds
  from (
    select
      send_time,
      pg_catalog.lead(send_time) over (order by send_time) as next_time
    from pg_catalog.unnest(normalized_times) send_time
  ) ordered
  where ordered.next_time is not null;

  if adjacent_gap_seconds is not null
    and adjacent_gap_seconds < new.reminder_digest_min_interval_hours * 3600
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_INTERVAL_TOO_SHORT';
  end if;

  new.reminder_digest_send_times := normalized_times;
  return new;
end;
$$;

revoke all on function public.validate_task_organization_reminder_digest()
  from public, anon, authenticated;

drop trigger if exists trg_validate_task_organization_reminder_digest
  on public.task_organization_settings;
create trigger trg_validate_task_organization_reminder_digest
before insert or update of
  reminder_send_window_start,
  reminder_send_window_end,
  reminder_digest_send_times,
  reminder_digest_min_interval_hours,
  reminder_digest_collection_minutes,
  reminder_same_task_cooldown_hours,
  reminder_digest_max_visible_items
on public.task_organization_settings
for each row execute function public.validate_task_organization_reminder_digest();

-- ---------------------------------------------------------------------
-- Durable digest outbox
-- ---------------------------------------------------------------------

create table if not exists public.task_reminder_digest_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipient_kind text not null,
  recipient_profile_id uuid references public.profiles (id) on delete restrict,
  recipient_contact_id uuid references public.organization_contacts (id) on delete restrict,
  recipient_address text not null,
  channel text not null default 'email',
  scheduled_at timestamptz not null,
  available_at timestamptz not null,
  status text not null default 'queued',
  subject text,
  provider text not null default 'resend',
  provider_message_id text,
  provider_call_started boolean not null default false,
  provider_payload jsonb not null default '{"tokenPersisted":false}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  error_message text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_reminder_digest_batches_recipient_shape_check
    check (
      (recipient_kind = 'profile'
        and recipient_profile_id is not null
        and recipient_contact_id is null)
      or
      (recipient_kind = 'contact'
        and recipient_contact_id is not null
        and recipient_profile_id is null)
    ),
  constraint task_reminder_digest_batches_address_check
    check (btrim(recipient_address) <> ''),
  constraint task_reminder_digest_batches_channel_check
    check (channel = 'email'),
  constraint task_reminder_digest_batches_status_check
    check (status in (
      'queued', 'processing', 'sent', 'failed', 'ambiguous',
      'cancelled', 'dead_letter'
    )),
  constraint task_reminder_digest_batches_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint task_reminder_digest_batches_lock_check
    check (
      (
        status = 'processing'
        and locked_at is not null
        and nullif(btrim(coalesce(locked_by, '')), '') is not null
      )
      or (
        status <> 'processing'
        and locked_at is null
        and locked_by is null
        and heartbeat_at is null
      )
    ),
  constraint task_reminder_digest_batches_provider_started_check
    check (not provider_call_started or status in ('processing', 'ambiguous', 'sent')),
  constraint task_reminder_digest_batches_sent_shape_check
    check (
      status <> 'sent'
      or (
        sent_at is not null
        and nullif(btrim(coalesce(provider_message_id, '')), '') is not null
        and nullif(btrim(coalesce(subject, '')), '') is not null
      )
    ),
  constraint task_reminder_digest_batches_idempotency_check
    check (btrim(idempotency_key) <> ''),
  constraint task_reminder_digest_batches_payload_check
    check (
      jsonb_typeof(provider_payload) = 'object'
      and provider_payload ->> 'tokenPersisted' = 'false'
      and not public.task_notification_json_contains_secret(provider_payload)
    ),
  constraint task_reminder_digest_batches_org_idempotency_unique
    unique (org_id, idempotency_key)
);

create unique index if not exists task_reminder_digest_batches_id_org_unique_idx
  on public.task_reminder_digest_batches (id, org_id);

create index if not exists task_reminder_digest_batches_due_idx
  on public.task_reminder_digest_batches (available_at, scheduled_at, created_at, id)
  include (attempt_count, max_attempts)
  where status in ('queued', 'failed');

create index if not exists task_reminder_digest_batches_stale_idx
  on public.task_reminder_digest_batches ((coalesce(heartbeat_at, locked_at)), id)
  include (attempt_count, max_attempts, provider_call_started)
  where status = 'processing';

create index if not exists task_reminder_digest_batches_profile_history_idx
  on public.task_reminder_digest_batches (org_id, recipient_profile_id, sent_at desc, id)
  where recipient_kind = 'profile' and status = 'sent';

create index if not exists task_reminder_digest_batches_contact_history_idx
  on public.task_reminder_digest_batches (org_id, recipient_contact_id, sent_at desc, id)
  where recipient_kind = 'contact' and status = 'sent';

create table if not exists public.task_reminder_digest_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  task_version integer not null,
  source_job_id uuid references public.task_automation_jobs (id) on delete set null,
  target text not null,
  action_kind text not null,
  reason text not null,
  policy_action_idempotency_key text not null,
  body_text text not null,
  metadata jsonb not null default '{"tokenPersisted":false}'::jsonb,
  status text not null default 'pending',
  message_id uuid references public.task_messages (id) on delete set null,
  delivery_id uuid references public.task_message_deliveries (id) on delete set null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_reminder_digest_items_batch_scope_fkey
    foreign key (batch_id, org_id)
    references public.task_reminder_digest_batches (id, org_id)
    on delete cascade,
  constraint task_reminder_digest_items_version_check
    check (task_version > 0),
  constraint task_reminder_digest_items_target_check
    check (target in ('creator', 'assignee')),
  constraint task_reminder_digest_items_action_check
    check (action_kind in (
      'status_check', 'due_soon', 'due_today', 'overdue',
      'review_follow_up', 'review_overdue',
      'deadline_change_request', 'escalation'
    )),
  constraint task_reminder_digest_items_reason_check
    check (btrim(reason) <> ''),
  constraint task_reminder_digest_items_policy_key_check
    check (btrim(policy_action_idempotency_key) <> ''),
  constraint task_reminder_digest_items_body_check
    check (
      btrim(body_text) <> ''
      and length(body_text) <= 10000
      and not public.task_notification_json_contains_secret(to_jsonb(body_text))
    ),
  constraint task_reminder_digest_items_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and metadata ->> 'tokenPersisted' = 'false'
      and not public.task_notification_json_contains_secret(metadata)
    ),
  constraint task_reminder_digest_items_status_check
    check (status in ('pending', 'processing', 'sent', 'cancelled')),
  constraint task_reminder_digest_items_sent_shape_check
    check (
      (status = 'sent' and sent_at is not null and message_id is not null and delivery_id is not null)
      or (status <> 'sent' and sent_at is null)
    ),
  constraint task_reminder_digest_items_cancel_shape_check
    check (
      (status = 'cancelled' and cancelled_at is not null and nullif(btrim(coalesce(cancel_reason, '')), '') is not null)
      or (status <> 'cancelled' and cancelled_at is null and cancel_reason is null)
    ),
  constraint task_reminder_digest_items_org_policy_unique
    unique (org_id, policy_action_idempotency_key)
);

create index if not exists task_reminder_digest_items_batch_status_idx
  on public.task_reminder_digest_items (batch_id, status, created_at, id);

create index if not exists task_reminder_digest_items_task_status_idx
  on public.task_reminder_digest_items (task_id, task_version, status, created_at desc);

create index if not exists task_reminder_digest_items_source_job_idx
  on public.task_reminder_digest_items (source_job_id)
  where source_job_id is not null;

drop trigger if exists trg_task_reminder_digest_batches_set_updated_at
  on public.task_reminder_digest_batches;
create trigger trg_task_reminder_digest_batches_set_updated_at
before update on public.task_reminder_digest_batches
for each row execute function public.operational_tasks_set_updated_at();

drop trigger if exists trg_task_reminder_digest_items_set_updated_at
  on public.task_reminder_digest_items;
create trigger trg_task_reminder_digest_items_set_updated_at
before update on public.task_reminder_digest_items
for each row execute function public.operational_tasks_set_updated_at();

create or replace function public.validate_task_reminder_digest_item_scope()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
begin
  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = new.batch_id;

  if not found or batch_row.org_id <> new.org_id then
    raise exception using
      errcode = '23514',
      message = 'TASK_REMINDER_DIGEST_BATCH_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from public.operational_tasks task
    where task.id = new.task_id
      and task.org_id = new.org_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_REMINDER_DIGEST_TASK_SCOPE_INVALID';
  end if;

  if new.source_job_id is not null and not exists (
    select 1
    from public.task_automation_jobs job
    where job.id = new.source_job_id
      and job.org_id = new.org_id
      and job.task_id = new.task_id
      and job.job_type = 'evaluate_followup'
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_REMINDER_DIGEST_JOB_SCOPE_INVALID';
  end if;

  if new.message_id is not null and not exists (
    select 1
    from public.task_messages message
    where message.id = new.message_id
      and message.org_id = new.org_id
      and message.task_id = new.task_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_REMINDER_DIGEST_MESSAGE_SCOPE_INVALID';
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
      message = 'TASK_REMINDER_DIGEST_DELIVERY_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_task_reminder_digest_item_scope()
  from public, anon, authenticated;

drop trigger if exists trg_validate_task_reminder_digest_item_scope
  on public.task_reminder_digest_items;
create trigger trg_validate_task_reminder_digest_item_scope
before insert or update on public.task_reminder_digest_items
for each row execute function public.validate_task_reminder_digest_item_scope();

alter table public.task_reminder_digest_batches enable row level security;
alter table public.task_reminder_digest_items enable row level security;

revoke all on table public.task_reminder_digest_batches
  from public, anon, authenticated;
revoke all on table public.task_reminder_digest_items
  from public, anon, authenticated;
grant select, insert, update, delete on table public.task_reminder_digest_batches
  to service_role;
grant select, insert, update, delete on table public.task_reminder_digest_items
  to service_role;

comment on table public.task_reminder_digest_batches is
  'Service-only provider outbox. One row represents one actual multi-task email attempt for one organization and recipient.';
comment on table public.task_reminder_digest_items is
  'Service-only per-task automatic reminder intent. Successful batches project one logical task message/delivery per item for existing cadence and audit views.';

-- Returns the next configured local digest slot strictly after the candidate.
-- Strict ordering prevents a late enqueue from joining a batch that the worker
-- may already have claimed at that exact slot.
create or replace function public.task_next_reminder_digest_at(
  p_org_id uuid,
  p_candidate_at timestamptz default clock_timestamp()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  settings_row public.task_organization_settings%rowtype;
  local_candidate timestamp without time zone;
  candidate_date date;
  target_date date;
  target_local timestamp without time zone;
  target_at timestamptz;
  send_time time without time zone;
  day_offset integer;
begin
  if p_org_id is null or p_candidate_at is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_SCHEDULE_ARGUMENT_INVALID';
  end if;

  select settings.*
  into settings_row
  from public.task_organization_settings settings
  where settings.org_id = p_org_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_ORGANIZATION_SETTINGS_NOT_FOUND';
  end if;

  if not settings_row.reminder_digest_enabled then
    return null;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_name
    where timezone_name.name = settings_row.timezone
  ) then
    raise exception using
      errcode = '22023',
      message = 'TASK_ORGANIZATION_TIMEZONE_INVALID';
  end if;

  local_candidate := p_candidate_at at time zone settings_row.timezone;
  candidate_date := local_candidate::date;

  for day_offset in 0..14 loop
    target_date := candidate_date + day_offset;
    if not (
      extract(isodow from target_date)::smallint
        = any(settings_row.reminder_send_weekdays)
    ) then
      continue;
    end if;

    for send_time in
      select configured_time
      from pg_catalog.unnest(settings_row.reminder_digest_send_times) configured_time
      order by configured_time
    loop
      target_local := target_date + send_time;
      target_at := target_local at time zone settings_row.timezone;
      if target_at > p_candidate_at then
        return target_at;
      end if;
    end loop;
  end loop;

  raise exception using
    errcode = '22023',
    message = 'TASK_REMINDER_DIGEST_SCHEDULE_UNRESOLVABLE';
end;
$$;

revoke all on function public.task_next_reminder_digest_at(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.task_next_reminder_digest_at(uuid, timestamptz)
  to service_role;

-- Atomically places one automatic email reminder into the recipient's next
-- digest. The caller supplies only an audit-safe body; URLs and credentials are
-- created at send time and must never be persisted in this outbox.
create or replace function public.enqueue_task_reminder_digest_item(
  p_org_id uuid,
  p_task_id uuid,
  p_task_version integer,
  p_recipient_kind text,
  p_recipient_id uuid,
  p_recipient_address text,
  p_target text,
  p_action_kind text,
  p_reason text,
  p_policy_action_idempotency_key text,
  p_body_text text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  settings_row public.task_organization_settings%rowtype;
  existing_item public.task_reminder_digest_items%rowtype;
  batch_row public.task_reminder_digest_batches%rowtype;
  outstanding_row record;
  canonical_address text;
  supplied_address text := pg_catalog.lower(nullif(btrim(coalesce(p_recipient_address, '')), ''));
  recipient_kind_value text := pg_catalog.lower(btrim(coalesce(p_recipient_kind, '')));
  target_value text := pg_catalog.lower(btrim(coalesce(p_target, '')));
  action_kind_value text := pg_catalog.lower(btrim(coalesce(p_action_kind, '')));
  reason_value text := btrim(coalesce(p_reason, ''));
  policy_key_value text := btrim(coalesce(p_policy_action_idempotency_key, ''));
  body_value text := btrim(coalesce(p_body_text, ''));
  cooldown_until timestamptz;
  recipient_throttle_until timestamptz;
  enqueue_at timestamptz := clock_timestamp();
  collection_interval interval;
  schedule_candidate timestamptz;
  digest_at timestamptz;
  batch_key text;
  slot_attempt integer;
  item_inserted boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_ENQUEUE_FORBIDDEN';
  end if;

  if p_org_id is null
    or p_task_id is null
    or p_task_version is null
    or p_task_version < 1
    or p_recipient_id is null
    or p_job_id is null
    or recipient_kind_value not in ('profile', 'contact')
    or target_value not in ('creator', 'assignee')
    or action_kind_value not in (
      'status_check', 'due_soon', 'due_today', 'overdue',
      'review_follow_up', 'review_overdue',
      'deadline_change_request', 'escalation'
    )
    or reason_value = ''
    or policy_key_value = ''
    or length(policy_key_value) > 1000
    or body_value = ''
    or length(body_value) > 10000
    or supplied_address is null
    or public.task_notification_json_contains_secret(to_jsonb(body_value))
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_ENQUEUE_ARGUMENT_INVALID';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.org_id = p_org_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_TASK_NOT_FOUND';
  end if;

  if task_row.version <> p_task_version
    or task_row.archived_at is not null
    or task_row.status in ('draft', 'approved', 'cancelled')
  then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'task_stale',
      'taskId', task_row.id,
      'taskVersion', task_row.version
    );
  end if;

  if not exists (
    select 1
    from public.task_automation_jobs job
    where job.id = p_job_id
      and job.org_id = p_org_id
      and job.task_id = p_task_id
      and job.job_type = 'evaluate_followup'
      and job.status = 'processing'
  ) then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_JOB_NOT_PROCESSING';
  end if;

  if target_value = 'creator' then
    if recipient_kind_value <> 'profile'
      or task_row.issuer_profile_id <> p_recipient_id
    then
      raise exception using
        errcode = '23514',
        message = 'TASK_REMINDER_DIGEST_RECIPIENT_MISMATCH';
    end if;
  elsif recipient_kind_value = 'profile' then
    if task_row.assignee_profile_id <> p_recipient_id then
      raise exception using
        errcode = '23514',
        message = 'TASK_REMINDER_DIGEST_RECIPIENT_MISMATCH';
    end if;
  elsif task_row.assignee_contact_id <> p_recipient_id then
    raise exception using
      errcode = '23514',
      message = 'TASK_REMINDER_DIGEST_RECIPIENT_MISMATCH';
  end if;

  if recipient_kind_value = 'profile' then
    select pg_catalog.lower(nullif(btrim(profile.email), ''))
    into canonical_address
    from public.profiles profile
    where profile.id = p_recipient_id
      and exists (
        select 1
        from public.org_members member
        where member.org_id = p_org_id
          and member.profile_id = profile.id
          and member.is_active = true
      )
      and public.task_profile_has_module_access(p_org_id, profile.id);
  else
    select pg_catalog.lower(nullif(btrim(contact.email), ''))
    into canonical_address
    from public.organization_contacts contact
    left join public.task_recipient_identities identity
      on identity.id = contact.recipient_identity_id
    where contact.id = p_recipient_id
      and contact.org_id = p_org_id
      and contact.is_active = true
      and coalesce(identity.status <> 'disabled', true);
  end if;

  if canonical_address is null or canonical_address <> supplied_address then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_RECIPIENT_ADDRESS_CHANGED';
  end if;

  select settings.*
  into settings_row
  from public.task_organization_settings settings
  where settings.org_id = p_org_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_ORGANIZATION_SETTINGS_NOT_FOUND';
  end if;

  if not settings_row.reminder_digest_enabled then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'digest_disabled',
      'taskId', task_row.id
    );
  end if;

  collection_interval := pg_catalog.make_interval(
    mins => settings_row.reminder_digest_collection_minutes
  );
  -- The slot stays open for the configured collection grace. The additional
  -- six minutes covers one five-minute cron cadence plus scheduling margin.
  schedule_candidate := enqueue_at - collection_interval - interval '6 minutes';

  select pg_catalog.max(sent_batch.sent_at)
    + pg_catalog.make_interval(hours => settings_row.reminder_digest_min_interval_hours)
  into recipient_throttle_until
  from public.task_reminder_digest_batches sent_batch
  where sent_batch.org_id = p_org_id
    and sent_batch.status = 'sent'
    and sent_batch.recipient_kind = recipient_kind_value
    and (
      (recipient_kind_value = 'profile' and sent_batch.recipient_profile_id = p_recipient_id)
      or
      (recipient_kind_value = 'contact' and sent_batch.recipient_contact_id = p_recipient_id)
    );

  if recipient_throttle_until is not null
    and recipient_throttle_until > enqueue_at
  then
    -- task_next_reminder_digest_at is deliberately strict. One microsecond lets
    -- an exact future configured slot remain eligible at the throttle boundary.
    schedule_candidate := greatest(
      schedule_candidate,
      recipient_throttle_until - collection_interval - interval '1 microsecond'
    );
  end if;

  -- The task row lock serializes different policy keys for the same task. Never
  -- create a second automatic intent while an earlier digest outcome is pending
  -- or unknown; the batch retry/reconciliation path owns that reminder.
  select
    item.id as item_id,
    item.batch_id,
    item.status as item_status,
    batch.status as batch_status
  into outstanding_row
  from public.task_reminder_digest_items item
  join public.task_reminder_digest_batches batch
    on batch.id = item.batch_id
   and batch.org_id = item.org_id
  where item.org_id = p_org_id
    and item.task_id = p_task_id
    and item.status in ('pending', 'processing')
    and batch.status in ('queued', 'failed', 'processing', 'ambiguous')
  order by
    case batch.status
      when 'ambiguous' then 0
      when 'processing' then 1
      when 'failed' then 2
      when 'queued' then 3
      else 4
    end,
    item.created_at,
    item.id
  limit 1;

  if found then
    return jsonb_build_object(
      'skipped', true,
      'reason', case
        when outstanding_row.batch_status in ('ambiguous', 'processing') then 'digest_unresolved'
        else 'digest_pending'
      end,
      'taskId', task_row.id,
      'itemId', outstanding_row.item_id,
      'batchId', outstanding_row.batch_id,
      'batchStatus', outstanding_row.batch_status
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || policy_key_value, 0)
  );

  select item.*
  into existing_item
  from public.task_reminder_digest_items item
  where item.org_id = p_org_id
    and item.policy_action_idempotency_key = policy_key_value
  for update;

  if found and existing_item.task_id <> p_task_id then
    raise exception using
      errcode = '23505',
      message = 'TASK_REMINDER_DIGEST_POLICY_KEY_SCOPE_CONFLICT';
  elsif found and existing_item.status = 'sent' then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'already_sent',
      'taskId', task_row.id,
      'itemId', existing_item.id,
      'batchId', existing_item.batch_id,
      'sentAt', existing_item.sent_at
    );
  elsif found and existing_item.status <> 'cancelled' then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'digest_pending',
      'taskId', task_row.id,
      'itemId', existing_item.id,
      'batchId', existing_item.batch_id,
      'itemStatus', existing_item.status
    );
  end if;

  select pg_catalog.max(item.sent_at)
    + pg_catalog.make_interval(hours => settings_row.reminder_same_task_cooldown_hours)
  into cooldown_until
  from public.task_reminder_digest_items item
  join public.task_reminder_digest_batches batch
    on batch.id = item.batch_id
   and batch.org_id = item.org_id
  where item.org_id = p_org_id
    and item.task_id = p_task_id
    and item.status = 'sent'
    and batch.recipient_kind = recipient_kind_value
    and (
      (recipient_kind_value = 'profile' and batch.recipient_profile_id = p_recipient_id)
      or
      (recipient_kind_value = 'contact' and batch.recipient_contact_id = p_recipient_id)
    );

  if cooldown_until is not null and cooldown_until > enqueue_at then
    schedule_candidate := greatest(
      schedule_candidate,
      cooldown_until - collection_interval - interval '1 microsecond'
    );
  end if;

  batch_row := null;
  for slot_attempt in 1..8 loop
    digest_at := public.task_next_reminder_digest_at(p_org_id, schedule_candidate);
    if digest_at is null then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'digest_disabled',
        'taskId', task_row.id
      );
    end if;

    batch_key := 'task-reminder-digest-v1:'
      || recipient_kind_value || ':' || p_recipient_id::text
      || ':email:'
      || pg_catalog.to_char(
        digest_at at time zone 'UTC',
        'YYYYMMDDHH24MISSUS'
      );

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org_id::text || ':' || batch_key, 0)
    );

    insert into public.task_reminder_digest_batches (
      org_id,
      recipient_kind,
      recipient_profile_id,
      recipient_contact_id,
      recipient_address,
      channel,
      scheduled_at,
      available_at,
      status,
      provider,
      provider_payload,
      idempotency_key
    )
    values (
      p_org_id,
      recipient_kind_value,
      case when recipient_kind_value = 'profile' then p_recipient_id else null end,
      case when recipient_kind_value = 'contact' then p_recipient_id else null end,
      canonical_address,
      'email',
      digest_at,
      digest_at + collection_interval,
      'queued',
      'resend',
      jsonb_build_object('tokenPersisted', false),
      batch_key
    )
    on conflict (org_id, idempotency_key) do nothing;

    select batch.*
    into batch_row
    from public.task_reminder_digest_batches batch
    where batch.org_id = p_org_id
      and batch.idempotency_key = batch_key
    for update;

    if found
      and batch_row.status = 'queued'
      and not batch_row.provider_call_started
      and batch_row.recipient_kind = recipient_kind_value
      and (
        (recipient_kind_value = 'profile' and batch_row.recipient_profile_id = p_recipient_id)
        or
        (recipient_kind_value = 'contact' and batch_row.recipient_contact_id = p_recipient_id)
      )
    then
      if batch_row.recipient_address is distinct from canonical_address then
        update public.task_reminder_digest_batches batch
        set
          recipient_address = canonical_address,
          available_at = greatest(
            batch.available_at,
            batch.scheduled_at + collection_interval
          )
        where batch.id = batch_row.id
        returning * into batch_row;
      elsif batch_row.available_at < batch_row.scheduled_at + collection_interval then
        update public.task_reminder_digest_batches batch
        set available_at = batch.scheduled_at + collection_interval
        where batch.id = batch_row.id
        returning * into batch_row;
      end if;
      exit;
    end if;

    batch_row := null;
    schedule_candidate := digest_at + interval '1 microsecond';
  end loop;

  if batch_row.id is null then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_BATCH_UNAVAILABLE';
  end if;

  if existing_item.id is not null and existing_item.status = 'cancelled' then
    update public.task_reminder_digest_items item
    set
      batch_id = batch_row.id,
      task_version = p_task_version,
      source_job_id = p_job_id,
      target = target_value,
      action_kind = action_kind_value,
      reason = reason_value,
      body_text = body_value,
      metadata = jsonb_build_object(
        'target', target_value,
        'recipientKind', recipient_kind_value,
        'recipientId', p_recipient_id,
        'actionKind', action_kind_value,
        'reason', reason_value,
        'policyActionIdempotencyKey', policy_key_value,
        'sourceJobId', p_job_id,
        'tokenPersisted', false
      ),
      status = 'pending',
      message_id = null,
      delivery_id = null,
      sent_at = null,
      cancelled_at = null,
      cancel_reason = null
    where item.id = existing_item.id
    returning * into existing_item;
  else
    insert into public.task_reminder_digest_items (
      batch_id,
      org_id,
      task_id,
      task_version,
      source_job_id,
      target,
      action_kind,
      reason,
      policy_action_idempotency_key,
      body_text,
      metadata,
      status
    )
    values (
      batch_row.id,
      p_org_id,
      p_task_id,
      p_task_version,
      p_job_id,
      target_value,
      action_kind_value,
      reason_value,
      policy_key_value,
      body_value,
      jsonb_build_object(
        'target', target_value,
        'recipientKind', recipient_kind_value,
        'recipientId', p_recipient_id,
        'actionKind', action_kind_value,
        'reason', reason_value,
        'policyActionIdempotencyKey', policy_key_value,
        'sourceJobId', p_job_id,
        'tokenPersisted', false
      ),
      'pending'
    )
    returning * into existing_item;
    item_inserted := true;
  end if;

  return jsonb_build_object(
    'skipped', false,
    'taskId', task_row.id,
    'taskVersion', task_row.version,
    'itemId', existing_item.id,
    'itemStatus', existing_item.status,
    'batchId', batch_row.id,
    'batchStatus', batch_row.status,
    'scheduledAt', batch_row.scheduled_at,
    'recipientKind', batch_row.recipient_kind,
    'recipientId', p_recipient_id,
    'recipientAddress', batch_row.recipient_address,
    'channel', batch_row.channel,
    'isNew', item_inserted
  );
end;
$$;

revoke all on function public.enqueue_task_reminder_digest_item(
  uuid, uuid, integer, text, uuid, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.enqueue_task_reminder_digest_item(
  uuid, uuid, integer, text, uuid, text, text, text, text, text, text, uuid
) to service_role;

-- User activity, a deadline/status mutation or reassignment increments the task
-- version. Cancel every not-yet-sent old-version intent immediately. A provider
-- call that has already started is deliberately left for reconciliation because
-- its delivery outcome may be unknown.
create or replace function public.cancel_stale_task_reminder_digest_items()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  affected_batch_ids uuid[];
begin
  select pg_catalog.array_agg(distinct item.batch_id)
  into affected_batch_ids
  from public.task_reminder_digest_items item
  join public.task_reminder_digest_batches batch
    on batch.id = item.batch_id
   and batch.org_id = item.org_id
  where item.task_id = new.id
    and item.org_id = new.org_id
    and item.status in ('pending', 'processing')
    and (
      item.status = 'pending'
      or not batch.provider_call_started
    )
    and (
      item.task_version <> new.version
      or new.archived_at is not null
      or new.status in ('draft', 'approved', 'cancelled')
      or (
        item.target = 'creator'
        and (
          batch.recipient_kind <> 'profile'
          or batch.recipient_profile_id <> new.issuer_profile_id
        )
      )
      or (
        item.target = 'assignee'
        and (
          (batch.recipient_kind = 'profile'
            and batch.recipient_profile_id is distinct from new.assignee_profile_id)
          or
          (batch.recipient_kind = 'contact'
            and batch.recipient_contact_id is distinct from new.assignee_contact_id)
        )
      )
    );

  if affected_batch_ids is null then
    return new;
  end if;

  update public.task_reminder_digest_items item
  set
    status = 'cancelled',
    cancelled_at = clock_timestamp(),
    cancel_reason = 'task_changed'
  from public.task_reminder_digest_batches batch
  where item.batch_id = batch.id
    and item.task_id = new.id
    and item.org_id = new.org_id
    and item.status in ('pending', 'processing')
    and (
      item.status = 'pending'
      or not batch.provider_call_started
    )
    and item.batch_id = any(affected_batch_ids);

  update public.task_reminder_digest_batches batch
  set
    status = 'cancelled',
    provider_call_started = false,
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    error_message = 'TASK_REMINDER_DIGEST_ALL_ITEMS_STALE',
    resolved_at = clock_timestamp(),
    resolution_note = 'All pending items were cancelled after a task mutation.'
  where batch.id = any(affected_batch_ids)
    and batch.status in ('queued', 'failed', 'processing')
    and not batch.provider_call_started
    and not exists (
      select 1
      from public.task_reminder_digest_items remaining_item
      where remaining_item.batch_id = batch.id
        and remaining_item.status in ('pending', 'processing')
    );

  return new;
end;
$$;

revoke all on function public.cancel_stale_task_reminder_digest_items()
  from public, anon, authenticated;

drop trigger if exists trg_cancel_stale_task_reminder_digest_items
  on public.operational_tasks;
create trigger trg_cancel_stale_task_reminder_digest_items
after update of
  status,
  due_at,
  next_followup_at,
  last_activity_at,
  issuer_profile_id,
  assignee_profile_id,
  assignee_contact_id,
  archived_at
on public.operational_tasks
for each row execute function public.cancel_stale_task_reminder_digest_items();

-- Claim due recipient batches. Stale workers are recovered only when the
-- provider call had not begun; once it began, the outcome becomes ambiguous and
-- must be resolved explicitly before this recipient/task can be enqueued again.
create or replace function public.claim_task_reminder_digest_batches(
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
  worker_value text := btrim(coalesce(p_worker_id, ''));
  stale_batch record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_CLAIM_FORBIDDEN';
  end if;
  if worker_value = '' then
    raise exception using
      errcode = '22023',
      message = 'TASK_WORKER_ID_REQUIRED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_CLAIM_LIMIT_INVALID';
  end if;
  if p_stale_after is null
    or p_stale_after < interval '1 minute'
    or p_stale_after > interval '24 hours'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_WORKER_STALE_INTERVAL_INVALID';
  end if;

  update public.task_reminder_digest_batches batch
  set
    status = 'cancelled',
    error_message = 'TASK_REMINDER_DIGEST_NO_PENDING_ITEMS',
    resolved_at = clock_timestamp(),
    resolution_note = 'The batch contained no pending items when claimed.'
  where batch.status in ('queued', 'failed')
    and not exists (
      select 1
      from public.task_reminder_digest_items item
      where item.batch_id = batch.id
        and item.status = 'pending'
    );

  for stale_batch in
    select batch.id, batch.provider_call_started, batch.attempt_count, batch.max_attempts
    from public.task_reminder_digest_batches batch
    where batch.status = 'processing'
      and coalesce(batch.heartbeat_at, batch.locked_at) < clock_timestamp() - p_stale_after
    order by batch.id
    for update skip locked
  loop
    if stale_batch.provider_call_started then
      update public.task_reminder_digest_batches batch
      set
        status = 'ambiguous',
        locked_at = null,
        locked_by = null,
        heartbeat_at = null,
        failed_at = clock_timestamp(),
        error_message = 'TASK_REMINDER_DIGEST_RECONCILIATION_REQUIRED'
      where batch.id = stale_batch.id;
    elsif stale_batch.attempt_count >= stale_batch.max_attempts then
      update public.task_reminder_digest_items item
      set
        status = 'cancelled',
        cancelled_at = clock_timestamp(),
        cancel_reason = 'digest_dead_letter'
      where item.batch_id = stale_batch.id
        and item.status in ('pending', 'processing');

      update public.task_reminder_digest_batches batch
      set
        status = 'dead_letter',
        provider_call_started = false,
        locked_at = null,
        locked_by = null,
        heartbeat_at = null,
        failed_at = clock_timestamp(),
        error_message = 'TASK_REMINDER_DIGEST_STALE_AFTER_FINAL_ATTEMPT'
      where batch.id = stale_batch.id;
    else
      update public.task_reminder_digest_items item
      set status = 'pending'
      where item.batch_id = stale_batch.id
        and item.status = 'processing';

      update public.task_reminder_digest_batches batch
      set
        status = 'failed',
        provider_call_started = false,
        available_at = clock_timestamp(),
        locked_at = null,
        locked_by = null,
        heartbeat_at = null,
        failed_at = clock_timestamp(),
        error_message = 'TASK_REMINDER_DIGEST_STALE_BEFORE_PROVIDER_CALL'
      where batch.id = stale_batch.id;
    end if;
  end loop;

  -- A retry or an older queued slot may become too early after another batch
  -- for the same recipient succeeds. Move it atomically to the first configured
  -- slot at or after the actual recipient-wide throttle boundary.
  with throttle_boundaries as (
    select
      batch.id,
      settings.reminder_digest_collection_minutes as collection_minutes,
      pg_catalog.max(sent_batch.sent_at)
        + pg_catalog.make_interval(hours => settings.reminder_digest_min_interval_hours)
        as throttle_until
    from public.task_reminder_digest_batches batch
    join public.task_organization_settings settings
      on settings.org_id = batch.org_id
     and settings.reminder_digest_enabled
    join public.task_reminder_digest_batches sent_batch
      on sent_batch.org_id = batch.org_id
     and sent_batch.id <> batch.id
     and sent_batch.status = 'sent'
     and sent_batch.recipient_kind = batch.recipient_kind
     and (
       (batch.recipient_kind = 'profile'
         and sent_batch.recipient_profile_id = batch.recipient_profile_id)
       or
       (batch.recipient_kind = 'contact'
         and sent_batch.recipient_contact_id = batch.recipient_contact_id)
     )
    where batch.status in ('queued', 'failed')
    group by
      batch.id,
      settings.reminder_digest_min_interval_hours,
      settings.reminder_digest_collection_minutes
  ), blocked as (
    select
      boundary.id,
      public.task_next_reminder_digest_at(
        batch.org_id,
        boundary.throttle_until
          - pg_catalog.make_interval(mins => boundary.collection_minutes)
          - interval '1 microsecond'
      ) + pg_catalog.make_interval(mins => boundary.collection_minutes)
        as next_allowed_at
    from throttle_boundaries boundary
    join public.task_reminder_digest_batches batch
      on batch.id = boundary.id
    where boundary.throttle_until > clock_timestamp()
  )
  update public.task_reminder_digest_batches batch
  set available_at = greatest(batch.available_at, blocked.next_allowed_at)
  from blocked
  where batch.id = blocked.id
    and blocked.next_allowed_at is not null;

  return query
  with eligible as (
    select
      batch.id,
      batch.org_id,
      batch.recipient_kind,
      batch.recipient_profile_id,
      batch.recipient_contact_id,
      batch.available_at,
      batch.scheduled_at,
      batch.created_at
    from public.task_reminder_digest_batches batch
    join public.task_organization_settings settings
      on settings.org_id = batch.org_id
     and settings.reminder_digest_enabled
    where batch.status in ('queued', 'failed')
      and batch.available_at <= clock_timestamp()
      and batch.scheduled_at <= clock_timestamp()
      and batch.attempt_count < batch.max_attempts
      and not exists (
        select 1
        from public.task_reminder_digest_batches active_batch
        where active_batch.org_id = batch.org_id
          and active_batch.id <> batch.id
          and active_batch.status in ('processing', 'ambiguous')
          and active_batch.recipient_kind = batch.recipient_kind
          and (
            (batch.recipient_kind = 'profile'
              and active_batch.recipient_profile_id = batch.recipient_profile_id)
            or
            (batch.recipient_kind = 'contact'
              and active_batch.recipient_contact_id = batch.recipient_contact_id)
          )
      )
      and not exists (
        select 1
        from public.task_reminder_digest_batches recent_batch
        where recent_batch.org_id = batch.org_id
          and recent_batch.id <> batch.id
          and recent_batch.status = 'sent'
          and recent_batch.recipient_kind = batch.recipient_kind
          and recent_batch.sent_at
            > clock_timestamp()
              - pg_catalog.make_interval(hours => settings.reminder_digest_min_interval_hours)
          and (
            (batch.recipient_kind = 'profile'
              and recent_batch.recipient_profile_id = batch.recipient_profile_id)
            or
            (batch.recipient_kind = 'contact'
              and recent_batch.recipient_contact_id = batch.recipient_contact_id)
          )
      )
      and exists (
        select 1
        from public.task_reminder_digest_items item
        where item.batch_id = batch.id
          and item.status = 'pending'
      )
  ), ranked as (
    select
      eligible.*,
      row_number() over (
        partition by
          eligible.org_id,
          eligible.recipient_kind,
          coalesce(eligible.recipient_profile_id, eligible.recipient_contact_id)
        order by
          eligible.available_at,
          eligible.scheduled_at,
          eligible.created_at,
          eligible.id
      ) as recipient_order
    from eligible
  ), candidates as (
    select batch.id
    from ranked
    join public.task_reminder_digest_batches batch
      on batch.id = ranked.id
    where ranked.recipient_order = 1
      and batch.status in ('queued', 'failed')
      and batch.available_at <= clock_timestamp()
      and batch.scheduled_at <= clock_timestamp()
    order by batch.available_at, batch.scheduled_at, batch.created_at, batch.id
    for update of batch skip locked
    limit p_limit
  ), claimed as (
    update public.task_reminder_digest_batches batch
    set
      status = 'processing',
      provider_call_started = false,
      locked_at = clock_timestamp(),
      locked_by = worker_value,
      heartbeat_at = clock_timestamp(),
      attempt_count = batch.attempt_count + 1,
      failed_at = null,
      error_message = null
    from candidates
    where batch.id = candidates.id
    returning batch.*
  )
  select
    to_jsonb(claimed)
    || jsonb_build_object(
      'recipientId', case
        when claimed.recipient_kind = 'profile' then claimed.recipient_profile_id
        else claimed.recipient_contact_id
      end,
      'itemCount', (
        select pg_catalog.count(*)
        from public.task_reminder_digest_items item
        where item.batch_id = claimed.id
          and item.status = 'pending'
      ),
      'itemIds', coalesce((
        select jsonb_agg(item.id order by item.created_at, item.id)
        from public.task_reminder_digest_items item
        where item.batch_id = claimed.id
          and item.status = 'pending'
      ), '[]'::jsonb),
      'visibleItems', coalesce((
        select jsonb_agg(
          to_jsonb(visible_item) - 'sort_order'
          order by visible_item.sort_order
        )
        from (
          select
            item.id as "itemId",
            item.task_id as "taskId",
            item.task_version as "taskVersion",
            item.target,
            item.action_kind as "actionKind",
            item.reason,
            item.body_text as "bodyText",
            task.title as "taskTitle",
            task.context_label as "contextLabel",
            task.due_at as "dueAt",
            task.due_timezone as "dueTimezone",
            row_number() over (
              order by
                case item.action_kind
                  when 'overdue' then 0
                  when 'review_overdue' then 1
                  when 'due_today' then 2
                  when 'escalation' then 3
                  else 4
                end,
                task.due_at,
                item.created_at,
                item.id
            ) as sort_order
          from public.task_reminder_digest_items item
          join public.operational_tasks task
            on task.id = item.task_id
           and task.org_id = item.org_id
          where item.batch_id = claimed.id
            and item.status = 'pending'
          order by sort_order
          limit (
            select settings.reminder_digest_max_visible_items
            from public.task_organization_settings settings
            where settings.org_id = claimed.org_id
          )
        ) visible_item
      ), '[]'::jsonb)
    )
  from claimed;
end;
$$;

revoke all on function public.claim_task_reminder_digest_batches(text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_task_reminder_digest_batches(text, integer, interval)
  to service_role;

create or replace function public.cancel_task_reminder_digest_batch(
  p_batch_id uuid,
  p_worker_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  worker_value text := btrim(coalesce(p_worker_id, ''));
  reason_value text := btrim(coalesce(p_reason, ''));
  cancelled_items integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_CANCEL_FORBIDDEN';
  end if;
  if p_batch_id is null
    or worker_value = ''
    or reason_value = ''
    or length(reason_value) > 1000
    or public.task_notification_json_contains_secret(to_jsonb(reason_value))
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_CANCEL_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status = 'cancelled' then
    return jsonb_build_object(
      'batchId', batch_row.id,
      'status', batch_row.status,
      'cancelledItems', 0,
      'idempotent', true
    );
  end if;
  if batch_row.status in ('sent', 'ambiguous') or batch_row.provider_call_started then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_CANCEL_RECONCILIATION_REQUIRED';
  end if;
  if batch_row.status = 'processing' and batch_row.locked_by <> worker_value then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_WORKER_MISMATCH';
  end if;

  update public.task_reminder_digest_items item
  set
    status = 'cancelled',
    cancelled_at = clock_timestamp(),
    cancel_reason = left(reason_value, 1000)
  where item.batch_id = batch_row.id
    and item.status in ('pending', 'processing');
  get diagnostics cancelled_items = row_count;

  update public.task_reminder_digest_batches batch
  set
    status = 'cancelled',
    provider_call_started = false,
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    resolved_at = clock_timestamp(),
    resolution_note = left(reason_value, 1000),
    error_message = 'TASK_REMINDER_DIGEST_CANCELLED'
  where batch.id = batch_row.id
  returning * into batch_row;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'cancelledItems', cancelled_items,
    'idempotent', false
  );
end;
$$;

revoke all on function public.cancel_task_reminder_digest_batch(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_task_reminder_digest_batch(uuid, text, text)
  to service_role;

-- Final provider fence. The worker passes the complete itemIds array returned by
-- claim in p_provider_payload. If any task changed between claim and this call,
-- stale items are cancelled and the batch is requeued without starting a
-- provider call. The worker must send only when started=true.
create or replace function public.start_task_reminder_digest_provider_call(
  p_batch_id uuid,
  p_worker_id text,
  p_provider_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  settings_row public.task_organization_settings%rowtype;
  worker_value text := btrim(coalesce(p_worker_id, ''));
  expected_item_ids uuid[];
  current_item_ids uuid[];
  item_id_text text;
  canonical_address text;
  recipient_name text;
  recipient_throttle_until timestamptz;
  next_allowed_at timestamptz;
  item_count integer := 0;
  max_visible integer;
  subject_value text;
  visible_items jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_START_FORBIDDEN';
  end if;
  if p_batch_id is null
    or worker_value = ''
    or p_provider_payload is null
    or jsonb_typeof(p_provider_payload) <> 'object'
    or public.task_notification_json_contains_secret(p_provider_payload)
    or jsonb_typeof(p_provider_payload -> 'itemIds') <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_START_ARGUMENT_INVALID';
  end if;

  for item_id_text in
    select element.value
    from jsonb_array_elements_text(p_provider_payload -> 'itemIds') element
  loop
    if item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using
        errcode = '22023',
        message = 'TASK_REMINDER_DIGEST_ITEM_ID_INVALID';
    end if;
    expected_item_ids := pg_catalog.array_append(expected_item_ids, item_id_text::uuid);
  end loop;

  select pg_catalog.array_agg(distinct item_id order by item_id)
  into expected_item_ids
  from pg_catalog.unnest(expected_item_ids) item_id;

  if expected_item_ids is null or cardinality(expected_item_ids) < 1 then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_ITEM_IDS_REQUIRED';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status = 'cancelled' then
    return jsonb_build_object(
      'started', false,
      'reason', 'batch_cancelled',
      'batchId', batch_row.id,
      'status', batch_row.status
    );
  end if;
  if batch_row.status <> 'processing' or batch_row.locked_by <> worker_value then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_WORKER_MISMATCH';
  end if;
  if batch_row.provider_call_started then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_RECONCILIATION_REQUIRED';
  end if;

  -- Defense in depth: even a manually or incorrectly claimed batch cannot
  -- cross the provider fence before both its slot and collection grace expire.
  if batch_row.scheduled_at > clock_timestamp()
    or batch_row.available_at > clock_timestamp()
  then
    update public.task_reminder_digest_batches batch
    set
      status = 'queued',
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'TASK_REMINDER_DIGEST_BATCH_NOT_DUE'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'batch_not_due',
      'batchId', batch_row.id,
      'status', batch_row.status,
      'retryAt', greatest(batch_row.scheduled_at, batch_row.available_at)
    );
  end if;

  -- Serialize the final provider fence per organization/recipient. Different
  -- workers may have claimed older and newer slots before either transaction
  -- became visible; only one of them may proceed to an external call.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      batch_row.org_id::text || ':task-reminder-digest-recipient:'
        || batch_row.recipient_kind || ':'
        || coalesce(
          batch_row.recipient_profile_id::text,
          batch_row.recipient_contact_id::text
        ),
      0
    )
  );

  select settings.*
  into settings_row
  from public.task_organization_settings settings
  where settings.org_id = batch_row.org_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_ORGANIZATION_SETTINGS_NOT_FOUND';
  end if;

  if not settings_row.reminder_digest_enabled then
    update public.task_reminder_digest_items item
    set
      status = 'cancelled',
      cancelled_at = clock_timestamp(),
      cancel_reason = 'digest_disabled'
    where item.batch_id = batch_row.id
      and item.status = 'pending';

    update public.task_reminder_digest_batches batch
    set
      status = 'cancelled',
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      resolved_at = clock_timestamp(),
      resolution_note = 'The organization disabled automatic reminder digests.',
      error_message = 'TASK_REMINDER_DIGEST_DISABLED'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'digest_disabled',
      'batchId', batch_row.id,
      'status', batch_row.status
    );
  end if;

  if exists (
    select 1
    from public.task_reminder_digest_batches active_batch
    where active_batch.org_id = batch_row.org_id
      and active_batch.id <> batch_row.id
      and active_batch.status in ('processing', 'ambiguous')
      and active_batch.recipient_kind = batch_row.recipient_kind
      and (
        (batch_row.recipient_kind = 'profile'
          and active_batch.recipient_profile_id = batch_row.recipient_profile_id)
        or
        (batch_row.recipient_kind = 'contact'
          and active_batch.recipient_contact_id = batch_row.recipient_contact_id)
      )
  ) then
    update public.task_reminder_digest_batches batch
    set
      status = 'queued',
      available_at = greatest(batch.available_at, clock_timestamp() + interval '5 minutes'),
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'TASK_REMINDER_DIGEST_RECIPIENT_BUSY'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'recipient_busy',
      'batchId', batch_row.id,
      'status', batch_row.status,
      'retryAt', batch_row.available_at
    );
  end if;

  select pg_catalog.max(sent_batch.sent_at)
    + pg_catalog.make_interval(hours => settings_row.reminder_digest_min_interval_hours)
  into recipient_throttle_until
  from public.task_reminder_digest_batches sent_batch
  where sent_batch.org_id = batch_row.org_id
    and sent_batch.id <> batch_row.id
    and sent_batch.status = 'sent'
    and sent_batch.recipient_kind = batch_row.recipient_kind
    and (
      (batch_row.recipient_kind = 'profile'
        and sent_batch.recipient_profile_id = batch_row.recipient_profile_id)
      or
      (batch_row.recipient_kind = 'contact'
        and sent_batch.recipient_contact_id = batch_row.recipient_contact_id)
    );

  if recipient_throttle_until is not null
    and recipient_throttle_until > clock_timestamp()
  then
    next_allowed_at := public.task_next_reminder_digest_at(
      batch_row.org_id,
      recipient_throttle_until
        - pg_catalog.make_interval(
          mins => settings_row.reminder_digest_collection_minutes
        )
        - interval '1 microsecond'
    ) + pg_catalog.make_interval(
      mins => settings_row.reminder_digest_collection_minutes
    );

    update public.task_reminder_digest_batches batch
    set
      status = 'queued',
      available_at = greatest(batch.available_at, next_allowed_at),
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'TASK_REMINDER_DIGEST_RECIPIENT_THROTTLED'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'recipient_throttled',
      'batchId', batch_row.id,
      'status', batch_row.status,
      'retryAt', batch_row.available_at
    );
  end if;

  -- Cancel only rows that are provably stale before the provider fence.
  update public.task_reminder_digest_items item
  set
    status = 'cancelled',
    cancelled_at = clock_timestamp(),
    cancel_reason = 'task_stale_before_digest_send'
  where item.batch_id = batch_row.id
    and item.status = 'pending'
    and not exists (
      select 1
      from public.operational_tasks task
      where task.id = item.task_id
        and task.org_id = item.org_id
        and task.version = item.task_version
        and task.archived_at is null
        and task.status not in ('draft', 'approved', 'cancelled')
        and (
          (
            item.target = 'creator'
            and batch_row.recipient_kind = 'profile'
            and task.issuer_profile_id = batch_row.recipient_profile_id
          )
          or (
            item.target = 'assignee'
            and (
              (batch_row.recipient_kind = 'profile'
                and task.assignee_profile_id = batch_row.recipient_profile_id)
              or
              (batch_row.recipient_kind = 'contact'
                and task.assignee_contact_id = batch_row.recipient_contact_id)
            )
          )
        )
    );

  select pg_catalog.array_agg(item.id order by item.id), pg_catalog.count(*)
  into current_item_ids, item_count
  from public.task_reminder_digest_items item
  where item.batch_id = batch_row.id
    and item.status = 'pending';

  if item_count = 0 then
    update public.task_reminder_digest_batches batch
    set
      status = 'cancelled',
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'TASK_REMINDER_DIGEST_NO_CURRENT_ITEMS',
      resolved_at = clock_timestamp(),
      resolution_note = 'Every item became stale before the provider call.'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'no_current_items',
      'batchId', batch_row.id,
      'status', batch_row.status,
      'itemCount', 0,
      'itemIds', '[]'::jsonb
    );
  end if;

  if current_item_ids is distinct from expected_item_ids then
    update public.task_reminder_digest_batches batch
    set
      status = 'queued',
      available_at = clock_timestamp(),
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'TASK_REMINDER_DIGEST_ITEMS_CHANGED_BEFORE_PROVIDER_CALL'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'items_changed',
      'batchId', batch_row.id,
      'status', batch_row.status,
      'itemCount', item_count,
      'itemIds', to_jsonb(current_item_ids)
    );
  end if;

  if batch_row.recipient_kind = 'profile' then
    select
      pg_catalog.lower(nullif(btrim(profile.email), '')),
      coalesce(nullif(btrim(profile.full_name), ''), nullif(btrim(profile.email), ''), 'Mottagare')
    into canonical_address, recipient_name
    from public.profiles profile
    where profile.id = batch_row.recipient_profile_id
      and exists (
        select 1
        from public.org_members member
        where member.org_id = batch_row.org_id
          and member.profile_id = profile.id
          and member.is_active = true
      )
      and public.task_profile_has_module_access(batch_row.org_id, profile.id);
  else
    select
      pg_catalog.lower(nullif(btrim(contact.email), '')),
      coalesce(nullif(btrim(contact.name), ''), nullif(btrim(contact.email), ''), 'Mottagare')
    into canonical_address, recipient_name
    from public.organization_contacts contact
    left join public.task_recipient_identities identity
      on identity.id = contact.recipient_identity_id
    where contact.id = batch_row.recipient_contact_id
      and contact.org_id = batch_row.org_id
      and contact.is_active = true
      and coalesce(identity.status <> 'disabled', true);
  end if;

  if canonical_address is null then
    update public.task_reminder_digest_items item
    set
      status = 'cancelled',
      cancelled_at = clock_timestamp(),
      cancel_reason = 'recipient_unavailable'
    where item.batch_id = batch_row.id
      and item.status = 'pending';

    update public.task_reminder_digest_batches batch
    set
      status = 'dead_letter',
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      failed_at = clock_timestamp(),
      error_message = 'TASK_REMINDER_DIGEST_RECIPIENT_UNAVAILABLE'
    where batch.id = batch_row.id
    returning * into batch_row;

    return jsonb_build_object(
      'started', false,
      'reason', 'recipient_unavailable',
      'batchId', batch_row.id,
      'status', batch_row.status
    );
  end if;

  max_visible := settings_row.reminder_digest_max_visible_items;

  subject_value := case
    when item_count = 1 then 'HusHub: 1 uppdrag behöver din uppmärksamhet'
    else 'HusHub: ' || item_count::text || ' uppdrag behöver din uppmärksamhet'
  end;

  select coalesce(
    jsonb_agg(
      to_jsonb(visible_item) - 'sort_order'
      order by visible_item.sort_order
    ),
    '[]'::jsonb
  )
  into visible_items
  from (
    select
      item.id as "itemId",
      item.task_id as "taskId",
      item.task_version as "taskVersion",
      item.target,
      item.action_kind as "actionKind",
      item.reason,
      item.body_text as "bodyText",
      task.title as "taskTitle",
      task.context_label as "contextLabel",
      task.due_at as "dueAt",
      task.due_timezone as "dueTimezone",
      row_number() over (
        order by
          case item.action_kind
            when 'overdue' then 0
            when 'review_overdue' then 1
            when 'due_today' then 2
            when 'escalation' then 3
            else 4
          end,
          task.due_at,
          item.created_at,
          item.id
      ) as sort_order
    from public.task_reminder_digest_items item
    join public.operational_tasks task
      on task.id = item.task_id
     and task.org_id = item.org_id
    where item.batch_id = batch_row.id
      and item.status = 'pending'
    order by sort_order
    limit max_visible
  ) visible_item;

  update public.task_reminder_digest_items item
  set status = 'processing'
  where item.batch_id = batch_row.id
    and item.status = 'pending';

  update public.task_reminder_digest_batches batch
  set
    recipient_address = canonical_address,
    subject = subject_value,
    provider_call_started = true,
    heartbeat_at = clock_timestamp(),
    provider_payload = p_provider_payload
      || jsonb_build_object(
        'itemIds', to_jsonb(current_item_ids),
        'itemCount', item_count,
        'tokenPersisted', false
      )
  where batch.id = batch_row.id
    and batch.status = 'processing'
    and batch.locked_by = worker_value
    and not batch.provider_call_started
  returning * into batch_row;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_PROVIDER_RESERVATION_CONFLICT';
  end if;

  return jsonb_build_object(
    'started', true,
    'batchId', batch_row.id,
    'status', batch_row.status,
    'attemptCount', batch_row.attempt_count,
    'idempotencyKey', batch_row.idempotency_key,
    'recipientKind', batch_row.recipient_kind,
    'recipientId', case
      when batch_row.recipient_kind = 'profile' then batch_row.recipient_profile_id
      else batch_row.recipient_contact_id
    end,
    'recipientName', recipient_name,
    'recipientAddress', batch_row.recipient_address,
    'channel', batch_row.channel,
    'subject', batch_row.subject,
    'itemCount', item_count,
    'maxVisibleItems', max_visible,
    'hiddenItemCount', greatest(item_count - max_visible, 0),
    'itemIds', to_jsonb(current_item_ids),
    'visibleItems', visible_items
  );
end;
$$;

revoke all on function public.start_task_reminder_digest_provider_call(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_task_reminder_digest_provider_call(uuid, text, jsonb)
  to service_role;

-- Shared atomic success projection. One provider email becomes one logical
-- message/delivery on every included task, all carrying the same provider id.
-- This preserves the established per-task cadence, emitted-key and audit reads
-- without pretending that the provider received several send requests.
create or replace function public.complete_task_reminder_digest_batch(
  p_batch_id uuid,
  p_provider_message_id text,
  p_provider_payload jsonb default '{}'::jsonb,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  item_row public.task_reminder_digest_items%rowtype;
  provider_message_id_value text := btrim(coalesce(p_provider_message_id, ''));
  resolution_note_value text := nullif(btrim(coalesce(p_resolution_note, '')), '');
  message_id_value uuid;
  delivery_id_value uuid;
  delivery_key text;
  message_type_value text;
  completed_at_value timestamptz := clock_timestamp();
  sent_items integer := 0;
  sent_item_ids jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_COMPLETE_FORBIDDEN';
  end if;
  if p_batch_id is null
    or provider_message_id_value = ''
    or length(provider_message_id_value) > 1000
    or p_provider_payload is null
    or jsonb_typeof(p_provider_payload) <> 'object'
    or public.task_notification_json_contains_secret(p_provider_payload)
    or (resolution_note_value is not null and length(resolution_note_value) > 1000)
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_COMPLETE_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;

  if batch_row.status = 'sent' then
    if batch_row.provider_message_id <> provider_message_id_value then
      raise exception using
        errcode = '23505',
        message = 'TASK_REMINDER_DIGEST_PROVIDER_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'batchId', batch_row.id,
      'status', batch_row.status,
      'providerMessageId', batch_row.provider_message_id,
      'sentAt', batch_row.sent_at,
      'sentItems', (
        select pg_catalog.count(*)
        from public.task_reminder_digest_items item
        where item.batch_id = batch_row.id
          and item.status = 'sent'
      ),
      'idempotent', true
    );
  end if;

  if batch_row.status not in ('processing', 'ambiguous')
    or not batch_row.provider_call_started
    or nullif(btrim(coalesce(batch_row.subject, '')), '') is null
  then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_NOT_COMPLETABLE';
  end if;

  for item_row in
    select item.*
    from public.task_reminder_digest_items item
    where item.batch_id = batch_row.id
      and item.status = 'processing'
    order by item.created_at, item.id
    for update
  loop
    message_type_value := case
      when item_row.action_kind = 'escalation' then 'escalation'
      when item_row.action_kind in ('status_check', 'deadline_change_request') then 'status_request'
      else 'reminder'
    end;

    insert into public.task_messages (
      org_id,
      task_id,
      direction,
      message_type,
      actor_type,
      actor_name,
      body_text,
      provider_message_id,
      generated_by_ai,
      metadata
    )
    values (
      item_row.org_id,
      item_row.task_id,
      'outbound',
      message_type_value,
      'system',
      'Gizmo',
      item_row.body_text,
      provider_message_id_value,
      false,
      jsonb_build_object(
        'target', item_row.target,
        'recipientKind', batch_row.recipient_kind,
        'recipientId', case
          when batch_row.recipient_kind = 'profile' then batch_row.recipient_profile_id
          else batch_row.recipient_contact_id
        end,
        'actionKind', item_row.action_kind,
        'reason', item_row.reason,
        'actionIdempotencyKey', item_row.policy_action_idempotency_key,
        'policyActionIdempotencyKey', item_row.policy_action_idempotency_key,
        'jobId', item_row.source_job_id,
        'digest', true,
        'digestBatchId', batch_row.id,
        'digestItemId', item_row.id,
        'isFallback', false,
        'tokenPersisted', false
      )
    )
    returning id into message_id_value;

    delivery_key := 'task-reminder-digest-item:' || item_row.id::text;
    delivery_id_value := null;

    insert into public.task_message_deliveries (
      org_id,
      task_id,
      message_id,
      channel,
      recipient_address,
      provider,
      provider_message_id,
      status,
      is_fallback,
      scheduled_at,
      sent_at,
      attempt_count,
      max_attempts,
      idempotency_key,
      provider_payload
    )
    values (
      item_row.org_id,
      item_row.task_id,
      message_id_value,
      'email',
      batch_row.recipient_address,
      batch_row.provider,
      provider_message_id_value,
      'sent',
      false,
      batch_row.scheduled_at,
      completed_at_value,
      1,
      1,
      delivery_key,
      (p_provider_payload - 'accessLinkIds' - 'itemIds')
      || jsonb_build_object(
        'subject', batch_row.subject,
        'digest', true,
        'digestBatchId', batch_row.id,
        'digestItemId', item_row.id,
        'providerCallCount', 1,
        'tokenPersisted', false
      )
    )
    on conflict (org_id, idempotency_key) do nothing
    returning id into delivery_id_value;

    if delivery_id_value is null then
      select delivery.id
      into delivery_id_value
      from public.task_message_deliveries delivery
      where delivery.org_id = item_row.org_id
        and delivery.idempotency_key = delivery_key
        and delivery.task_id = item_row.task_id
        and delivery.provider_message_id = provider_message_id_value;
    end if;

    if delivery_id_value is null then
      raise exception using
        errcode = '23505',
        message = 'TASK_REMINDER_DIGEST_DELIVERY_IDEMPOTENCY_CONFLICT';
    end if;

    insert into public.task_events (
      org_id,
      task_id,
      event_type,
      actor_type,
      actor_name,
      message,
      metadata
    )
    values (
      item_row.org_id,
      item_row.task_id,
      'automation_message_sent',
      'system',
      'Gizmo',
      'Gizmo inkluderade uppdraget i en samlad påminnelse via e-post.',
      jsonb_build_object(
        'taskMutationApplied', true,
        'automationFollowup', true,
        'digest', true,
        'digestBatchId', batch_row.id,
        'digestItemId', item_row.id,
        'messageId', message_id_value,
        'deliveryId', delivery_id_value,
        'providerMessageId', provider_message_id_value,
        'actionKind', item_row.action_kind,
        'reason', item_row.reason,
        'target', item_row.target,
        'channel', 'email',
        'isFallback', false
      )
    );

    update public.task_reminder_digest_items item
    set
      status = 'sent',
      message_id = message_id_value,
      delivery_id = delivery_id_value,
      sent_at = completed_at_value
    where item.id = item_row.id;

    sent_items := sent_items + 1;
    sent_item_ids := sent_item_ids || jsonb_build_array(item_row.id);
  end loop;

  if sent_items < 1 then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_NO_PROCESSING_ITEMS';
  end if;

  update public.task_reminder_digest_batches batch
  set
    status = 'sent',
    provider_message_id = provider_message_id_value,
    provider_payload = batch.provider_payload
      || p_provider_payload
      || jsonb_build_object(
        'subject', batch.subject,
        'itemCount', sent_items,
        'tokenPersisted', false
      ),
    sent_at = completed_at_value,
    failed_at = null,
    resolved_at = case
      when batch.status = 'ambiguous' then completed_at_value
      else batch.resolved_at
    end,
    resolution_note = coalesce(resolution_note_value, batch.resolution_note),
    error_message = null,
    locked_at = null,
    locked_by = null,
    heartbeat_at = null
  where batch.id = batch_row.id
  returning * into batch_row;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'providerMessageId', batch_row.provider_message_id,
    'sentAt', batch_row.sent_at,
    'sentItems', sent_items,
    'sentItemIds', sent_item_ids,
    'idempotent', false
  );
end;
$$;

revoke all on function public.complete_task_reminder_digest_batch(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_task_reminder_digest_batch(uuid, text, jsonb, text)
  to service_role;

create or replace function public.finish_task_reminder_digest_batch(
  p_batch_id uuid,
  p_worker_id text,
  p_provider_message_id text,
  p_subject text default null,
  p_provider_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  worker_value text := btrim(coalesce(p_worker_id, ''));
  subject_value text := nullif(btrim(coalesce(p_subject, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_FINISH_FORBIDDEN';
  end if;
  if p_batch_id is null or worker_value = '' then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_FINISH_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status = 'sent' then
    return public.complete_task_reminder_digest_batch(
      p_batch_id,
      p_provider_message_id,
      p_provider_payload,
      null
    );
  end if;
  if batch_row.status <> 'processing'
    or batch_row.locked_by <> worker_value
    or not batch_row.provider_call_started
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_WORKER_MISMATCH';
  end if;
  if subject_value is not null and subject_value <> batch_row.subject then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_SUBJECT_MISMATCH';
  end if;

  return public.complete_task_reminder_digest_batch(
    p_batch_id,
    p_provider_message_id,
    p_provider_payload,
    null
  );
end;
$$;

revoke all on function public.finish_task_reminder_digest_batch(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_task_reminder_digest_batch(uuid, text, text, text, jsonb)
  to service_role;

create or replace function public.fail_task_reminder_digest_batch(
  p_batch_id uuid,
  p_worker_id text,
  p_error_message text,
  p_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  worker_value text := btrim(coalesce(p_worker_id, ''));
  error_value text := btrim(coalesce(p_error_message, ''));
  retry_at_value timestamptz := coalesce(p_retry_at, clock_timestamp() + interval '15 minutes');
  terminal_failure boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_FAIL_FORBIDDEN';
  end if;
  if p_batch_id is null
    or worker_value = ''
    or error_value = ''
    or length(error_value) > 4000
    or public.task_notification_json_contains_secret(to_jsonb(error_value))
    or retry_at_value < clock_timestamp()
    or retry_at_value > clock_timestamp() + interval '30 days'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_FAIL_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status in ('failed', 'dead_letter') then
    return jsonb_build_object(
      'batchId', batch_row.id,
      'status', batch_row.status,
      'retryAt', batch_row.available_at,
      'retryable', batch_row.status = 'failed',
      'idempotent', true
    );
  end if;
  if batch_row.status <> 'processing' or batch_row.locked_by <> worker_value then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_WORKER_MISMATCH';
  end if;

  terminal_failure := batch_row.attempt_count >= batch_row.max_attempts;

  if terminal_failure then
    update public.task_reminder_digest_items item
    set
      status = 'cancelled',
      cancelled_at = clock_timestamp(),
      cancel_reason = 'digest_dead_letter'
    where item.batch_id = batch_row.id
      and item.status in ('pending', 'processing');
  else
    update public.task_reminder_digest_items item
    set status = 'pending'
    where item.batch_id = batch_row.id
      and item.status = 'processing';
  end if;

  update public.task_reminder_digest_batches batch
  set
    status = case when terminal_failure then 'dead_letter' else 'failed' end,
    provider_call_started = false,
    available_at = case when terminal_failure then batch.available_at else retry_at_value end,
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    failed_at = clock_timestamp(),
    error_message = left(error_value, 4000)
  where batch.id = batch_row.id
  returning * into batch_row;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'retryAt', case when batch_row.status = 'failed' then batch_row.available_at else null end,
    'retryable', batch_row.status = 'failed',
    'attemptCount', batch_row.attempt_count,
    'maxAttempts', batch_row.max_attempts,
    'idempotent', false
  );
end;
$$;

revoke all on function public.fail_task_reminder_digest_batch(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fail_task_reminder_digest_batch(uuid, text, text, timestamptz)
  to service_role;

create or replace function public.mark_task_reminder_digest_batch_ambiguous(
  p_batch_id uuid,
  p_worker_id text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_row public.task_reminder_digest_batches%rowtype;
  worker_value text := btrim(coalesce(p_worker_id, ''));
  error_value text := btrim(coalesce(p_error_message, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_AMBIGUOUS_FORBIDDEN';
  end if;
  if p_batch_id is null
    or worker_value = ''
    or error_value = ''
    or length(error_value) > 4000
    or public.task_notification_json_contains_secret(to_jsonb(error_value))
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_AMBIGUOUS_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status = 'ambiguous' then
    return jsonb_build_object(
      'batchId', batch_row.id,
      'status', batch_row.status,
      'reconciliationRequired', true,
      'idempotent', true
    );
  end if;
  if batch_row.status <> 'processing'
    or batch_row.locked_by <> worker_value
    or not batch_row.provider_call_started
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_WORKER_MISMATCH';
  end if;

  update public.task_reminder_digest_batches batch
  set
    status = 'ambiguous',
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    failed_at = clock_timestamp(),
    error_message = left(error_value, 4000)
  where batch.id = batch_row.id
  returning * into batch_row;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'reconciliationRequired', true,
    'idempotent', false
  );
end;
$$;

revoke all on function public.mark_task_reminder_digest_batch_ambiguous(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_task_reminder_digest_batch_ambiguous(uuid, text, text)
  to service_role;

create or replace function public.resolve_task_reminder_digest_batch(
  p_batch_id uuid,
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
  batch_row public.task_reminder_digest_batches%rowtype;
  resolution_value text := pg_catalog.lower(btrim(coalesce(p_resolution, '')));
  provider_message_id_value text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  result jsonb;
  requeued_tasks integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_REMINDER_DIGEST_RESOLVE_FORBIDDEN';
  end if;
  if p_batch_id is null
    or resolution_value not in ('sent', 'failed')
    or note_value is null
    or length(note_value) > 1000
    or public.task_notification_json_contains_secret(to_jsonb(note_value))
    or (resolution_value = 'sent' and provider_message_id_value is null)
    or (resolution_value = 'failed' and provider_message_id_value is not null)
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_RESOLUTION_ARGUMENT_INVALID';
  end if;

  select batch.*
  into batch_row
  from public.task_reminder_digest_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_REMINDER_DIGEST_BATCH_NOT_FOUND';
  end if;
  if batch_row.status <> 'ambiguous' then
    raise exception using
      errcode = '55000',
      message = 'TASK_REMINDER_DIGEST_NOT_AMBIGUOUS';
  end if;

  if resolution_value = 'sent' then
    result := public.complete_task_reminder_digest_batch(
      batch_row.id,
      provider_message_id_value,
      jsonb_build_object(
        'operatorResolution', 'sent',
        'tokenPersisted', false
      ),
      note_value
    );

    insert into public.task_automation_jobs (
      org_id,
      task_id,
      job_type,
      status,
      available_at,
      idempotency_key,
      payload
    )
    select distinct
      task.org_id,
      task.id,
      'evaluate_followup',
      'queued',
      clock_timestamp(),
      'task-digest-resolution:' || batch_row.id::text
        || ':' || task.id::text || ':sent:v' || task.version::text,
      jsonb_build_object(
        'taskVersion', task.version,
        'scheduledFrom', 'digest-reconciliation',
        'digestBatchId', batch_row.id,
        'resolution', 'sent'
      )
    from public.task_reminder_digest_items item
    join public.operational_tasks task
      on task.id = item.task_id
     and task.org_id = item.org_id
    where item.batch_id = batch_row.id
      and item.status = 'sent'
      and task.archived_at is null
      and task.status not in ('draft', 'approved', 'cancelled')
    on conflict (org_id, idempotency_key) do nothing;
    get diagnostics requeued_tasks = row_count;

    return result || jsonb_build_object(
      'resolution', 'sent',
      'requeuedTasks', requeued_tasks
    );
  end if;

  update public.task_reminder_digest_items item
  set status = 'pending'
  where item.batch_id = batch_row.id
    and item.status = 'processing';

  update public.task_reminder_digest_batches batch
  set
    status = 'failed',
    provider_call_started = false,
    provider_message_id = null,
    available_at = clock_timestamp(),
    max_attempts = least(20, greatest(batch.max_attempts, batch.attempt_count + 1)),
    failed_at = clock_timestamp(),
    resolved_at = clock_timestamp(),
    resolution_note = note_value,
    error_message = 'TASK_REMINDER_DIGEST_OPERATOR_CONFIRMED_NOT_SENT'
  where batch.id = batch_row.id
  returning * into batch_row;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'resolution', 'failed',
    'retryAt', batch_row.available_at,
    'reconciliationRequired', false,
    'requeuedTasks', 0
  );
end;
$$;

revoke all on function public.resolve_task_reminder_digest_batch(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_task_reminder_digest_batch(uuid, text, text, text)
  to service_role;

-- Sent/cancelled digest rows are delivery coordination state. The durable
-- business audit remains in task_messages, task_message_deliveries and
-- task_events. Ambiguous, failed and dead-letter rows are retained for manual
-- diagnosis and reconciliation.
create or replace function public.cleanup_task_reminder_digests(
  p_retention interval default interval '180 days'
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  deleted_rows bigint;
begin
  if p_retention is null
    or p_retention < interval '30 days'
    or p_retention > interval '730 days'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_DIGEST_RETENTION_INVALID';
  end if;

  delete from public.task_reminder_digest_batches batch
  where batch.status in ('sent', 'cancelled')
    and coalesce(
      batch.sent_at,
      batch.resolved_at,
      batch.updated_at,
      batch.created_at
    ) < clock_timestamp() - p_retention;
  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.cleanup_task_reminder_digests(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_task_reminder_digests(interval)
  to service_role;

-- Reuse the already scheduled nightly maintenance cron from the prerequisite
-- migration; replacing its target function avoids creating another cron job.
create or replace function public.run_task_automation_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  deleted_cron_history_rows bigint;
  deleted_automation_job_rows bigint;
  deleted_digest_batch_rows bigint;
begin
  select public.cleanup_task_automation_jobs(interval '90 days')
  into deleted_automation_job_rows;
  select public.cleanup_task_reminder_digests(interval '180 days')
  into deleted_digest_batch_rows;
  select public.cleanup_task_cron_job_run_details(interval '30 days')
  into deleted_cron_history_rows;

  return jsonb_build_object(
    'deletedAutomationJobRows', deleted_automation_job_rows,
    'deletedDigestBatchRows', deleted_digest_batch_rows,
    'deletedCronHistoryRows', deleted_cron_history_rows,
    'completedAt', clock_timestamp()
  );
end;
$$;

revoke all on function public.run_task_automation_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_task_automation_maintenance()
  to service_role;
