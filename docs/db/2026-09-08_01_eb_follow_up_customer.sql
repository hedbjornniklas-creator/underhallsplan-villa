-- One designated EB follow-up customer per inspection. Apply after
-- 2026-09-07_07_eb_follow_up_orders.sql. No backfill, order transfer, or report changes.
begin;

create table if not exists public.eb_follow_up_customers (
  inspection_id uuid primary key references public.eb_inspection_details(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  confirmed_at timestamptz not null,
  confirmed_by uuid references public.profiles(id) on delete set null
);
create table if not exists public.eb_follow_up_customer_audit (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.eb_inspection_details(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  previous_email text,
  email text not null,
  confirmed_at timestamptz not null,
  confirmed_by uuid references public.profiles(id) on delete set null
);
alter table public.eb_follow_up_customers enable row level security;
alter table public.eb_follow_up_customer_audit enable row level security;
-- Revoke service_role too: Supabase default privileges may otherwise grant it
-- direct writes, bypassing the confirmation/audit RPC despite the SELECT grant.
revoke all on public.eb_follow_up_customers,public.eb_follow_up_customer_audit from public,anon,authenticated,service_role;
grant select on public.eb_follow_up_customers,public.eb_follow_up_customer_audit to service_role;

-- Caller authorization lives in the authenticated API; only service_role may
-- call this function. The DB independently enforces the exact org/project/inspection.
create or replace function public.eb_confirm_follow_up_customer(
  p_org_id uuid,p_project_id uuid,p_inspection_id uuid,p_email text,p_actor uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(p_email)); v_previous text; v_now timestamptz := clock_timestamp();
begin
  if p_actor is null or v_email is null or length(v_email)>254 or
      v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'EB_FOLLOW_UP_EMAIL_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||p_inspection_id::text,0));
  if not exists(select 1 from eb_inspection_details d join eb_projects p on p.id=d.eb_project_id and p.org_id=d.org_id
    where d.inspection_id=p_inspection_id and d.eb_project_id=p_project_id and d.org_id=p_org_id) then
    raise exception 'EB_INSPECTION_NOT_FOUND';
  end if;
  if exists(select 1 from eb_follow_up_orders where inspection_id=p_inspection_id) then
    raise exception 'EB_FOLLOW_UP_CUSTOMER_FROZEN';
  end if;
  select email into v_previous from eb_follow_up_customers where inspection_id=p_inspection_id;
  insert into eb_follow_up_customers(inspection_id,org_id,eb_project_id,email,confirmed_at,confirmed_by)
    values(p_inspection_id,p_org_id,p_project_id,v_email,v_now,p_actor)
    on conflict(inspection_id) do update set email=excluded.email,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by;
  insert into eb_follow_up_customer_audit(inspection_id,org_id,eb_project_id,previous_email,email,confirmed_at,confirmed_by)
    values(p_inspection_id,p_org_id,p_project_id,v_previous,v_email,v_now,p_actor);
end $$;

-- Keep in sync with followUpCustomer.ts. An accepted assignment is called
-- ordered/booked/completed by the shared assignment workflow. A project email
-- alone is NEVER authority, and conflicting sources require explicit confirmation.
create or replace function public.eb_resolve_follow_up_customer_email(
  p_org_id uuid,p_project_id uuid,p_inspection_id uuid
) returns text language plpgsql security definer set search_path = public as $$
declare v_confirmed text; v_project text; v_assignment text;
begin
  select lower(btrim(p.client_email)) into v_project
    from eb_inspection_details d join eb_projects p on p.id=d.eb_project_id and p.org_id=d.org_id
    where d.inspection_id=p_inspection_id and d.eb_project_id=p_project_id and d.org_id=p_org_id;
  if not found then return null; end if;
  select email into v_confirmed from eb_follow_up_customers
    where inspection_id=p_inspection_id and org_id=p_org_id and eb_project_id=p_project_id;
  if v_confirmed is not null then return v_confirmed; end if;
  select lower(btrim(a.customer_email)) into v_assignment
    from eb_assignment_confirmations c join assignments a on a.id=c.assignment_id and a.org_id=c.org_id
    where c.inspection_id=p_inspection_id and c.org_id=p_org_id and c.is_current
      and a.accepted_at is not null and a.status::text in ('ordered','booked','completed','accepted');
  if v_assignment is null or length(v_assignment)>254 or
      v_assignment !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
  if coalesce(v_project,'')<>'' and v_project<>v_assignment then return null; end if;
  return v_assignment;
end $$;

-- Revalidate NEW purchases under the same inspection lock used by confirmation
-- and eb_complete_follow_up_order. This closes a stale-session/contact-change race.
-- Existing immutable orders, recovery and billing updates are untouched.
create or replace function public.eb_guard_follow_up_order_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||new.inspection_id::text,0));
  v_email := eb_resolve_follow_up_customer_email(new.org_id,new.eb_project_id,new.inspection_id);
  if v_email is null or v_email is distinct from lower(btrim(new.buyer_snapshot->>'email')) then
    raise exception 'EB_FOLLOW_UP_BUYER_MISMATCH';
  end if;
  return new;
end $$;
drop trigger if exists eb_guard_follow_up_order_customer on public.eb_follow_up_orders;
create trigger eb_guard_follow_up_order_customer before insert on public.eb_follow_up_orders
  for each row execute function public.eb_guard_follow_up_order_customer();

revoke all on function public.eb_confirm_follow_up_customer(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.eb_resolve_follow_up_customer_email(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.eb_guard_follow_up_order_customer() from public,anon,authenticated;
grant execute on function public.eb_confirm_follow_up_customer(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.eb_resolve_follow_up_customer_email(uuid,uuid,uuid) to service_role;

comment on table public.eb_follow_up_customers is
  'Inspector-confirmed contact for NEW EB follow-up purchases, independent of locked report snapshots. Frozen paid buyer always remains owner.';
commit;
