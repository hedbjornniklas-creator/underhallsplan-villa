-- Hotfix for deployments where 2026-09-05_01 has already been applied.
--
-- PostgreSQL can otherwise resolve the PL/pgSQL variable `request_id` and the
-- table column `request_id` ambiguously in the INSERT ... ON CONFLICT clause.
-- This migration only replaces the dispatcher function. It contains no
-- endpoint URL or credential; those values continue to be read from Vault at
-- invocation time.

begin;

create or replace function public.invoke_inspection_report_pdf_cron()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  endpoint_url text;
  cron_secret text;
  dispatched_request_id bigint;
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
    timeout_milliseconds := 280000
  )
  into dispatched_request_id;

  insert into public.inspection_report_pdf_cron_requests (
    request_id,
    requested_at
  ) values (
    dispatched_request_id,
    dispatch_requested_at
  )
  on conflict on constraint inspection_report_pdf_cron_requests_pkey do update
  set requested_at = excluded.requested_at;

  delete from public.inspection_report_pdf_cron_requests request_log
  where request_log.requested_at < dispatch_requested_at - interval '24 hours';

  return jsonb_build_object(
    'status', 'requested',
    'requestId', dispatched_request_id,
    'requestedAt', dispatch_requested_at
  );
end;
$$;

revoke all on function public.invoke_inspection_report_pdf_cron()
  from public, anon, authenticated;
grant execute on function public.invoke_inspection_report_pdf_cron()
  to service_role;

commit;
