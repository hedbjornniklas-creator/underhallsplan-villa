-- Requires 2026-10-19_05_project_question_participants.sql (explicit project manager).
-- Independent portal visibility. No contract, offer, payment or question data is changed.
begin;
create table public.action_case_customer_visibility (
  org_id uuid not null,
  action_case_id uuid primary key,
  revision integer not null check(revision>0),
  contract boolean not null default true,
  choices boolean not null default true,
  payments boolean not null default true,
  schedule boolean not null default true,
  files boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  foreign key(org_id,action_case_id) references public.action_cases(org_id,id)
);
create table public.action_case_customer_visibility_events (
  request_id uuid primary key,
  org_id uuid not null,
  action_case_id uuid not null,
  revision integer not null,
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  request jsonb not null,
  before_tabs jsonb not null,
  tabs jsonb not null,
  created_at timestamptz not null default now(),
  unique(action_case_id,revision),
  foreign key(org_id,action_case_id) references public.action_cases(org_id,id)
);
alter table public.action_case_customer_visibility enable row level security;
alter table public.action_case_customer_visibility_events enable row level security;
revoke all on public.action_case_customer_visibility,public.action_case_customer_visibility_events from public,anon,authenticated,service_role;
grant select on public.action_case_customer_visibility,public.action_case_customer_visibility_events to service_role;
create trigger customer_visibility_history_immutable before update or delete on public.action_case_customer_visibility_events for each row execute function public.protect_project_question_history();

create function public.set_project_customer_visibility(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  manager uuid; actor text; saved public.action_case_customer_visibility%rowtype;
  prior public.action_case_customer_visibility_events%rowtype;
  rid uuid:=(p_request->>'requestId')::uuid; expected integer:=(p_request->>'revision')::integer;
  section text:=p_request->>'section'; visible boolean; previous jsonb; next_tabs jsonb; next_revision integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'CUSTOMER_SHARING_FORBIDDEN'; end if;
  select manager_profile_id into manager from public.action_cases where org_id=p_org_id and id=p_case_id for update;
  if not found then raise exception 'CUSTOMER_SHARING_NOT_FOUND'; end if;
  select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare') into actor from public.org_members m join public.profiles p on p.id=m.profile_id where m.org_id=p_org_id and m.profile_id=p_actor_id and m.is_active;
  if not found or manager is distinct from p_actor_id then raise exception 'CUSTOMER_SHARING_FORBIDDEN'; end if;
  select * into prior from public.action_case_customer_visibility_events where request_id=rid;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.actor_id<>p_actor_id or prior.request<>p_request then raise exception 'CUSTOMER_SHARING_STALE'; end if;
    return prior.revision;
  end if;
  if rid is null or expected is null or expected<0 or expected>=2147483647 or section is null or section not in ('contract','choices','payments','schedule','files') or jsonb_typeof(p_request->'visible') is distinct from 'boolean' then raise exception 'CUSTOMER_SHARING_INVALID'; end if;
  visible:=(p_request->>'visible')::boolean;
  select * into saved from public.action_case_customer_visibility where org_id=p_org_id and action_case_id=p_case_id for update;
  if coalesce(saved.revision,0)<>expected then raise exception 'CUSTOMER_SHARING_STALE'; end if;
  previous:=case when saved.revision is null then '{"contract":true,"choices":true,"payments":true,"schedule":true,"files":true}'::jsonb else jsonb_build_object('contract',saved.contract,'choices',saved.choices,'payments',saved.payments,'schedule',saved.schedule,'files',saved.files) end;
  next_tabs:=jsonb_set(previous,array[section],to_jsonb(visible));next_revision:=expected+1;
  insert into public.action_case_customer_visibility(org_id,action_case_id,revision,contract,choices,payments,schedule,files,updated_by)
    values(p_org_id,p_case_id,next_revision,(next_tabs->>'contract')::boolean,(next_tabs->>'choices')::boolean,(next_tabs->>'payments')::boolean,(next_tabs->>'schedule')::boolean,(next_tabs->>'files')::boolean,p_actor_id)
    on conflict(action_case_id) do update set revision=excluded.revision,contract=excluded.contract,choices=excluded.choices,payments=excluded.payments,schedule=excluded.schedule,files=excluded.files,updated_at=now(),updated_by=p_actor_id;
  insert into public.action_case_customer_visibility_events(request_id,org_id,action_case_id,revision,actor_id,actor_name,request,before_tabs,tabs)
    values(rid,p_org_id,p_case_id,next_revision,p_actor_id,actor,p_request,previous,next_tabs);
  return next_revision;
end $$;
revoke all on function public.set_project_customer_visibility(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_project_customer_visibility(uuid,uuid,uuid,jsonb) to service_role;
commit;
