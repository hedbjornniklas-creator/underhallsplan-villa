  begin;

  -- Application data belongs to the case, not to a shared resident/unit record.
  -- Existing test cases are deliberately not backfilled or deleted.
  alter table public.renovation_cases
    add column if not exists applicant_name text,
    add column if not exists applicant_email text,
    add column if not exists applicant_phone text,
    add column if not exists unit_number_internal text,
    add column if not exists unit_number_skatteverket text;

  comment on column public.renovation_cases.applicant_name is
    'Applicant supplied for this case only. No shared contact lookup.';
  comment on column public.renovation_cases.unit_number_internal is
    'Number supplied for this case, not a unique apartment identifier.';
  comment on column public.renovation_cases.unit_number_skatteverket is
    'Number supplied for this case. May repeat within an association.';

  commit;
