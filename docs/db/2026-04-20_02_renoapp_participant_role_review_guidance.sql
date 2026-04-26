alter table public.renoapp_participant_roles
  add column if not exists review_guidance text;
