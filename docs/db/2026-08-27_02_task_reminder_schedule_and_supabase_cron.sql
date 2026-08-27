-- Uppdrag: exact deadline timezone, reminder delivery windows and Supabase Cron.
--
-- The HTTP endpoint and CRON_SECRET are intentionally not present in this file.
-- Store them in Supabase Vault under the fixed names documented below, then call
-- public.configure_task_followup_cron() with no arguments.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Provider timeouts and malformed success responses have an unknown delivery
-- outcome. Keep them out of the normal failed/retry path until an operator or
-- provider webhook has reconciled the delivery.
alter table public.task_message_deliveries
  drop constraint if exists task_message_deliveries_status_check;
alter table public.task_message_deliveries
  add constraint task_message_deliveries_status_check
  check (
    status in (
      'queued',
      'sending',
      'sent',
      'delivered',
      'read',
      'replied',
      'failed',
      'cancelled',
      'ambiguous'
    )
  );

create index if not exists task_message_deliveries_ambiguous_idx
  on public.task_message_deliveries (updated_at, id)
  include (org_id, task_id, channel, provider)
  where status = 'ambiguous';

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
  delivery_row public.task_message_deliveries%rowtype;
  message_row public.task_messages%rowtype;
  task_row public.operational_tasks%rowtype;
  normalized_resolution text := lower(btrim(coalesce(p_resolution, '')));
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  operator_note text := nullif(btrim(coalesce(p_note, '')), '');
  access_link_id uuid;
  access_link_value text;
  requeued_count integer := 0;
begin
  if p_delivery_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_RESOLUTION_ID_REQUIRED';
  end if;
  if normalized_resolution not in ('sent', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_RESOLUTION_INVALID';
  end if;
  if operator_note is null or length(operator_note) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_RESOLUTION_NOTE_REQUIRED';
  end if;
  if normalized_resolution = 'sent' and normalized_provider_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_PROVIDER_MESSAGE_ID_REQUIRED';
  end if;
  if normalized_resolution = 'failed' and normalized_provider_message_id is not null then
    raise exception using
      errcode = '22023',
      message = 'TASK_DELIVERY_PROVIDER_MESSAGE_ID_NOT_ALLOWED';
  end if;

  select delivery.*
  into delivery_row
  from public.task_message_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DELIVERY_NOT_FOUND';
  end if;
  if delivery_row.status <> 'ambiguous' then
    raise exception using
      errcode = '55000',
      message = 'TASK_DELIVERY_NOT_AMBIGUOUS';
  end if;

  select message.*
  into message_row
  from public.task_messages message
  where message.id = delivery_row.message_id
    and message.task_id = delivery_row.task_id
    and message.org_id = delivery_row.org_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DELIVERY_MESSAGE_NOT_FOUND';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = delivery_row.task_id
    and task.org_id = delivery_row.org_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_DELIVERY_TASK_NOT_FOUND';
  end if;

  access_link_value := nullif(delivery_row.provider_payload ->> 'accessLinkId', '');
  if access_link_value is not null
    and access_link_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    access_link_id := access_link_value::uuid;
  end if;

  if normalized_resolution = 'sent' then
    update public.task_message_deliveries delivery
    set
      status = 'sent',
      provider_message_id = normalized_provider_message_id,
      sent_at = coalesce(delivery.sent_at, clock_timestamp()),
      failed_at = null,
      next_attempt_at = null,
      error_message = null
    where delivery.id = delivery_row.id;

    if access_link_id is not null then
      update public.task_access_links access_link
      set sent_at = coalesce(access_link.sent_at, clock_timestamp())
      where access_link.id = access_link_id
        and access_link.task_id = task_row.id
        and access_link.revoked_at is null;
    end if;
  else
    update public.task_message_deliveries delivery
    set
      status = 'failed',
      provider_message_id = null,
      failed_at = clock_timestamp(),
      next_attempt_at = null,
      error_message = 'TASK_DELIVERY_OPERATOR_CONFIRMED_NOT_SENT',
      -- A WhatsApp attempt is never replayed automatically. The normal policy
      -- may still choose a separately idempotent configured fallback channel.
      max_attempts = case
        when delivery.channel = 'whatsapp'
          then least(delivery.max_attempts, greatest(delivery.attempt_count, 1))
        else delivery.max_attempts
      end
    where delivery.id = delivery_row.id;

    if access_link_id is not null
      and delivery_row.provider_payload ->> 'accountActivation' is distinct from 'true'
      and not exists (
        select 1
        from public.task_message_deliveries sibling_delivery
        where sibling_delivery.id <> delivery_row.id
          and sibling_delivery.org_id = delivery_row.org_id
          and sibling_delivery.task_id = delivery_row.task_id
          and sibling_delivery.status not in ('failed', 'cancelled')
          and sibling_delivery.provider_payload ->> 'accessLinkId' = access_link_id::text
      )
    then
      update public.task_access_links access_link
      set revoked_at = coalesce(access_link.revoked_at, clock_timestamp())
      where access_link.id = access_link_id
        and access_link.task_id = task_row.id;
    end if;
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
    task_row.org_id,
    task_row.id,
    'delivery_reconciled',
    'system',
    'HusHub drift',
    case normalized_resolution
      when 'sent' then 'Ett osäkert leveransutfall verifierades som skickat.'
      else 'Ett osäkert leveransutfall verifierades som inte skickat.'
    end,
    jsonb_build_object(
      'taskMutationApplied', true,
      'deliveryReconciliation', true,
      'deliveryId', delivery_row.id,
      'messageId', message_row.id,
      'resolution', normalized_resolution,
      'channel', delivery_row.channel,
      'provider', delivery_row.provider,
      'providerMessageIdRecorded', normalized_provider_message_id is not null,
      'operatorNote', operator_note
    )
  );

  if task_row.archived_at is null
    and task_row.status not in ('draft', 'approved', 'cancelled')
  then
    insert into public.task_automation_jobs (
      org_id,
      task_id,
      message_id,
      delivery_id,
      job_type,
      status,
      available_at,
      idempotency_key,
      payload
    )
    values (
      task_row.org_id,
      task_row.id,
      message_row.id,
      delivery_row.id,
      'evaluate_followup',
      'queued',
      clock_timestamp(),
      'task-delivery-resolution:' || delivery_row.id::text
        || ':' || normalized_resolution
        || ':v' || task_row.version::text,
      jsonb_build_object(
        'taskVersion', task_row.version,
        'scheduledFrom', 'delivery-reconciliation',
        'deliveryId', delivery_row.id,
        'resolution', normalized_resolution
      )
    )
    on conflict (org_id, idempotency_key) do nothing;
    get diagnostics requeued_count = row_count;
  end if;

  return jsonb_build_object(
    'deliveryId', delivery_row.id,
    'taskId', task_row.id,
    'resolution', normalized_resolution,
    'requeued', requeued_count = 1
  );
end;
$$;

revoke all on function public.resolve_task_message_delivery(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_task_message_delivery(uuid, text, text, text)
  to service_role;

comment on function public.resolve_task_message_delivery(uuid, text, text, text) is
  'Service-only, audited reconciliation for one ambiguous provider delivery. Never include credentials or bearer URLs in p_note.';

-- ---------------------------------------------------------------------
-- Organization reminder timezone and allowed delivery window
-- ---------------------------------------------------------------------

alter table public.task_organization_settings
  add column if not exists reminder_send_window_start time without time zone
    not null default time '07:00',
  add column if not exists reminder_send_window_end time without time zone
    not null default time '20:00',
  add column if not exists reminder_send_weekdays smallint[]
    not null default array[1, 2, 3, 4, 5, 6, 7]::smallint[];

-- Do not let a legacy free-text timezone make later trigger validation fail.
update public.task_organization_settings settings
set timezone = 'Europe/Stockholm'
where nullif(btrim(settings.timezone), '') is null
   or not exists (
     select 1
     from pg_catalog.pg_timezone_names timezone_name
     where timezone_name.name = settings.timezone
   );

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_reminder_window_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_reminder_window_check
      check (reminder_send_window_start < reminder_send_window_end);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.task_organization_settings'::regclass
      and constraint_row.conname = 'task_organization_settings_reminder_weekdays_check'
  ) then
    alter table public.task_organization_settings
      add constraint task_organization_settings_reminder_weekdays_check
      check (
        cardinality(reminder_send_weekdays) between 1 and 7
        and reminder_send_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      );
  end if;
end;
$$;

create or replace function public.validate_task_organization_reminder_schedule()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(new.timezone), '') is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = new.timezone
    )
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ORGANIZATION_TIMEZONE_INVALID';
  end if;

  if new.reminder_send_window_start >= new.reminder_send_window_end then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_SEND_WINDOW_INVALID';
  end if;

  if new.reminder_send_weekdays is null
    or cardinality(new.reminder_send_weekdays) not between 1 and 7
    or not (new.reminder_send_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_SEND_WEEKDAYS_INVALID';
  end if;

  -- Canonical ordering prevents semantically identical settings from producing
  -- noisy updates while still allowing callers to submit an unordered array.
  new.reminder_send_weekdays := (
    select array_agg(distinct weekday order by weekday)::smallint[]
    from unnest(new.reminder_send_weekdays) weekday
  );

  return new;
end;
$$;

drop trigger if exists trg_validate_task_organization_reminder_schedule
  on public.task_organization_settings;
create trigger trg_validate_task_organization_reminder_schedule
before insert or update of
  timezone,
  reminder_send_window_start,
  reminder_send_window_end,
  reminder_send_weekdays
on public.task_organization_settings
for each row execute function public.validate_task_organization_reminder_schedule();

revoke all on function public.validate_task_organization_reminder_schedule()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Immutable timezone snapshot for each task deadline
-- ---------------------------------------------------------------------

alter table public.operational_tasks
  add column if not exists due_timezone text;

-- due_timezone is an immutable display/intention snapshot, not a business
-- mutation. Backfill it without bumping task.version, so existing queue payloads
-- remain valid. The hierarchy trigger is also update-wide and could reject a
-- historical child whose parent has since closed. Disable exactly those two
-- triggers inside one atomic statement; ALTER's table lock blocks concurrent
-- task DML, and any error rolls the entire DO statement (including trigger
-- state) back.
do $$
begin
  execute 'alter table public.operational_tasks disable trigger trg_prepare_operational_task_hierarchy';
  execute 'alter table public.operational_tasks disable trigger trg_operational_task_set_updated_at_and_version';

  update public.operational_tasks task
  set due_timezone = coalesce(settings.timezone, 'Europe/Stockholm')
  from public.task_organization_settings settings
  where settings.org_id = task.org_id
    and (
      nullif(btrim(task.due_timezone), '') is null
      or not exists (
        select 1
        from pg_catalog.pg_timezone_names timezone_name
        where timezone_name.name = task.due_timezone
      )
    );

  update public.operational_tasks task
  set due_timezone = 'Europe/Stockholm'
  where nullif(btrim(task.due_timezone), '') is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_name
       where timezone_name.name = task.due_timezone
     );

  execute 'alter table public.operational_tasks enable trigger trg_operational_task_set_updated_at_and_version';
  execute 'alter table public.operational_tasks enable trigger trg_prepare_operational_task_hierarchy';
end;
$$;

alter table public.operational_tasks
  alter column due_timezone set default 'Europe/Stockholm',
  alter column due_timezone set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.operational_tasks'::regclass
      and constraint_row.conname = 'operational_tasks_due_timezone_check'
  ) then
    alter table public.operational_tasks
      add constraint operational_tasks_due_timezone_check
      check (nullif(btrim(due_timezone), '') is not null);
  end if;
end;
$$;

create or replace function public.snapshot_operational_task_due_timezone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  configured_timezone text;
begin
  if tg_op = 'UPDATE' then
    if new.due_timezone is distinct from old.due_timezone then
      raise exception using
        errcode = '23514',
        message = 'OPERATIONAL_TASK_DUE_TIMEZONE_IMMUTABLE';
    end if;
    return new;
  end if;

  select settings.timezone
  into configured_timezone
  from public.task_organization_settings settings
  where settings.org_id = new.org_id;

  if configured_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = configured_timezone
    )
  then
    configured_timezone := 'Europe/Stockholm';
  end if;

  -- The database, not the client payload, owns the snapshot.
  new.due_timezone := configured_timezone;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_operational_task_due_timezone
  on public.operational_tasks;
create trigger trg_snapshot_operational_task_due_timezone
before insert or update of due_timezone
on public.operational_tasks
for each row execute function public.snapshot_operational_task_due_timezone();

revoke all on function public.snapshot_operational_task_due_timezone()
  from public, anon, authenticated;

comment on column public.operational_tasks.due_timezone is
  'Immutable IANA timezone snapshot used when the deadline was created. due_at remains the absolute UTC instant.';

-- Returns the first instant at which an automated reminder may be delivered.
-- The result is always greater than or equal to p_candidate_at.
create or replace function public.task_next_allowed_reminder_at(
  p_org_id uuid,
  p_candidate_at timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  configured_timezone text;
  window_start time without time zone;
  window_end time without time zone;
  send_weekdays smallint[];
  local_candidate timestamp without time zone;
  candidate_date date;
  candidate_time time without time zone;
  candidate_weekday smallint;
  day_offset integer;
  target_date date;
  target_weekday smallint;
  target_local timestamp without time zone;
  target_at timestamptz;
begin
  if p_org_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_ORGANIZATION_REQUIRED';
  end if;
  if p_candidate_at is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_REMINDER_CANDIDATE_REQUIRED';
  end if;

  select
    settings.timezone,
    settings.reminder_send_window_start,
    settings.reminder_send_window_end,
    settings.reminder_send_weekdays
  into
    configured_timezone,
    window_start,
    window_end,
    send_weekdays
  from public.task_organization_settings settings
  where settings.org_id = p_org_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_ORGANIZATION_SETTINGS_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_name
    where timezone_name.name = configured_timezone
  ) then
    raise exception using
      errcode = '22023',
      message = 'TASK_ORGANIZATION_TIMEZONE_INVALID';
  end if;

  local_candidate := p_candidate_at at time zone configured_timezone;
  candidate_date := local_candidate::date;
  candidate_time := local_candidate::time;
  candidate_weekday := extract(isodow from local_candidate)::smallint;

  if candidate_weekday = any(send_weekdays)
    and candidate_time >= window_start
    and candidate_time < window_end
  then
    return p_candidate_at;
  end if;

  for day_offset in 0..7 loop
    target_date := candidate_date + day_offset;
    target_weekday := extract(isodow from target_date)::smallint;
    if not (target_weekday = any(send_weekdays)) then
      continue;
    end if;

    if day_offset = 0 and candidate_time >= window_start then
      continue;
    end if;

    target_local := target_date + window_start;
    target_at := target_local at time zone configured_timezone;
    if target_at >= p_candidate_at then
      return target_at;
    end if;
  end loop;

  -- Validation guarantees at least one permitted weekday, so this is defensive.
  raise exception using
    errcode = '22023',
    message = 'TASK_REMINDER_SEND_WINDOW_UNRESOLVABLE';
end;
$$;

revoke all on function public.task_next_allowed_reminder_at(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.task_next_allowed_reminder_at(uuid, timestamptz)
  to service_role;

-- Existing claim queries sort by available_at, created_at and id. These covering
-- indexes keep both ready work and stale-worker recovery bounded as the queue grows.
create index if not exists task_automation_jobs_claim_ready_v2_idx
  on public.task_automation_jobs (available_at, created_at, id)
  include (attempt_count, max_attempts)
  where status in ('queued', 'failed');

create index if not exists task_automation_jobs_stale_processing_v2_idx
  on public.task_automation_jobs ((coalesce(heartbeat_at, locked_at)), id)
  include (attempt_count, max_attempts)
  where status = 'processing';

-- ---------------------------------------------------------------------
-- Secure Supabase Cron -> HusHub dispatcher
-- ---------------------------------------------------------------------

-- Fixed Vault names. Values are provisioned through the Supabase Vault UI:
--   hushub_task_followup_endpoint_url  (HTTPS URL ending /api/cron/tasks/followup)
--   hushub_task_followup_cron_secret   (same value as Vercel CRON_SECRET)

create or replace function public.invoke_task_followup_cron()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  endpoint_url text;
  cron_secret text;
  request_id bigint;
begin
  select secret_row.decrypted_secret
  into endpoint_url
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'hushub_task_followup_endpoint_url'
  order by secret_row.updated_at desc
  limit 1;

  select secret_row.decrypted_secret
  into cron_secret
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'hushub_task_followup_cron_secret'
  order by secret_row.updated_at desc
  limit 1;

  if nullif(btrim(endpoint_url), '') is null
    or nullif(btrim(cron_secret), '') is null
  then
    raise exception using
      errcode = '55000',
      message = 'TASK_FOLLOWUP_CRON_VAULT_CONFIGURATION_MISSING';
  end if;

  endpoint_url := btrim(endpoint_url);
  cron_secret := btrim(cron_secret);

  if endpoint_url !~ '^https://[^[:space:]/?#]+/api/cron/tasks/followup$'
    or cron_secret !~ '^[^[:space:]]+$'
    or length(cron_secret) not between 16 and 512
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_FOLLOWUP_CRON_VAULT_CONFIGURATION_INVALID';
  end if;

  select net.http_get(
    url := endpoint_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Accept', 'application/json',
      'Cache-Control', 'no-store'
    ),
    timeout_milliseconds := 55000
  )
  into request_id;

  return jsonb_build_object(
    'status', 'requested',
    'requestId', request_id,
    'requestedAt', clock_timestamp()
  );
end;
$$;

revoke all on function public.invoke_task_followup_cron()
  from public, anon, authenticated;
grant execute on function public.invoke_task_followup_cron()
  to service_role;

create or replace function public.configure_task_followup_cron()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  endpoint_url text;
  cron_secret text;
  dispatch_job_id bigint;
begin
  select secret_row.decrypted_secret
  into endpoint_url
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'hushub_task_followup_endpoint_url'
  order by secret_row.updated_at desc
  limit 1;

  select secret_row.decrypted_secret
  into cron_secret
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'hushub_task_followup_cron_secret'
  order by secret_row.updated_at desc
  limit 1;

  if nullif(btrim(endpoint_url), '') is null
    or nullif(btrim(cron_secret), '') is null
  then
    raise exception using
      errcode = '55000',
      message = 'TASK_FOLLOWUP_CRON_VAULT_CONFIGURATION_MISSING';
  end if;

  endpoint_url := btrim(endpoint_url);
  cron_secret := btrim(cron_secret);

  if endpoint_url !~ '^https://[^[:space:]/?#]+/api/cron/tasks/followup$' then
    raise exception using
      errcode = '22023',
      message = 'TASK_FOLLOWUP_CRON_ENDPOINT_INVALID';
  end if;
  if cron_secret !~ '^[^[:space:]]+$'
    or length(cron_secret) not between 16 and 512
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_FOLLOWUP_CRON_SECRET_INVALID';
  end if;

  select cron.schedule(
    'hushub-task-followup-dispatch-v1',
    '*/5 * * * *',
    'select public.invoke_task_followup_cron();'
  )
  into dispatch_job_id;
  perform cron.alter_job(dispatch_job_id, active := true);

  return jsonb_build_object(
    'configured', true,
    'jobId', dispatch_job_id,
    'jobName', 'hushub-task-followup-dispatch-v1',
    'schedule', '*/5 * * * *'
  );
end;
$$;

revoke all on function public.configure_task_followup_cron()
  from public, anon, authenticated;
grant execute on function public.configure_task_followup_cron()
  to service_role;

create or replace function public.task_followup_cron_configuration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  endpoint_configured boolean;
  secret_configured boolean;
  dispatch_job_id bigint;
  dispatch_schedule text;
  dispatch_active boolean;
  latest_status text;
  latest_started_at timestamptz;
  latest_ended_at timestamptz;
begin
  select exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name = 'hushub_task_followup_endpoint_url'
  ) into endpoint_configured;

  select exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name = 'hushub_task_followup_cron_secret'
  ) into secret_configured;

  select job.jobid, job.schedule, job.active
  into dispatch_job_id, dispatch_schedule, dispatch_active
  from cron.job job
  where job.jobname = 'hushub-task-followup-dispatch-v1'
  order by job.jobid desc
  limit 1;

  if dispatch_job_id is not null then
    select run.status, run.start_time, run.end_time
    into latest_status, latest_started_at, latest_ended_at
    from cron.job_run_details run
    where run.jobid = dispatch_job_id
    order by run.runid desc
    limit 1;
  end if;

  return jsonb_build_object(
    'endpointConfigured', endpoint_configured,
    'secretConfigured', secret_configured,
    'jobId', dispatch_job_id,
    'schedule', dispatch_schedule,
    'active', coalesce(dispatch_active, false),
    'latestRunStatus', latest_status,
    'latestRunStartedAt', latest_started_at,
    'latestRunEndedAt', latest_ended_at
  );
end;
$$;

revoke all on function public.task_followup_cron_configuration_status()
  from public, anon, authenticated;
grant execute on function public.task_followup_cron_configuration_status()
  to service_role;

-- pg_cron does not prune job_run_details automatically. Keep 30 days through a
-- small daily maintenance job; it contains no endpoint or credential.
create or replace function public.cleanup_task_cron_job_run_details(
  p_retention interval default interval '30 days'
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
    or p_retention < interval '7 days'
    or p_retention > interval '365 days'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_CRON_HISTORY_RETENTION_INVALID';
  end if;

  delete from cron.job_run_details run
  using cron.job job
  where run.jobid = job.jobid
    and job.jobname in (
      'hushub-task-followup-dispatch-v1',
      'hushub-cron-history-cleanup-v1'
    )
    and coalesce(run.end_time, run.start_time) < clock_timestamp() - p_retention;
  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.cleanup_task_cron_job_run_details(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_task_cron_job_run_details(interval)
  to service_role;

-- Completed/cancelled queue rows are operational state, not the business
-- audit. Events, messages and deliveries remain untouched. Failed, processing
-- and dead-letter jobs are also retained for diagnosis and recovery.
create or replace function public.cleanup_task_automation_jobs(
  p_retention interval default interval '90 days'
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
      message = 'TASK_AUTOMATION_JOB_RETENTION_INVALID';
  end if;

  delete from public.task_automation_jobs job
  where job.status in ('completed', 'cancelled')
    and coalesce(job.completed_at, job.updated_at, job.created_at)
      < clock_timestamp() - p_retention;
  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.cleanup_task_automation_jobs(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_task_automation_jobs(interval)
  to service_role;

create or replace function public.run_task_automation_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  deleted_cron_history_rows bigint;
  deleted_automation_job_rows bigint;
begin
  select public.cleanup_task_automation_jobs(interval '90 days')
  into deleted_automation_job_rows;
  select public.cleanup_task_cron_job_run_details(interval '30 days')
  into deleted_cron_history_rows;

  return jsonb_build_object(
    'deletedAutomationJobRows', deleted_automation_job_rows,
    'deletedCronHistoryRows', deleted_cron_history_rows,
    'completedAt', clock_timestamp()
  );
end;
$$;

revoke all on function public.run_task_automation_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_task_automation_maintenance()
  to service_role;

-- The dispatcher is deliberately not created here. configure() validates Vault
-- after the application endpoint has been deployed, then creates/updates and
-- activates it. This also means a migration rerun cannot deactivate an already
-- configured production dispatcher.
--
-- The credential-free cleanup schedule is safe to create immediately.
do $$
declare
  cleanup_job_id bigint;
begin
  select cron.schedule(
    'hushub-cron-history-cleanup-v1',
    '17 2 * * *',
    $command$select public.run_task_automation_maintenance();$command$
  ) into cleanup_job_id;
  perform cron.alter_job(cleanup_job_id, active := true);
end;
$$;
