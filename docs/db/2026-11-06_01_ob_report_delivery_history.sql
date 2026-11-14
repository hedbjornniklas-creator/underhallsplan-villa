-- OB/STATUS delivery audit. No report payload, PDF, token or customer link is rewritten.
begin;

alter table public.outbound_messages
  add column if not exists inspection_id uuid references public.inspections(id) on delete set null,
  add column if not exists report_link_id uuid references public.inspection_report_links(id) on delete restrict,
  add column if not exists report_dispatch_id uuid;
alter table public.inspection_report_links add column if not exists ob_delivery_tracked boolean not null default false;

create index if not exists outbound_messages_ob_report_history_idx
  on public.outbound_messages(org_id, inspection_id, created_at desc)
  where template_key in ('inspection_report_delivery', 'inspection_report_share');

-- Only an existing assignment FK is authoritative enough to repair old metadata automatically.
update public.outbound_messages m set inspection_id = a.inspection_id
from public.assignments a join public.ob_organization_bindings b
  on b.inspection_id = a.inspection_id and b.org_id = a.org_id
where m.assignment_id = a.id and m.org_id = a.org_id and m.inspection_id is null
  and a.assignment_type in ('OB','STATUS') and m.template_key = 'inspection_report_delivery';

create or replace function public.guard_ob_report_message_binding() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.report_link_id is not null and new.template_key = 'inspection_report_delivery' then
    if not exists (select 1 from public.inspection_report_links r
      join public.ob_organization_bindings b on b.inspection_id = r.inspection_id and b.org_id = r.org_id
      where r.id = new.report_link_id and r.org_id = new.org_id and r.inspection_id = new.inspection_id) then
      raise exception 'OB_REPORT_MESSAGE_BINDING_INVALID';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ob_report_message_binding on public.outbound_messages;
create trigger trg_ob_report_message_binding before insert or update of org_id, inspection_id, report_link_id, template_key
  on public.outbound_messages for each row execute function public.guard_ob_report_message_binding();

create table if not exists public.ob_report_delivery_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  inspection_id uuid not null references public.inspections(id) on delete restrict,
  report_id uuid references public.inspection_report_links(id) on delete restrict,
  action text not null check (action in ('locked','completed')),
  performed_by uuid not null references public.profiles(id) on delete restrict,
  actor_name text,
  detail text,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.ob_report_delivery_events enable row level security;
revoke all on public.ob_report_delivery_events from public, anon, authenticated;
grant select, insert on public.ob_report_delivery_events to service_role;
create index if not exists ob_report_delivery_events_history_idx
  on public.ob_report_delivery_events(org_id, inspection_id, occurred_at desc, id desc);

create or replace function public.ob_complete_inspection_with_history(
  p_org_id uuid, p_inspection_id uuid, p_actor uuid, p_source text, p_report_id uuid default null
) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.inspections; v_at timestamptz := clock_timestamp(); v_name text;
begin
  select x.* into i from public.inspections x
    join public.properties p on p.id = x.property_id and p.owner = p_actor
    join public.ob_organization_bindings b on b.inspection_id = x.id and b.org_id = p_org_id
    join public.org_members m on m.org_id = b.org_id and m.profile_id = p_actor and m.is_active
    where x.id = p_inspection_id for update of x;
  if i.id is null or p_source is null or p_source not in ('send_and_complete','complete_only') then
    raise exception 'OB_ORGANIZATION_FORBIDDEN';
  end if;
  if p_report_id is not null and not exists (select 1 from public.inspection_report_links r
    where r.id = p_report_id and r.org_id = p_org_id and r.inspection_id = i.id and r.revoked_at is null) then
    raise exception 'OB_REPORT_MESSAGE_BINDING_INVALID';
  end if;
  if i.locked_at is not null then return i.locked_at; end if;
  select full_name into v_name from public.profiles where id = p_actor;
  update public.inspections set status = 'completed', locked_at = v_at, locked_by = p_actor where id = i.id;
  if coalesce(i.status, '') not in ('completed','klar','done') then
    insert into public.ob_report_delivery_events(org_id,inspection_id,report_id,action,performed_by,actor_name,detail,occurred_at)
      values(p_org_id,i.id,p_report_id,'completed',p_actor,v_name,
        case when p_source = 'complete_only' then 'Utan utskick' else 'Efter utskick' end,v_at);
  end if;
  insert into public.ob_report_delivery_events(org_id,inspection_id,report_id,action,performed_by,actor_name,detail,occurred_at)
    values(p_org_id,i.id,p_report_id,'locked',p_actor,v_name,
      case when p_source = 'complete_only' then 'Utan utskick' else 'Efter utskick' end,v_at);
  return v_at;
end $$;
revoke all on function public.ob_complete_inspection_with_history(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.ob_complete_inspection_with_history(uuid,uuid,uuid,text,uuid) to service_role;

create or replace view public.ob_report_delivery_history with (security_invoker = true) as
with reports as (
  select r.*, row_number() over (partition by r.inspection_id order by r.created_at,r.id)::integer as version
  from public.inspection_report_links r join public.ob_organization_bindings b
    on b.inspection_id = r.inspection_id and b.org_id = r.org_id
), events as (
  select 'published:' || r.id::text as id, r.org_id, r.inspection_id, 'published'::text as type,
    r.created_at as occurred_at, p.full_name as actor_name, null::text as recipient_email,
    r.pdf_status as status, null::text as detail, r.id as report_id, r.version, r.revoked_at is null as report_active
  from reports r left join public.profiles p on p.id = r.created_by
  union all
  select 'sent:' || m.id::text,m.org_id,m.inspection_id,'sent',coalesce(m.sent_at,m.created_at),p.full_name,
    m.recipient_email,m.status,m.error_message,m.report_link_id,r.version,r.revoked_at is null
  from public.outbound_messages m join public.ob_organization_bindings b
    on b.inspection_id = m.inspection_id and b.org_id = m.org_id
    left join reports r on r.id = m.report_link_id and r.org_id = m.org_id and r.inspection_id = m.inspection_id
    left join public.profiles p on p.id = m.created_by
  where m.template_key = 'inspection_report_delivery'
  union all
  select 'pdf_ready:' || r.id::text,r.org_id,r.inspection_id,'pdf_ready',r.pdf_generated_at,null,null,
    'ready',null,r.id,r.version,r.revoked_at is null
  from reports r where r.pdf_status = 'ready' and r.pdf_generated_at is not null
  union all
  select 'unlocked:' || u.id::text,u.org_id,u.inspection_id,'unlocked',coalesce(u.performed_at,u.created_at),p.full_name,
    null,null,u.reason,null,null,null
  from public.inspection_lock_events u join public.ob_organization_bindings b
    on b.inspection_id = u.inspection_id and b.org_id = u.org_id
    left join public.profiles p on p.id = u.performed_by where u.action = 'unlock'
  union all
  select e.action || ':' || e.id::text,e.org_id,e.inspection_id,e.action,e.occurred_at,e.actor_name,
    null,null,e.detail,e.report_id,r.version,r.revoked_at is null
  from public.ob_report_delivery_events e join public.ob_organization_bindings b
    on b.inspection_id = e.inspection_id and b.org_id = e.org_id
    left join reports r on r.id = e.report_id and r.org_id = e.org_id and r.inspection_id = e.inspection_id
)
select * from events;

create or replace view public.ob_report_delivery_overview with (security_invoker = true) as
select b.org_id,b.inspection_id,i.locked_at,r.id as report_id,r.created_at as published_at,
  case when r.id is null then null else (select count(*)::integer from public.inspection_report_links v
    where v.org_id = b.org_id and v.inspection_id = b.inspection_id and (v.created_at,v.id) <= (r.created_at,r.id)) end as version,
  sent.last_sent_at,
  coalesce((select array_agg(distinct m.recipient_email order by m.recipient_email) from public.outbound_messages m
    where m.org_id = b.org_id and m.inspection_id = b.inspection_id and m.template_key = 'inspection_report_delivery'
      and m.status = 'sent' and (m.report_dispatch_id = sent.report_dispatch_id or
        (m.report_dispatch_id is null and sent.report_dispatch_id is null and m.sent_at = sent.last_sent_at))),array[]::text[]) as last_recipients,
  exists (select 1 from public.inspection_report_links old
    where old.org_id = b.org_id and old.inspection_id = b.inspection_id and not old.ob_delivery_tracked
      and old.assignment_id is null) as history_incomplete
from public.ob_organization_bindings b join public.inspections i on i.id = b.inspection_id
left join lateral (select x.* from public.inspection_report_links x where x.org_id = b.org_id
  and x.inspection_id = b.inspection_id and x.revoked_at is null order by x.created_at desc,x.id desc limit 1) r on true
left join lateral (select m.sent_at as last_sent_at,m.report_dispatch_id from public.outbound_messages m
  where m.org_id = b.org_id and m.inspection_id = b.inspection_id and m.template_key = 'inspection_report_delivery'
    and m.status = 'sent' order by m.sent_at desc nulls last,m.created_at desc,m.id desc limit 1) sent on true;

revoke all on public.ob_report_delivery_history,public.ob_report_delivery_overview from public,anon,authenticated;
grant select on public.ob_report_delivery_history,public.ob_report_delivery_overview to service_role;
commit;
