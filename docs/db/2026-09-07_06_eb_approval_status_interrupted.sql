-- EB final-inspection decision: retire partly_approved and add interrupted
-- Date: 2026-09-07
-- Scope:
-- 1) Refuse to reinterpret historical partly_approved decisions as interrupted
-- 2) Restrict future values to approved, not_approved, or interrupted
--
-- partly_approved and interrupted are not semantically equivalent. If legacy
-- rows exist, the migration stops before changing the constraint so those rows
-- can be reviewed and resolved explicitly. This migration is safe to rerun.

begin;

lock table public.eb_inspection_details in access exclusive mode;

do $$
declare
  legacy_partly_approved_count bigint;
begin
  select count(*)
  into legacy_partly_approved_count
  from public.eb_inspection_details
  where approval_status = 'partly_approved';

  if legacy_partly_approved_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'EB approval status migration stopped: %s partly_approved row(s) require manual review before the status can be retired.',
        legacy_partly_approved_count
      ),
      hint = 'Resolve each legacy decision explicitly as approved, not_approved, interrupted, or null, then rerun this migration.';
  end if;
end
$$;

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_approval_status_check;

alter table public.eb_inspection_details
  add constraint eb_inspection_details_approval_status_check
    check (approval_status is null or approval_status in ('approved', 'not_approved', 'interrupted'));

comment on column public.eb_inspection_details.approval_status is
  'Final inspection decision: approved, not_approved, or interrupted.';

commit;
