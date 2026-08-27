-- Uppdrag V1: durable, privacy-minimal rate limiting for email PDF analysis.
-- The table stores no PDF bytes, filename, user instruction or AI output.

create table if not exists public.task_email_pdf_analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by_profile_id uuid not null references public.profiles (id) on delete cascade,
  file_size_bytes bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_email_pdf_analysis_attempts_file_size_check
    check (file_size_bytes between 1 and 4194304)
);

create index if not exists task_email_pdf_analysis_attempts_user_created_idx
  on public.task_email_pdf_analysis_attempts (
    org_id,
    created_by_profile_id,
    created_at desc
  );

create index if not exists task_email_pdf_analysis_attempts_org_created_idx
  on public.task_email_pdf_analysis_attempts (org_id, created_at desc);

alter table public.task_email_pdf_analysis_attempts enable row level security;

revoke all on table public.task_email_pdf_analysis_attempts
  from public, anon, authenticated;

create or replace function public.claim_task_email_pdf_analysis_attempt(
  p_org_id uuid,
  p_profile_id uuid,
  p_file_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  attempt_id uuid;
  user_attempt_count bigint;
  organization_attempt_count bigint;
begin
  if p_org_id is null or p_profile_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_EMAIL_PDF_RATE_LIMIT_INPUT_INVALID';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes not between 1 and 4194304 then
    raise exception using
      errcode = '22023',
      message = 'TASK_EMAIL_PDF_RATE_LIMIT_INPUT_INVALID';
  end if;

  -- All callers acquire the organization lock first. This makes both the
  -- organization-wide and per-user checks atomic without deadlocks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('task-email-pdf-org:' || p_org_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'task-email-pdf-user:' || p_org_id::text || ':' || p_profile_id::text,
      0
    )
  );

  -- Attempts are operational metadata, not a permanent business audit.
  delete from public.task_email_pdf_analysis_attempts attempt
  where attempt.org_id = p_org_id
    and attempt.created_at < clock_timestamp() - interval '90 days';

  select count(*)
  into user_attempt_count
  from public.task_email_pdf_analysis_attempts attempt
  where attempt.org_id = p_org_id
    and attempt.created_by_profile_id = p_profile_id
    and attempt.created_at >= clock_timestamp() - interval '10 minutes';

  select count(*)
  into organization_attempt_count
  from public.task_email_pdf_analysis_attempts attempt
  where attempt.org_id = p_org_id
    and attempt.created_at >= clock_timestamp() - interval '24 hours';

  if user_attempt_count >= 10 or organization_attempt_count >= 100 then
    raise exception using
      errcode = 'P0001',
      message = 'TASK_EMAIL_PDF_RATE_LIMITED';
  end if;

  insert into public.task_email_pdf_analysis_attempts (
    org_id,
    created_by_profile_id,
    file_size_bytes
  )
  values (p_org_id, p_profile_id, p_file_size_bytes)
  returning id into attempt_id;

  return attempt_id;
end;
$$;

revoke all on function public.claim_task_email_pdf_analysis_attempt(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_task_email_pdf_analysis_attempt(uuid, uuid, bigint)
  to service_role;

comment on table public.task_email_pdf_analysis_attempts is
  'Privacy-minimal rate-limit metadata for pre-task PDF analysis. Never store filenames, instructions, PDF content or AI output here.';
