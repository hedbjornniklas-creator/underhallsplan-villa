alter table public.brf_members
  add column if not exists renoapp_email_general_enabled boolean not null default false,
  add column if not exists renoapp_email_case_events_enabled boolean not null default true;
