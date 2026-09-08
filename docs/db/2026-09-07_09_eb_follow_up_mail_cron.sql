-- Apply after 07 (orders/outbox) and 08 (atomic remediation actions).
-- Uses the existing Supabase pg_cron, pg_net and Vault installation.
-- No credentials or fixed production URL are embedded here.
-- Optional Vault names:
--   hushub_eb_follow_up_endpoint_url: HTTPS .../api/cron/eb/follow-up
--   hushub_eb_follow_up_cron_secret: same value as server CRON_SECRET
-- Existing report-PDF/task endpoint origin and cron secret are reused if present.
begin;

create table if not exists public.eb_follow_up_cron_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default clock_timestamp()
);
alter table public.eb_follow_up_cron_requests enable row level security;
revoke all on public.eb_follow_up_cron_requests from public, anon, authenticated;
grant select on public.eb_follow_up_cron_requests to service_role;

create or replace function public.invoke_eb_follow_up_mail_cron()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  endpoint_url text;
  dispatcher_secret text;
  dispatched_request_id bigint;
begin
  select s.decrypted_secret into endpoint_url
  from vault.decrypted_secrets s
  where s.name in ('hushub_eb_follow_up_endpoint_url', 'hushub_report_pdf_endpoint_url', 'hushub_task_followup_endpoint_url')
  order by case s.name when 'hushub_eb_follow_up_endpoint_url' then 0 when 'hushub_report_pdf_endpoint_url' then 1 else 2 end,
    s.updated_at desc limit 1;
  select s.decrypted_secret into dispatcher_secret
  from vault.decrypted_secrets s
  where s.name in ('hushub_eb_follow_up_cron_secret', 'hushub_report_pdf_cron_secret', 'hushub_task_followup_cron_secret')
  order by case s.name when 'hushub_eb_follow_up_cron_secret' then 0 when 'hushub_report_pdf_cron_secret' then 1 else 2 end,
    s.updated_at desc limit 1;
  endpoint_url := regexp_replace(btrim(coalesce(endpoint_url, '')), '/api/cron/(reports/pdf|tasks/followup)$', '/api/cron/eb/follow-up');
  dispatcher_secret := btrim(coalesce(dispatcher_secret, ''));
  if endpoint_url !~ '^https://[^[:space:]/?#]+/api/cron/eb/follow-up$'
    or length(dispatcher_secret) not between 16 and 512 or dispatcher_secret ~ '[[:space:]]' then
    raise exception using errcode = '55000', message = 'EB_FOLLOW_UP_CRON_VAULT_CONFIGURATION_MISSING_OR_INVALID';
  end if;
  select net.http_get(
    url := endpoint_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || dispatcher_secret, 'Accept', 'application/json'),
    timeout_milliseconds := 55000
  ) into dispatched_request_id;
  insert into public.eb_follow_up_cron_requests (request_id) values (dispatched_request_id)
    on conflict on constraint eb_follow_up_cron_requests_pkey do nothing;
  delete from public.eb_follow_up_cron_requests where requested_at < clock_timestamp() - interval '24 hours';
  return jsonb_build_object('status', 'requested', 'requestId', dispatched_request_id);
end;
$$;

create or replace function public.configure_eb_follow_up_mail_cron()
returns bigint language plpgsql security definer set search_path = pg_catalog as $$
declare dispatch_job_id bigint;
begin
  -- Do not dispatch here: configuration must not send an email as a side effect.
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception using errcode = '55000', message = 'EB_FOLLOW_UP_CRON_EXTENSIONS_MISSING';
  end if;
  if not exists (select 1 from vault.secrets where name in ('hushub_eb_follow_up_endpoint_url', 'hushub_report_pdf_endpoint_url', 'hushub_task_followup_endpoint_url'))
    or not exists (select 1 from vault.secrets where name in ('hushub_eb_follow_up_cron_secret', 'hushub_report_pdf_cron_secret', 'hushub_task_followup_cron_secret')) then
    raise exception using errcode = '55000', message = 'EB_FOLLOW_UP_CRON_VAULT_CONFIGURATION_MISSING_OR_INVALID';
  end if;
  select cron.schedule('hushub-eb-follow-up-mail-v1', '* * * * *', 'select public.invoke_eb_follow_up_mail_cron();') into dispatch_job_id;
  return dispatch_job_id;
end;
$$;

create or replace function public.eb_follow_up_mail_cron_status()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  job_id bigint;
  job_active boolean;
  http_status integer;
  http_timed_out boolean;
  http_responded_at timestamptz;
  last_request_at timestamptz;
begin
  select j.jobid, j.active into job_id, job_active from cron.job j
    where j.jobname = 'hushub-eb-follow-up-mail-v1' order by j.jobid desc limit 1;
  select max(r.requested_at) into last_request_at from public.eb_follow_up_cron_requests r;
  select response.status_code, response.timed_out, response.created
    into http_status, http_timed_out, http_responded_at
    from public.eb_follow_up_cron_requests r
    join net._http_response response on response.id = r.request_id
    order by response.created desc limit 1;
  return jsonb_build_object('jobId', job_id, 'active', coalesce(job_active, false),
    'lastRequestedAt', last_request_at, 'lastCompletedHttpStatus', http_status,
    'lastCompletedTimedOut', http_timed_out, 'lastCompletedAt', http_responded_at);
end;
$$;

revoke all on function public.invoke_eb_follow_up_mail_cron() from public, anon, authenticated;
revoke all on function public.configure_eb_follow_up_mail_cron() from public, anon, authenticated;
revoke all on function public.eb_follow_up_mail_cron_status() from public, anon, authenticated;
grant execute on function public.invoke_eb_follow_up_mail_cron() to service_role;
grant execute on function public.configure_eb_follow_up_mail_cron() to service_role;
grant execute on function public.eb_follow_up_mail_cron_status() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
    and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform public.configure_eb_follow_up_mail_cron();
  else
    raise warning 'EB follow-up mail dispatcher not configured: pg_cron/pg_net required.';
  end if;
exception when sqlstate '55000' or invalid_schema_name or undefined_table then
  raise warning 'EB follow-up mail dispatcher requires Vault configuration before release.';
end;
$$;

commit;
