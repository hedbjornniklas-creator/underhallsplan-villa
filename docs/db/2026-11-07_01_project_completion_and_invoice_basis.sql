-- Independent project closeout and invoice support. No invoices, payments,
-- business document rewrites, backfill or Fortnox calls.
begin;
create table if not exists public.action_case_completion (
  action_case_id uuid primary key references public.action_cases(id),
  org_id uuid not null references public.organizations(id),
  revision integer not null default 0 check(revision>=0),
  work_complete boolean not null default false, invoiced boolean not null default false,
  completed_at timestamptz, completed_by uuid references public.profiles(id),
  previous_status text, updated_at timestamptz not null default now()
);
create table if not exists public.action_case_invoice_basis (
  id uuid primary key, org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id),
  revision integer not null check(revision>0), body jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.action_case_administration_events (
  id uuid primary key, org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id),
  actor_id uuid not null references public.profiles(id), actor_name text not null,
  operation text not null check(operation in ('flags','complete','reopen','save_basis')),
  request jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create index if not exists action_case_invoice_basis_case on public.action_case_invoice_basis(org_id,action_case_id,created_at);
create index if not exists action_case_administration_events_case on public.action_case_administration_events(org_id,action_case_id,created_at desc);
alter table public.action_case_completion enable row level security;
alter table public.action_case_invoice_basis enable row level security;
alter table public.action_case_administration_events enable row level security;
revoke all on public.action_case_completion,public.action_case_invoice_basis,public.action_case_administration_events from public,anon,authenticated;
grant select,insert,update on public.action_case_completion,public.action_case_invoice_basis to service_role;
grant select,insert on public.action_case_administration_events to service_role;

create or replace function public.validate_action_case_invoice_basis(b jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare l jsonb; ids uuid[]:='{}'; q numeric; price numeric; net numeric; vat numeric; total_net numeric:=0; total_vat numeric:=0;
begin
  if jsonb_typeof(b) is distinct from 'object' or b->>'version' is distinct from '1'
    or exists(select 1 from jsonb_object_keys(b) k where k not in ('version','title','date','period','issuer','recipient','note','lines'))
    or jsonb_typeof(b->'lines') is distinct from 'array' or jsonb_array_length(b->'lines')>100 then raise exception 'PROJECT_ADMIN_INVALID'; end if;
  foreach l in array array[b->'title',b->'date',b->'period',b->'issuer',b->'recipient',b->'note'] loop
    if jsonb_typeof(l) is distinct from 'string' or length(l#>>'{}')>10000 then raise exception 'PROJECT_ADMIN_INVALID'; end if;
  end loop;
  if length(b->>'title')>200 or length(b->>'period')>200 or length(b->>'issuer')>1500 or length(b->>'recipient')>1500
    or b->>'date' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or to_char((b->>'date')::date,'YYYY-MM-DD')<>b->>'date' then raise exception 'PROJECT_ADMIN_INVALID'; end if;
  for l in select value from jsonb_array_elements(b->'lines') loop
    if jsonb_typeof(l) is distinct from 'object' or jsonb_typeof(l->'description') is distinct from 'string' or length(l->>'description')>1500
      or jsonb_typeof(l->'unit') is distinct from 'string' or length(l->>'unit')>30 or jsonb_typeof(l->'vatRate') is distinct from 'number'
      or (l->>'vatRate')::numeric not in (0,6,12,25) or (l->>'id')::uuid=any(ids) then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    if l->>'id' is null then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    ids:=array_append(ids,(l->>'id')::uuid);
    if jsonb_typeof(l->'quantity') not in ('number','null') or not l?'quantity'
      or jsonb_typeof(l->'unitPriceOre') not in ('number','null') or not l?'unitPriceOre' then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    q:=(l->>'quantity')::numeric; price:=(l->>'unitPriceOre')::numeric;
    if q<0 or q>1000000 or q<>round(q,4) or abs(price)>1000000000000 or price<>round(price) then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    net:=coalesce(round(q*price),0); vat:=round(net*(l->>'vatRate')::numeric/100);
    if abs(net)>1000000000000 then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    total_net:=total_net+net; total_vat:=total_vat+vat;
  end loop;
  if greatest(abs(total_net),abs(total_vat),abs(total_net+total_vat))>1000000000000 then raise exception 'PROJECT_ADMIN_INVALID'; end if;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'PROJECT_ADMIN_INVALID';
end $$;

create or replace function public.write_project_administration(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.action_cases%rowtype; c public.action_case_completion%rowtype; old public.action_case_administration_events%rowtype;
  d public.action_case_invoice_basis%rowtype; actor text; op text:=p_request->>'operation'; rid uuid:=(p_request->>'requestId')::uuid;
  expected integer:=(p_request->>'revision')::integer; bid uuid; b jsonb; result jsonb; n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_ADMIN_FORBIDDEN'; end if;
  select coalesce(nullif(btrim(person.full_name),''),person.email,'Intern användare') into actor from public.org_members m join public.profiles person on person.id=m.profile_id
    where m.org_id=p_org_id and m.profile_id=p_actor_id and m.is_active;
  if not found then raise exception 'PROJECT_ADMIN_FORBIDDEN'; end if;
  select * into p from public.action_cases where org_id=p_org_id and id=p_case_id for update;
  if not found then raise exception 'PROJECT_ADMIN_NOT_FOUND'; end if;
  if op is null or op not in ('flags','complete','reopen','save_basis') or rid is null or expected is null or expected<0 then raise exception 'PROJECT_ADMIN_INVALID'; end if;
  if op<>'save_basis' and p.manager_profile_id is distinct from p_actor_id then raise exception 'PROJECT_ADMIN_MANAGER'; end if;
  select * into old from public.action_case_administration_events where id=rid;
  if found then
    if old.org_id<>p_org_id or old.action_case_id<>p_case_id or old.actor_id<>p_actor_id or old.request<>p_request then raise exception 'PROJECT_ADMIN_STALE'; end if;
    return old.result;
  end if;
  if op='save_basis' then
    if p.status in ('completed','cancelled') then raise exception 'PROJECT_ADMIN_CLOSED'; end if;
    bid:=(p_request->>'id')::uuid; b:=p_request->'body';
    if bid is null then raise exception 'PROJECT_ADMIN_INVALID'; end if;
    perform public.validate_action_case_invoice_basis(b);
    select * into d from public.action_case_invoice_basis where id=bid;
    if found then
      if d.org_id<>p_org_id or d.action_case_id<>p_case_id then raise exception 'PROJECT_ADMIN_NOT_FOUND'; end if;
      if d.revision<>expected then raise exception 'PROJECT_ADMIN_STALE'; end if;
      update public.action_case_invoice_basis set body=b,revision=revision+1,updated_at=clock_timestamp() where id=bid returning revision into n;
    else
      if expected<>0 then raise exception 'PROJECT_ADMIN_STALE'; end if;
      insert into public.action_case_invoice_basis(id,org_id,action_case_id,revision,body) values(bid,p_org_id,p_case_id,1,b); n:=1;
    end if;
    result:=jsonb_build_object('id',bid,'revision',n,'status',p.status);
  else
    insert into public.action_case_completion(action_case_id,org_id) values(p_case_id,p_org_id) on conflict do nothing;
    select * into c from public.action_case_completion where action_case_id=p_case_id;
    if c.org_id<>p_org_id then raise exception 'PROJECT_ADMIN_FORBIDDEN'; end if;
    if c.revision<>expected then raise exception 'PROJECT_ADMIN_STALE'; end if;
    if op='flags' then
      if p.status in ('completed','cancelled') then raise exception 'PROJECT_ADMIN_CLOSED'; end if;
      if jsonb_typeof(p_request->'workComplete') is distinct from 'boolean' or jsonb_typeof(p_request->'invoiced') is distinct from 'boolean' then raise exception 'PROJECT_ADMIN_INVALID'; end if;
      update public.action_case_completion set work_complete=(p_request->>'workComplete')::boolean,invoiced=(p_request->>'invoiced')::boolean where action_case_id=p_case_id;
    elsif op='complete' then
      if p_request->>'confirmed' is distinct from 'true' or p.status in ('completed','cancelled') then raise exception 'PROJECT_ADMIN_CLOSED'; end if;
      if not c.work_complete or not c.invoiced then raise exception 'PROJECT_ADMIN_INCOMPLETE'; end if;
      if exists(select 1 from public.action_case_questions where org_id=p_org_id and action_case_id=p_case_id and body->>'status' is distinct from 'closed') then raise exception 'PROJECT_ADMIN_OPEN_QUESTIONS'; end if;
      update public.action_case_completion set previous_status=p.status,completed_at=clock_timestamp(),completed_by=p_actor_id where action_case_id=p_case_id;
      perform set_config('hushub.project_completion_case',p_case_id::text,true);
      update public.action_cases set status='completed',updated_by=p_actor_id where id=p_case_id;
    else
      if p_request->>'confirmed' is distinct from 'true' or p.status<>'completed' then raise exception 'PROJECT_ADMIN_INVALID'; end if;
      perform set_config('hushub.project_completion_case',p_case_id::text,true);
      update public.action_cases set status=coalesce(c.previous_status,'in_progress'),updated_by=p_actor_id where id=p_case_id;
      update public.action_case_completion set work_complete=false,invoiced=false,completed_at=null,completed_by=null where action_case_id=p_case_id;
    end if;
    update public.action_case_completion set revision=revision+1,updated_at=clock_timestamp() where action_case_id=p_case_id returning revision into n;
    select status into p.status from public.action_cases where id=p_case_id;
    result:=jsonb_build_object('revision',n,'status',p.status);
  end if;
  insert into public.action_case_administration_events(id,org_id,action_case_id,actor_id,actor_name,operation,request,result)
    values(rid,p_org_id,p_case_id,p_actor_id,actor,op,p_request,result);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'PROJECT_ADMIN_INVALID';
end $$;

create or replace function public.guard_project_administration_status() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    if new.status='completed' then raise exception 'PROJECT_ADMIN_INCOMPLETE'; end if;
    return new;
  end if;
  if old.status is distinct from new.status and (old.status='completed' or new.status='completed') then
    if auth.role() is distinct from 'service_role' or current_setting('hushub.project_completion_case',true) is distinct from new.id::text then raise exception 'PROJECT_ADMIN_MANAGER'; end if;
    if new.status='completed' and (not exists(select 1 from public.action_case_completion where action_case_id=new.id and org_id=new.org_id and work_complete and invoiced and completed_at is not null)
      or exists(select 1 from public.action_case_questions where action_case_id=new.id and body->>'status' is distinct from 'closed')) then raise exception 'PROJECT_ADMIN_INCOMPLETE'; end if;
  end if;
  return new;
end $$;
drop trigger if exists action_case_completion_status_guard on public.action_cases;
create trigger action_case_completion_status_guard before insert or update of status on public.action_cases for each row execute function public.guard_project_administration_status();
create or replace function public.guard_completed_project_questions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare state text;
begin
  select status into state from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if state='completed' and new.body->>'status' is distinct from 'closed' then raise exception 'PROJECT_QUESTION_PROJECT_CLOSED'; end if;
  return new;
end $$;
drop trigger if exists action_case_question_completed_project_guard on public.action_case_questions;
create trigger action_case_question_completed_project_guard before insert or update of body on public.action_case_questions for each row execute function public.guard_completed_project_questions();
create or replace function public.guard_project_administration_history() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'PROJECT_ADMIN_IMMUTABLE'; end $$;
drop trigger if exists action_case_administration_immutable on public.action_case_administration_events;
create trigger action_case_administration_immutable before update or delete on public.action_case_administration_events for each row execute function public.guard_project_administration_history();
revoke all on function public.validate_action_case_invoice_basis(jsonb),public.write_project_administration(uuid,uuid,uuid,jsonb),public.guard_project_administration_status(),public.guard_completed_project_questions(),public.guard_project_administration_history() from public,anon,authenticated;
grant execute on function public.write_project_administration(uuid,uuid,uuid,jsonb) to service_role;
commit;
