-- Technical investigations project type
-- Date: 2026-06-04
-- Scope:
-- 1) Add editable project type for TU print headers

alter table public.technical_investigation_details
  add column if not exists project_type text;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.technical_investigation_details'::regclass
      and tgname = 'trg_guard_locked_inspection_write'
      and not tgisinternal
  ) then
    alter table public.technical_investigation_details
      disable trigger trg_guard_locked_inspection_write;
  end if;
end
$$;

update public.technical_investigation_details
set project_type = 'Fördjupad teknisk utredning'
where project_type is null
   or btrim(project_type) = '';

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.technical_investigation_details'::regclass
      and tgname = 'trg_guard_locked_inspection_write'
      and not tgisinternal
  ) then
    alter table public.technical_investigation_details
      enable trigger trg_guard_locked_inspection_write;
  end if;
end
$$;

alter table public.technical_investigation_details
  alter column project_type set default 'Fördjupad teknisk utredning',
  alter column project_type set not null;
