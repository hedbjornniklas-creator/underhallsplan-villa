-- Uppdrag: present the task assistant as Gizmo while keeping technical
-- actor types, API routes and legacy SIGNE_* identifiers backward compatible.
-- Historical task events and messages are deliberately left unchanged. Task
-- events are append-only audit records, and the application maps the legacy
-- display name "Signe" to "Gizmo" when old rows are rendered. The triggers
-- below normalize only new writes (and an explicitly renamed message).

create or replace function public.normalize_task_assistant_actor_name()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.actor_type in ('ai', 'system') and new.actor_name = 'Signe' then
    new.actor_name := 'Gizmo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_task_event_assistant_actor_name
  on public.task_events;
create trigger trg_normalize_task_event_assistant_actor_name
before insert
on public.task_events
for each row execute function public.normalize_task_assistant_actor_name();

drop trigger if exists trg_normalize_task_message_assistant_actor_name
  on public.task_messages;
create trigger trg_normalize_task_message_assistant_actor_name
before insert
on public.task_messages
for each row execute function public.normalize_task_assistant_actor_name();

revoke all on function public.normalize_task_assistant_actor_name()
  from public, anon, authenticated;
