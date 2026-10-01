-- Manual production schedule, separate from immutable customer agreements.
begin;
create table if not exists public.action_case_schedules (
  action_case_id uuid primary key references public.action_cases(id) on delete cascade,
  org_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 200),
  shared_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(shared_rows) = 'array' and jsonb_array_length(shared_rows) <= 200),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.action_case_schedules enable row level security;
revoke all on public.action_case_schedules from public, anon, authenticated;
grant all on public.action_case_schedules to service_role;

create or replace function public.write_action_case_schedule(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_operation text, p_revision integer, p_rows jsonb
) returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.action_case_schedules;
begin
  if p_user_id is null or p_revision is null or p_revision < 0 or p_operation is null or p_operation not in ('save', 'share', 'unshare') then
    raise exception 'PROJECT_SCHEDULE_INVALID';
  end if;
  -- Lock the parent too: two first saves must not both see revision zero.
  perform 1 from public.action_cases where id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'PROJECT_SCHEDULE_NOT_FOUND'; end if;
  insert into public.action_case_schedules(action_case_id, org_id, updated_by)
    values (p_case_id, p_org_id, p_user_id) on conflict (action_case_id) do nothing;
  select * into s from public.action_case_schedules where action_case_id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'PROJECT_SCHEDULE_NOT_FOUND'; end if;
  if s.revision <> p_revision then raise exception 'PROJECT_SCHEDULE_STALE'; end if;
  if p_operation = 'save' then
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'PROJECT_SCHEDULE_INVALID'; end if;
    update public.action_case_schedules set rows = p_rows where action_case_id = p_case_id and org_id = p_org_id;
  elsif p_operation = 'share' then
    if exists(select 1 from jsonb_array_elements(s.rows) r where coalesce(btrim(r->>'title'), '') = '') then raise exception 'PROJECT_SCHEDULE_INVALID'; end if;
    update public.action_case_schedules set shared_rows = s.rows where action_case_id = p_case_id and org_id = p_org_id;
  else
    update public.action_case_schedules set shared_rows = '[]'::jsonb where action_case_id = p_case_id and org_id = p_org_id;
  end if;
  update public.action_case_schedules set revision = revision + 1, updated_by = p_user_id, updated_at = now()
    where action_case_id = p_case_id and org_id = p_org_id;
end;
$$;
revoke all on function public.write_action_case_schedule(uuid,uuid,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.write_action_case_schedule(uuid,uuid,uuid,text,integer,jsonb) to service_role;
commit;
