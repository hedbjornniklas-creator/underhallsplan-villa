-- Additive, service-only diagnostics. Does not alter assignments or customer links.
begin;

-- Already present in production (profile organization-card migration 07).
-- Repeating it also supports older staging schemas without weakening the FK.
create unique index if not exists assignments_org_id_id_unique_idx
  on public.assignments (org_id, id);

create table if not exists public.assignment_link_incidents (
  id uuid primary key,
  org_id uuid not null,
  assignment_id uuid not null,
  link_id uuid not null references public.assignment_links(id) on delete cascade,
  operation text not null check (operation in ('open', 'accept')),
  error_code text not null,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  last_reference uuid not null,
  occurrences integer not null default 1,
  resolved_at timestamptz,
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz,
  notification_state text not null default 'suppressed'
    check (notification_state in ('pending', 'sent', 'failed', 'suppressed')),
  foreign key (org_id, assignment_id) references public.assignments(org_id, id) on delete cascade
);
create unique index if not exists assignment_link_incidents_open_unique
  on public.assignment_link_incidents(link_id, operation) where resolved_at is null;
create index if not exists assignment_link_incidents_org_assignment
  on public.assignment_link_incidents(org_id, assignment_id, last_failed_at desc);
alter table public.assignment_link_incidents enable row level security;
revoke all on public.assignment_link_incidents from public, anon, authenticated;
grant select, insert, update, delete on public.assignment_link_incidents to service_role;

create or replace function public.record_assignment_link_incident(
  p_token_hash text, p_operation text, p_reference uuid, p_error_code text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.assignment_links;
  a public.assignments;
  incident public.assignment_link_incidents;
  should_notify boolean := false;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_operation is null or p_operation not in ('open', 'accept')
     or p_reference is null or p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'INVALID_INCIDENT_INPUT';
  end if;
  -- Serialize duplicate requests and the notification claim for the same link.
  select * into l from public.assignment_links where token_hash = p_token_hash for update;
  if not found or l.revoked_at is not null or l.used_at is not null or l.expires_at <= now() then return null; end if;
  select * into a from public.assignments where id = l.assignment_id and org_id = l.org_id;
  if not found or a.status = 'cancelled' or a.accepted_at is not null then return null; end if;
  select * into incident from public.assignment_link_incidents
    where link_id = l.id and operation = p_operation and resolved_at is null;
  if found then
    update public.assignment_link_incidents set last_failed_at = now(), last_reference = p_reference,
      occurrences = occurrences + 1, error_code = p_error_code where id = incident.id returning * into incident;
  else
    should_notify := not exists (
      select 1 from public.assignment_link_incidents where link_id = l.id
        and notification_attempted_at > now() - interval '24 hours'
    );
    insert into public.assignment_link_incidents(id, org_id, assignment_id, link_id, operation,
      error_code, last_reference, notification_attempted_at, notification_state)
    values (p_reference, l.org_id, l.assignment_id, l.id, p_operation, p_error_code, p_reference,
      case when should_notify then now() end, case when should_notify then 'pending' else 'suppressed' end)
    returning * into incident;
  end if;
  return jsonb_build_object('id', incident.id, 'orgId', l.org_id, 'assignmentId', l.assignment_id,
    'responsibleProfileId', a.responsible_profile_id, 'assignmentType', a.assignment_type, 'notify', should_notify);
end $$;
revoke all on function public.record_assignment_link_incident(text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.record_assignment_link_incident(text,text,uuid,text) to service_role;

create or replace function public.resolve_assignment_link_incidents(
  p_token_hash text, p_operation text, p_started_at timestamptz
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_operation not in ('open', 'accept') then raise exception 'INVALID_INCIDENT_INPUT'; end if;
  update public.assignment_link_incidents i set resolved_at = now()
  from public.assignment_links l
  where l.token_hash = p_token_hash and i.link_id = l.id
    and i.resolved_at is null and i.last_failed_at <= p_started_at
    and (i.operation = p_operation or (p_operation = 'accept' and l.used_at is not null));
end $$;
revoke all on function public.resolve_assignment_link_incidents(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_assignment_link_incidents(text,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
