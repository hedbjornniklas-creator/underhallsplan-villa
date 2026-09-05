-- Inspection reports: durable, self-healing PDF generation queue for OB, TU and EB
-- Date: 2026-09-05
-- Prerequisites:
--  - 2026-03-20_02_inspection_report_links_pdf_job_status.sql
--
-- The application remains the PDF worker. This migration makes
-- inspection_report_links the durable queue, gives workers atomic claim/finish
-- RPCs and lets Supabase Cron wake the application without relying on a browser
-- session or on a single best-effort after() callback.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.inspection_report_links
  add column if not exists pdf_max_attempts integer,
  add column if not exists pdf_next_attempt_at timestamptz,
  add column if not exists pdf_locked_at timestamptz,
  add column if not exists pdf_locked_by text;

-- The original column was integer. bigint keeps the worker RPC and storage
-- metadata safe for unusually large generated files.
alter table public.inspection_report_links
  alter column pdf_size_bytes type bigint
  using pdf_size_bytes::bigint;

update public.inspection_report_links link
set pdf_max_attempts = greatest(
  1,
  least(
    20,
    greatest(
      coalesce(link.pdf_max_attempts, 3),
      coalesce(link.pdf_attempts, 0)
    )
  )
);

alter table public.inspection_report_links
  alter column pdf_max_attempts set default 3,
  alter column pdf_max_attempts set not null,
  alter column pdf_next_attempt_at set default now();

-- Preserve already completed rows without changing the semantic state of a
-- row that was deliberately queued again after an earlier PDF was generated.
update public.inspection_report_links link
set
  pdf_error = null,
  pdf_next_attempt_at = null,
  pdf_locked_at = null,
  pdf_locked_by = null,
  pdf_generated_at = coalesce(link.pdf_generated_at, link.created_at)
where link.pdf_status = 'ready'
  and (
    btrim(coalesce(link.pdf_base64, '')) <> ''
    or (
      btrim(coalesce(link.pdf_storage_bucket, '')) <> ''
      and btrim(coalesce(link.pdf_storage_path, '')) <> ''
    )
  );

-- A frozen snapshot is the source of truth for all three report modules. Jobs
-- created before snapshot support cannot be rendered reproducibly and must be
-- terminal instead of remaining pending forever.
update public.inspection_report_links link
set
  pdf_status = 'failed',
  pdf_error = 'REPORT_PDF_SNAPSHOT_MISSING',
  pdf_next_attempt_at = null,
  pdf_locked_at = null,
  pdf_locked_by = null
where link.revoked_at is null
  and link.snapshot_payload is null
  and link.pdf_status in ('pending', 'processing', 'failed');

-- A worker from the previous deployment may still be active while this
-- migration is applied. Preserve that claim and let the stale-claim timeout
-- recover it only if it really stops responding.
update public.inspection_report_links link
set
  pdf_locked_at = coalesce(link.pdf_locked_at, link.pdf_started_at, link.created_at),
  pdf_locked_by = coalesce(nullif(btrim(link.pdf_locked_by), ''), 'legacy-worker'),
  pdf_next_attempt_at = null
where link.revoked_at is null
  and link.pdf_status = 'processing'
  and link.snapshot_payload is not null;

-- Existing pending jobs, including the old pending/attempts=0 failure mode, are
-- immediately eligible. Legacy failed jobs that still have attempts left are
-- safely requeued as well.
update public.inspection_report_links link
set
  pdf_status = 'pending',
  pdf_next_attempt_at = coalesce(link.pdf_next_attempt_at, now()),
  pdf_locked_at = null,
  pdf_locked_by = null
where link.revoked_at is null
  and link.snapshot_payload is not null
  and link.pdf_status in ('pending', 'failed')
  and link.pdf_attempts < link.pdf_max_attempts;

-- Rows with no remaining attempts are terminal instead of being left in a
-- non-runnable pending state.
update public.inspection_report_links link
set
  pdf_status = 'failed',
  pdf_error = coalesce(link.pdf_error, 'REPORT_PDF_MAX_ATTEMPTS_REACHED'),
  pdf_next_attempt_at = null,
  pdf_locked_at = null,
  pdf_locked_by = null
where link.pdf_status in ('pending', 'failed')
  and link.pdf_attempts >= link.pdf_max_attempts;

update public.inspection_report_links link
set
  pdf_next_attempt_at = null,
  pdf_locked_at = null,
  pdf_locked_by = null
where link.pdf_status = 'ready'
   or link.revoked_at is not null;

update public.inspection_report_links link
set pdf_size_bytes = null
where link.pdf_size_bytes is not null
  and link.pdf_size_bytes <= 0;

alter table public.inspection_report_links
  drop constraint if exists inspection_report_links_pdf_max_attempts_check,
  drop constraint if exists inspection_report_links_pdf_locked_by_check,
  drop constraint if exists inspection_report_links_pdf_size_bytes_check;

alter table public.inspection_report_links
  add constraint inspection_report_links_pdf_max_attempts_check
    check (pdf_max_attempts between 1 and 20),
  add constraint inspection_report_links_pdf_locked_by_check
    check (
      pdf_locked_by is null
      or (
        btrim(pdf_locked_by) <> ''
        and char_length(pdf_locked_by) <= 200
      )
    ),
  add constraint inspection_report_links_pdf_size_bytes_check
    check (pdf_size_bytes is null or pdf_size_bytes > 0);

-- Ready and delayed work, plus stale worker recovery, remain index-bounded as
-- the shared OB/TU/EB queue grows.
-- v1 existed briefly with a broader predicate during rollout. Retire it by
-- name so rerunning the revised migration cannot silently keep that shape.
drop index if exists public.inspection_report_links_pdf_claim_ready_v1_idx;

create index if not exists inspection_report_links_pdf_claim_ready_v2_idx
  on public.inspection_report_links (
    (coalesce(pdf_next_attempt_at, created_at)),
    created_at,
    id
  )
  include (pdf_attempts, pdf_max_attempts)
  where revoked_at is null
    and snapshot_payload is not null
    and pdf_status in ('pending', 'failed')
    and pdf_attempts < pdf_max_attempts;

create index if not exists inspection_report_links_pdf_claim_stale_v1_idx
  on public.inspection_report_links (
    (coalesce(pdf_locked_at, pdf_started_at, created_at)),
    id
  )
  include (pdf_attempts, pdf_max_attempts)
  where revoked_at is null
    and snapshot_payload is not null
    and pdf_status = 'processing';

comment on column public.inspection_report_links.pdf_max_attempts is
  'Maximum automatic PDF generation attempts before terminal failure.';

comment on column public.inspection_report_links.pdf_next_attempt_at is
  'Earliest time at which a pending or retryable failed PDF job may be claimed.';

comment on column public.inspection_report_links.pdf_locked_at is
  'Time at which the current PDF worker atomically claimed the report link.';

comment on column public.inspection_report_links.pdf_locked_by is
  'Unique worker execution id. A finish RPC must present the same id.';

-- Workers call this in a short transaction. FOR UPDATE SKIP LOCKED permits
-- concurrent immediate and cron workers without rendering the same link twice.
-- p_link_id is used by the fast path immediately after a link is created; a
-- null p_link_id drains the shared queue in scheduled runs. A short grace on a
-- brand-new generic claim lets delivery metadata finish before the cron worker
-- freezes the PDF, while the explicit after() fast path may start immediately.
-- DROP is intentional: an earlier rollout draft returned a wider TABLE shape,
-- which CREATE OR REPLACE cannot change in PostgreSQL.
drop function if exists public.claim_inspection_report_pdf_jobs(text, integer, interval, uuid);

create or replace function public.claim_inspection_report_pdf_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_stale_after interval default interval '10 minutes',
  p_link_id uuid default null
)
returns table (
  id uuid,
  org_id uuid,
  inspection_id uuid,
  pdf_attempts integer,
  pdf_max_attempts integer,
  pdf_locked_by text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claim_time timestamptz := clock_timestamp();
begin
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null
    or char_length(p_worker_id) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_WORKER_ID_INVALID';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_WORKER_LIMIT_INVALID';
  end if;

  if p_stale_after is null
    -- Every application route that can own a claim has a five-minute hard
    -- limit. Keep at least one additional minute before another worker may
    -- recover it, so a valid finalization is never fenced out prematurely.
    or p_stale_after < interval '6 minutes'
    or p_stale_after > interval '24 hours'
  then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_WORKER_STALE_INTERVAL_INVALID';
  end if;

  -- Keep malformed or manually requeued legacy rows from becoming invisible
  -- queue entries after the one-time migration backfill has run.
  update public.inspection_report_links link
  set
    pdf_status = 'failed',
    pdf_error = 'REPORT_PDF_SNAPSHOT_MISSING',
    pdf_next_attempt_at = null,
    pdf_locked_at = null,
    pdf_locked_by = null
  where (p_link_id is null or link.id = p_link_id)
    and link.revoked_at is null
    and link.snapshot_payload is null
    and link.pdf_status in ('pending', 'processing');

  -- A process can die after claiming its final permitted attempt. Finalize
  -- those stale rows before selecting more work so none remain processing
  -- forever. When p_link_id is set, keep this mutation scoped to that link.
  update public.inspection_report_links link
  set
    pdf_status = 'failed',
    pdf_error = coalesce(link.pdf_error, 'REPORT_PDF_STALE_AFTER_FINAL_ATTEMPT'),
    pdf_next_attempt_at = null,
    pdf_locked_at = null,
    pdf_locked_by = null
  where (p_link_id is null or link.id = p_link_id)
    and link.revoked_at is null
    and link.pdf_status = 'processing'
    and coalesce(link.pdf_locked_at, link.pdf_started_at, link.created_at)
      < claim_time - p_stale_after
    and link.pdf_attempts >= link.pdf_max_attempts;

  return query
  with candidates as (
    select link.id
    from public.inspection_report_links link
    where (p_link_id is null or link.id = p_link_id)
      and link.revoked_at is null
      and link.snapshot_payload is not null
      and link.pdf_attempts < link.pdf_max_attempts
      and (
        (
          link.pdf_status in ('pending', 'failed')
          and coalesce(link.pdf_next_attempt_at, link.created_at) <= claim_time
          and (
            p_link_id is not null
            or link.pdf_status = 'failed'
            or link.pdf_attempts > 0
            or link.created_at <= claim_time - interval '90 seconds'
          )
        )
        or (
          link.pdf_status = 'processing'
          and coalesce(link.pdf_locked_at, link.pdf_started_at, link.created_at)
            < claim_time - p_stale_after
        )
      )
    order by
      coalesce(link.pdf_next_attempt_at, link.pdf_locked_at, link.pdf_started_at, link.created_at),
      link.created_at,
      link.id
    for update of link skip locked
    limit p_limit
  )
  update public.inspection_report_links link
  set
    pdf_status = 'processing',
    pdf_error = null,
    pdf_attempts = link.pdf_attempts + 1,
    pdf_started_at = claim_time,
    pdf_next_attempt_at = null,
    pdf_locked_at = claim_time,
    pdf_locked_by = btrim(p_worker_id)
  from candidates
  where link.id = candidates.id
  returning
    link.id,
    link.org_id,
    link.inspection_id,
    link.pdf_attempts,
    link.pdf_max_attempts,
    link.pdf_locked_by;
end;
$$;

-- Only the worker that owns the active claim may complete it. Retryable errors
-- return to pending with exponential backoff (1, 2, 4 ... up to 30 minutes).
create or replace function public.finish_inspection_report_pdf_job(
  p_link_id uuid,
  p_worker_id text,
  p_success boolean,
  p_error text default null,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_size_bytes bigint default null,
  p_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  finish_time timestamptz := clock_timestamp();
  result jsonb;
begin
  if p_link_id is null then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_LINK_ID_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_worker_id, '')), '') is null
    or char_length(p_worker_id) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_WORKER_ID_INVALID';
  end if;

  if p_success is null then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_RESULT_REQUIRED';
  end if;

  if p_success and (
    nullif(btrim(coalesce(p_storage_bucket, '')), '') is null
    or nullif(btrim(coalesce(p_storage_path, '')), '') is null
    or p_size_bytes is null
    or p_size_bytes <= 0
    or p_size_bytes > 10737418240
    or coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_SUCCESS_METADATA_INVALID';
  end if;

  update public.inspection_report_links link
  set
    pdf_status = case
      when p_success then 'ready'
      when link.pdf_attempts >= link.pdf_max_attempts then 'failed'
      else 'pending'
    end,
    pdf_error = case
      when p_success then null
      else left(coalesce(nullif(btrim(p_error), ''), 'Unknown report PDF worker error'), 4000)
    end,
    pdf_next_attempt_at = case
      when p_success or link.pdf_attempts >= link.pdf_max_attempts then null
      else finish_time + make_interval(
        secs => least(
          1800::double precision,
          60::double precision * power(
            2::double precision,
            greatest(link.pdf_attempts - 1, 0)::double precision
          )
        )
      )
    end,
    pdf_locked_at = null,
    pdf_locked_by = null,
    pdf_generated_at = case when p_success then finish_time else link.pdf_generated_at end,
    pdf_storage_bucket = case when p_success then btrim(p_storage_bucket) else link.pdf_storage_bucket end,
    pdf_storage_path = case when p_success then btrim(p_storage_path) else link.pdf_storage_path end,
    pdf_size_bytes = case when p_success then p_size_bytes else link.pdf_size_bytes end,
    pdf_sha256 = case when p_success then p_sha256 else link.pdf_sha256 end,
    pdf_base64 = case when p_success then null else link.pdf_base64 end
  where link.id = p_link_id
    and link.revoked_at is null
    and link.pdf_status = 'processing'
    and link.pdf_locked_by = btrim(p_worker_id)
  returning jsonb_build_object(
    'id', link.id,
    'pdfStatus', link.pdf_status,
    'attempts', link.pdf_attempts,
    'nextAttemptAt', link.pdf_next_attempt_at,
    'alreadyFinished', false
  ) into result;

  if not found then
    -- A worker can lose the HTTP response after the database committed. Treat
    -- an exact repeat of the same successful finish as success so retries do
    -- not turn a completed PDF into a false failure.
    if p_success then
      select jsonb_build_object(
        'id', link.id,
        'pdfStatus', link.pdf_status,
        'attempts', link.pdf_attempts,
        'nextAttemptAt', link.pdf_next_attempt_at,
        'alreadyFinished', true
      )
      into result
      from public.inspection_report_links link
      where link.id = p_link_id
        and link.revoked_at is null
        and link.pdf_status = 'ready'
        and link.pdf_storage_bucket = btrim(p_storage_bucket)
        and link.pdf_storage_path = btrim(p_storage_path)
        and link.pdf_size_bytes = p_size_bytes
        and link.pdf_sha256 = p_sha256;

      if found then
        return result;
      end if;
    end if;

    raise exception using
      errcode = 'P0002',
      message = 'REPORT_PDF_JOB_CLAIM_NOT_FOUND';
  end if;

  return result;
end;
$$;

revoke all on function public.claim_inspection_report_pdf_jobs(text, integer, interval, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_inspection_report_pdf_job(uuid, text, boolean, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.claim_inspection_report_pdf_jobs(text, integer, interval, uuid)
  to service_role;
grant execute on function public.finish_inspection_report_pdf_job(uuid, text, boolean, text, text, text, bigint, text)
  to service_role;

-- ---------------------------------------------------------------------
-- Secure Supabase Cron -> HusHub PDF dispatcher
-- ---------------------------------------------------------------------

-- Fixed Vault names. Provision their values through the Supabase Vault UI:
--   hushub_report_pdf_endpoint_url  (HTTPS URL ending /api/cron/reports/pdf)
--   hushub_report_pdf_cron_secret   (same value as Vercel CRON_SECRET)
-- If the existing task dispatcher is configured, its endpoint origin and
-- secret are reused automatically; no duplicate secret provisioning is needed.
-- No endpoint or credential is embedded in this migration.

-- Stores only request ids and timestamps, never endpoint URLs, headers or
-- secrets. This lets operations distinguish "pg_cron queued the request" from
-- "the application returned HTTP 200" by joining the id to pg_net's response.
create table if not exists public.inspection_report_pdf_cron_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);

alter table public.inspection_report_pdf_cron_requests enable row level security;

revoke all on table public.inspection_report_pdf_cron_requests
  from public, anon, authenticated;
grant select on table public.inspection_report_pdf_cron_requests
  to service_role;

comment on table public.inspection_report_pdf_cron_requests is
  'Non-secret pg_net request ids used to verify the report PDF dispatcher HTTP outcome.';

create or replace function public.invoke_inspection_report_pdf_cron()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  endpoint_url text;
  cron_secret text;
  request_id bigint;
  dispatch_requested_at timestamptz := clock_timestamp();
begin
  select secret_row.decrypted_secret
  into endpoint_url
  from vault.decrypted_secrets secret_row
  where secret_row.name in (
    'hushub_report_pdf_endpoint_url',
    'hushub_task_followup_endpoint_url'
  )
  order by
    case when secret_row.name = 'hushub_report_pdf_endpoint_url' then 0 else 1 end,
    secret_row.updated_at desc
  limit 1;

  select secret_row.decrypted_secret
  into cron_secret
  from vault.decrypted_secrets secret_row
  where secret_row.name in (
    'hushub_report_pdf_cron_secret',
    'hushub_task_followup_cron_secret'
  )
  order by
    case when secret_row.name = 'hushub_report_pdf_cron_secret' then 0 else 1 end,
    secret_row.updated_at desc
  limit 1;

  endpoint_url := regexp_replace(
    coalesce(endpoint_url, ''),
    '/api/cron/tasks/followup$',
    '/api/cron/reports/pdf'
  );

  if nullif(btrim(endpoint_url), '') is null
    or nullif(btrim(cron_secret), '') is null
  then
    raise exception using
      errcode = '55000',
      message = 'REPORT_PDF_CRON_VAULT_CONFIGURATION_MISSING';
  end if;

  endpoint_url := btrim(endpoint_url);
  cron_secret := btrim(cron_secret);

  if endpoint_url !~ '^https://[^[:space:]/?#]+/api/cron/reports/pdf$'
    or cron_secret !~ '^[^[:space:]]+$'
    or length(cron_secret) not between 16 and 512
  then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_CRON_VAULT_CONFIGURATION_INVALID';
  end if;

  select net.http_get(
    url := endpoint_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Accept', 'application/json',
      'Cache-Control', 'no-store'
    ),
    -- The worker's bounded browser setup plus render budget is at most 205 s.
    -- 280 s leaves time for upload/finalization and still expires before the
    -- application's 300 s route limit.
    timeout_milliseconds := 280000
  )
  into request_id;

  insert into public.inspection_report_pdf_cron_requests (
    request_id,
    requested_at
  ) values (
    request_id,
    dispatch_requested_at
  )
  on conflict (request_id) do update
  set requested_at = excluded.requested_at;

  delete from public.inspection_report_pdf_cron_requests request_log
  where request_log.requested_at < dispatch_requested_at - interval '24 hours';

  return jsonb_build_object(
    'status', 'requested',
    'requestId', request_id,
    'requestedAt', dispatch_requested_at
  );
end;
$$;

revoke all on function public.invoke_inspection_report_pdf_cron()
  from public, anon, authenticated;
grant execute on function public.invoke_inspection_report_pdf_cron()
  to service_role;

create or replace function public.configure_inspection_report_pdf_cron()
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
  where secret_row.name in (
    'hushub_report_pdf_endpoint_url',
    'hushub_task_followup_endpoint_url'
  )
  order by
    case when secret_row.name = 'hushub_report_pdf_endpoint_url' then 0 else 1 end,
    secret_row.updated_at desc
  limit 1;

  select secret_row.decrypted_secret
  into cron_secret
  from vault.decrypted_secrets secret_row
  where secret_row.name in (
    'hushub_report_pdf_cron_secret',
    'hushub_task_followup_cron_secret'
  )
  order by
    case when secret_row.name = 'hushub_report_pdf_cron_secret' then 0 else 1 end,
    secret_row.updated_at desc
  limit 1;

  endpoint_url := regexp_replace(
    coalesce(endpoint_url, ''),
    '/api/cron/tasks/followup$',
    '/api/cron/reports/pdf'
  );

  if nullif(btrim(endpoint_url), '') is null
    or nullif(btrim(cron_secret), '') is null
  then
    raise exception using
      errcode = '55000',
      message = 'REPORT_PDF_CRON_VAULT_CONFIGURATION_MISSING';
  end if;

  endpoint_url := btrim(endpoint_url);
  cron_secret := btrim(cron_secret);

  if endpoint_url !~ '^https://[^[:space:]/?#]+/api/cron/reports/pdf$' then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_CRON_ENDPOINT_INVALID';
  end if;

  if cron_secret !~ '^[^[:space:]]+$'
    or length(cron_secret) not between 16 and 512
  then
    raise exception using
      errcode = '22023',
      message = 'REPORT_PDF_CRON_SECRET_INVALID';
  end if;

  select cron.schedule(
    'hushub-report-pdf-dispatch-v1',
    '* * * * *',
    'select public.invoke_inspection_report_pdf_cron();'
  )
  into dispatch_job_id;
  perform cron.alter_job(dispatch_job_id, active := true);

  return jsonb_build_object(
    'configured', true,
    'jobId', dispatch_job_id,
    'jobName', 'hushub-report-pdf-dispatch-v1',
    'schedule', '* * * * *'
  );
end;
$$;

revoke all on function public.configure_inspection_report_pdf_cron()
  from public, anon, authenticated;
grant execute on function public.configure_inspection_report_pdf_cron()
  to service_role;

create or replace function public.inspection_report_pdf_cron_configuration_status()
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
  latest_http_request_id bigint;
  latest_http_requested_at timestamptz;
  latest_http_status_code integer;
  latest_http_timed_out boolean;
  latest_http_error text;
  latest_http_responded_at timestamptz;
  latest_completed_http_request_id bigint;
  latest_completed_http_requested_at timestamptz;
  latest_completed_http_status_code integer;
  latest_completed_http_timed_out boolean;
  latest_completed_http_error text;
  latest_completed_http_responded_at timestamptz;
begin
  select exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name in (
      'hushub_report_pdf_endpoint_url',
      'hushub_task_followup_endpoint_url'
    )
  ) into endpoint_configured;

  select exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name in (
      'hushub_report_pdf_cron_secret',
      'hushub_task_followup_cron_secret'
    )
  ) into secret_configured;

  select job.jobid, job.schedule, job.active
  into dispatch_job_id, dispatch_schedule, dispatch_active
  from cron.job job
  where job.jobname = 'hushub-report-pdf-dispatch-v1'
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

  select request_log.request_id, request_log.requested_at
  into latest_http_request_id, latest_http_requested_at
  from public.inspection_report_pdf_cron_requests request_log
  order by request_log.requested_at desc, request_log.request_id desc
  limit 1;

  if latest_http_request_id is not null then
    select
      response.status_code,
      response.timed_out,
      response.error_msg,
      response.created
    into
      latest_http_status_code,
      latest_http_timed_out,
      latest_http_error,
      latest_http_responded_at
    from net._http_response response
    where response.id = latest_http_request_id;
  end if;

  -- A newly queued request commonly has no response yet. Select the most
  -- recent completed response separately so it remains observable instead of
  -- being hidden for most of every one-minute cron interval.
  select
    request_log.request_id,
    request_log.requested_at,
    response.status_code,
    response.timed_out,
    response.error_msg,
    response.created
  into
    latest_completed_http_request_id,
    latest_completed_http_requested_at,
    latest_completed_http_status_code,
    latest_completed_http_timed_out,
    latest_completed_http_error,
    latest_completed_http_responded_at
  from public.inspection_report_pdf_cron_requests request_log
  join net._http_response response
    on response.id = request_log.request_id
  order by response.created desc, request_log.request_id desc
  limit 1;

  return jsonb_build_object(
    'endpointConfigured', endpoint_configured,
    'secretConfigured', secret_configured,
    'jobId', dispatch_job_id,
    'schedule', dispatch_schedule,
    'active', coalesce(dispatch_active, false),
    'latestCronInvocationStatus', latest_status,
    'latestCronInvocationStartedAt', latest_started_at,
    'latestCronInvocationEndedAt', latest_ended_at,
    'httpOutcomeTracked', true,
    'latestRequestedHttpRequestId', latest_http_request_id,
    'latestRequestedHttpRequestedAt', latest_http_requested_at,
    'latestRequestedHttpResponseAvailable', latest_http_responded_at is not null,
    'latestRequestedHttpOutcome', case
      when latest_http_request_id is null then 'not_requested'
      when latest_http_responded_at is null then 'pending'
      when coalesce(latest_http_timed_out, false) then 'timed_out'
      when nullif(btrim(coalesce(latest_http_error, '')), '') is not null then 'network_error'
      when latest_http_status_code between 200 and 299 then 'succeeded'
      else 'http_error'
    end,
    'latestCompletedHttpRequestId', latest_completed_http_request_id,
    'latestCompletedHttpRequestedAt', latest_completed_http_requested_at,
    'latestCompletedHttpStatusCode', latest_completed_http_status_code,
    'latestCompletedHttpTimedOut', latest_completed_http_timed_out,
    'latestCompletedHttpError', latest_completed_http_error,
    'latestCompletedHttpRespondedAt', latest_completed_http_responded_at,
    'latestCompletedHttpOutcome', case
      when latest_completed_http_request_id is null then 'not_completed'
      when coalesce(latest_completed_http_timed_out, false) then 'timed_out'
      when nullif(btrim(coalesce(latest_completed_http_error, '')), '') is not null
        then 'network_error'
      when latest_completed_http_status_code between 200 and 299 then 'succeeded'
      else 'http_error'
    end
  );
end;
$$;

revoke all on function public.inspection_report_pdf_cron_configuration_status()
  from public, anon, authenticated;
grant execute on function public.inspection_report_pdf_cron_configuration_status()
  to service_role;

-- Reuse the already configured task dispatcher credentials when available.
-- Otherwise the migration remains fail-closed until the report-specific Vault
-- values are provisioned and configure_inspection_report_pdf_cron() is called.
do $$
begin
  if exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name in (
      'hushub_report_pdf_endpoint_url',
      'hushub_task_followup_endpoint_url'
    )
  ) and exists (
    select 1
    from vault.secrets secret_row
    where secret_row.name in (
      'hushub_report_pdf_cron_secret',
      'hushub_task_followup_cron_secret'
    )
  ) then
    perform public.configure_inspection_report_pdf_cron();
  end if;
exception
  when sqlstate '55000' or sqlstate '22023' then
    -- Invalid or incomplete pre-existing Vault configuration must not roll
    -- back the queue schema. The dispatcher stays fail-closed until an
    -- administrator fixes Vault and calls configure_inspection_report_pdf_cron().
    raise warning 'Report PDF cron was not configured automatically (SQLSTATE %: %).',
      sqlstate,
      sqlerrm;
end;
$$;
