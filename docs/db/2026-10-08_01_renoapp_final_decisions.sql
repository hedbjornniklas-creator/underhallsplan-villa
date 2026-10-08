begin;

-- Existing decisions remain untouched. Unknown delivery is not treated as sent.
alter table public.renovation_case_decisions
  add column if not exists delivery_status text not null default 'unknown'
    check (delivery_status in ('unknown','pending','sent','failed')),
  add column if not exists delivery_error text,
  add column if not exists provider_message_id text,
  add column if not exists email_payload jsonb;

-- Mail snapshots include a personal access link. Access goes through authorized
-- server endpoints; no direct browser access to decision/delivery rows.
alter table public.renovation_case_decisions enable row level security;
revoke all on public.renovation_case_decisions from public,anon,authenticated;
grant all on public.renovation_case_decisions to service_role;

create or replace function public.renoapp_lock_final_case_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and (
    old.status in ('approved','conditional','approved_with_conditions','rejected')
    or exists(select 1 from public.renovation_case_decisions where case_id=old.id)
  ) then raise exception 'CASE_DECISION_LOCKED'; end if;
  return new;
end $$;
drop trigger if exists renoapp_lock_final_case_status on public.renovation_cases;
create trigger renoapp_lock_final_case_status before update on public.renovation_cases
  for each row execute function public.renoapp_lock_final_case_status();

create or replace function public.renoapp_lock_decision_record()
returns trigger language plpgsql security definer set search_path=public as $$
declare current_status text;
begin
  if tg_op='INSERT' then
    -- The case lock serializes decisions, including inserts outside the RPC.
    select status into current_status from public.renovation_cases where id=new.case_id for update;
    if current_status='draft' then raise exception 'DRAFT_CASE_LOCKED'; end if;
    if exists(select 1 from public.renovation_case_decisions where case_id=new.case_id) then
      raise exception 'CASE_DECISION_LOCKED';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    -- Preserve case deletion/cascades; deleting just the decision is not an undo.
    if exists(select 1 from public.renovation_cases where id=old.case_id) then
      raise exception 'CASE_DECISION_LOCKED';
    end if;
    return old;
  end if;
  if row(new.id,new.case_id,new.decision,new.conditions,new.reason,new.decided_at,new.created_at)
    is distinct from row(old.id,old.case_id,old.decision,old.conditions,old.reason,old.decided_at,old.created_at)
    or (new.decided_by is distinct from old.decided_by and new.decided_by is not null)
  then raise exception 'CASE_DECISION_LOCKED'; end if;
  if old.email_payload is not null and new.email_payload is distinct from old.email_payload then
    raise exception 'DECISION_EMAIL_PAYLOAD_LOCKED';
  end if;
  if old.delivery_status='sent' and new.delivery_status<>'sent' then
    raise exception 'DECISION_EMAIL_ALREADY_SENT';
  end if;
  return new;
end $$;
drop trigger if exists renoapp_lock_decision_record on public.renovation_case_decisions;
create trigger renoapp_lock_decision_record before insert or update or delete on public.renovation_case_decisions
  for each row execute function public.renoapp_lock_decision_record();

create or replace function public.renoapp_record_final_decision(
  p_case_id uuid,p_id uuid,p_status text,p_reason text,p_conditions text,p_actor uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.renovation_cases; d public.renovation_case_decisions;
begin
  if p_status not in ('approved','conditional','rejected') or p_status is null then
    raise exception 'INVALID_CASE_STATUS';
  end if;
  p_reason := nullif(btrim(p_reason),'');
  p_conditions := case when p_status='conditional' then nullif(btrim(p_conditions),'') else null end;
  if p_reason is null then raise exception 'DECISION_REASON_REQUIRED'; end if;
  if p_status='conditional' and p_conditions is null then raise exception 'DECISION_CONDITIONS_REQUIRED'; end if;
  select * into strict c from public.renovation_cases where id=p_case_id for update;
  select * into d from public.renovation_case_decisions where id=p_id;
  if found then
    if row(d.case_id,d.decision,d.reason,d.conditions,d.decided_by)
      is distinct from row(p_case_id,p_status,p_reason,p_conditions,p_actor) then
      raise exception 'CASE_DECISION_LOCKED';
    end if;
    return d.id;
  end if;
  if c.status='draft' then raise exception 'DRAFT_CASE_LOCKED'; end if;
  if c.status in ('approved','conditional','approved_with_conditions','rejected')
    or exists(select 1 from public.renovation_case_decisions where case_id=p_case_id) then
    raise exception 'CASE_DECISION_LOCKED';
  end if;
  -- All three writes succeed or roll back together.
  update public.renovation_cases set status=p_status where id=p_case_id;
  insert into public.renovation_case_decisions(id,case_id,decision,reason,conditions,decided_by,delivery_status)
    values(p_id,p_case_id,p_status,p_reason,p_conditions,p_actor,'pending');
  insert into public.renovation_case_messages(case_id,type,author_role,author_profile_id,message,metadata)
    values(p_case_id,'decision','board',p_actor,
      p_reason || case when p_status='conditional' then E'\n\nVillkor:\n'||p_conditions else '' end,
      jsonb_build_object('decision',p_status,'previousStatus',c.status,'nextStatus',p_status,'decisionId',p_id));
  return p_id;
end $$;
revoke all on function public.renoapp_record_final_decision(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.renoapp_record_final_decision(uuid,uuid,text,text,text,uuid) to service_role;

commit;
