-- Durable, actor-specific read cursors for the Uppdrag conversation.
--
-- A cursor always points at an append-only comment event in the same task.
-- Reads move monotonically by (comment created_at, comment id), so retries and
-- concurrent clients can never move a participant's cursor backwards.

begin;

create table if not exists public.task_conversation_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  reader_profile_id uuid references public.profiles (id) on delete cascade,
  reader_contact_id uuid references public.organization_contacts (id) on delete cascade,
  last_read_comment_id uuid not null references public.task_events (id) on delete cascade,
  last_read_comment_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_conversation_reads_reader_shape_check
    check (num_nonnulls(reader_profile_id, reader_contact_id) = 1)
);

create unique index if not exists task_conversation_reads_task_profile_unique_idx
  on public.task_conversation_reads (task_id, reader_profile_id)
  where reader_profile_id is not null;

create unique index if not exists task_conversation_reads_task_contact_unique_idx
  on public.task_conversation_reads (task_id, reader_contact_id)
  where reader_contact_id is not null;

create index if not exists task_conversation_reads_profile_lookup_idx
  on public.task_conversation_reads (
    reader_profile_id,
    task_id,
    last_read_comment_created_at,
    last_read_comment_id
  )
  where reader_profile_id is not null;

create index if not exists task_conversation_reads_contact_lookup_idx
  on public.task_conversation_reads (
    reader_contact_id,
    task_id,
    last_read_comment_created_at,
    last_read_comment_id
  )
  where reader_contact_id is not null;

-- Establish the rollout baseline before RLS is locked below. Without this
-- cursor, every historical comment would appear unread when the application
-- first starts projecting unread counts. Existing cursors are never replaced,
-- which also makes a retried migration safe after live reads have advanced.
with latest_comments as (
  select distinct on (task.id)
    task.org_id,
    task.id as task_id,
    task.issuer_profile_id,
    task.assignee_profile_id,
    task.assignee_contact_id,
    event.id as comment_id,
    event.created_at as comment_created_at
  from public.operational_tasks task
  join public.task_events event
    on event.task_id = task.id
   and event.org_id = task.org_id
   and event.event_type = 'comment'
  where task.archived_at is null
  order by task.id, event.created_at desc, event.id desc
), participant_cursors as (
  select
    latest.org_id,
    latest.task_id,
    latest.issuer_profile_id as reader_profile_id,
    null::uuid as reader_contact_id,
    latest.comment_id,
    latest.comment_created_at
  from latest_comments latest

  union all

  select
    latest.org_id,
    latest.task_id,
    latest.assignee_profile_id as reader_profile_id,
    null::uuid as reader_contact_id,
    latest.comment_id,
    latest.comment_created_at
  from latest_comments latest
  where latest.assignee_profile_id is not null

  union all

  select
    latest.org_id,
    latest.task_id,
    null::uuid as reader_profile_id,
    latest.assignee_contact_id as reader_contact_id,
    latest.comment_id,
    latest.comment_created_at
  from latest_comments latest
  where latest.assignee_contact_id is not null
)
insert into public.task_conversation_reads (
  org_id,
  task_id,
  reader_profile_id,
  reader_contact_id,
  last_read_comment_id,
  last_read_comment_created_at
)
select
  participant.org_id,
  participant.task_id,
  participant.reader_profile_id,
  participant.reader_contact_id,
  participant.comment_id,
  participant.comment_created_at
from participant_cursors participant
on conflict do nothing;

drop trigger if exists trg_task_conversation_reads_set_updated_at
  on public.task_conversation_reads;
create trigger trg_task_conversation_reads_set_updated_at
before update on public.task_conversation_reads
for each row execute function public.operational_tasks_set_updated_at();

alter table public.task_conversation_reads enable row level security;
alter table public.task_conversation_reads force row level security;

revoke all on table public.task_conversation_reads
  from public, anon, authenticated;
grant select, insert, update, delete on table public.task_conversation_reads
  to service_role;

create or replace function public.mark_task_conversation_read(
  p_task_id uuid,
  p_through_event_id uuid,
  p_actor_profile_id uuid default null,
  p_actor_contact_id uuid default null,
  p_actor_access_link_id uuid default null
)
returns public.task_conversation_reads
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  comment_row public.task_events%rowtype;
  result public.task_conversation_reads%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_CONVERSATION_READ_SERVICE_ROLE_REQUIRED';
  end if;

  if p_task_id is null
    or p_through_event_id is null
    or num_nonnulls(p_actor_profile_id, p_actor_contact_id) <> 1
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_CONVERSATION_READ_INPUT_INVALID';
  end if;

  if p_actor_profile_id is not null and p_actor_access_link_id is not null then
    raise exception using
      errcode = '22023',
      message = 'TASK_CONVERSATION_READ_ACTOR_INVALID';
  end if;

  if p_actor_contact_id is not null and p_actor_access_link_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_CONVERSATION_READ_ACCESS_LINK_REQUIRED';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOT_FOUND';
  end if;

  select event.*
  into comment_row
  from public.task_events event
  where event.id = p_through_event_id
    and event.task_id = task_row.id
    and event.org_id = task_row.org_id
    and event.event_type = 'comment';

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_CONVERSATION_COMMENT_NOT_FOUND';
  end if;

  if p_actor_profile_id is not null then
    if (
      p_actor_profile_id is distinct from task_row.issuer_profile_id
      and p_actor_profile_id is distinct from task_row.assignee_profile_id
    ) or not exists (
      select 1
      from public.org_members member
      where member.org_id = task_row.org_id
        and member.profile_id = p_actor_profile_id
        and member.is_active = true
    ) then
      raise exception using
        errcode = '42501',
        message = 'TASK_CONVERSATION_READ_FORBIDDEN';
    end if;

    insert into public.task_conversation_reads as current_read (
      org_id,
      task_id,
      reader_profile_id,
      reader_contact_id,
      last_read_comment_id,
      last_read_comment_created_at
    )
    values (
      task_row.org_id,
      task_row.id,
      p_actor_profile_id,
      null,
      comment_row.id,
      comment_row.created_at
    )
    on conflict (task_id, reader_profile_id)
      where reader_profile_id is not null
    do update set
      last_read_comment_id = excluded.last_read_comment_id,
      last_read_comment_created_at = excluded.last_read_comment_created_at
    where (
      current_read.last_read_comment_created_at,
      current_read.last_read_comment_id
    ) < (
      excluded.last_read_comment_created_at,
      excluded.last_read_comment_id
    )
    returning * into result;

    if result.id is null then
      select conversation_read.*
      into result
      from public.task_conversation_reads conversation_read
      where conversation_read.task_id = task_row.id
        and conversation_read.reader_profile_id = p_actor_profile_id;
    end if;
  else
    if task_row.assignee_contact_id is distinct from p_actor_contact_id
      or not public.task_access_link_covers(
        p_actor_access_link_id,
        task_row.id,
        p_actor_contact_id
      )
    then
      raise exception using
        errcode = '42501',
        message = 'TASK_CONVERSATION_READ_FORBIDDEN';
    end if;

    insert into public.task_conversation_reads as current_read (
      org_id,
      task_id,
      reader_profile_id,
      reader_contact_id,
      last_read_comment_id,
      last_read_comment_created_at
    )
    values (
      task_row.org_id,
      task_row.id,
      null,
      p_actor_contact_id,
      comment_row.id,
      comment_row.created_at
    )
    on conflict (task_id, reader_contact_id)
      where reader_contact_id is not null
    do update set
      last_read_comment_id = excluded.last_read_comment_id,
      last_read_comment_created_at = excluded.last_read_comment_created_at
    where (
      current_read.last_read_comment_created_at,
      current_read.last_read_comment_id
    ) < (
      excluded.last_read_comment_created_at,
      excluded.last_read_comment_id
    )
    returning * into result;

    if result.id is null then
      select conversation_read.*
      into result
      from public.task_conversation_reads conversation_read
      where conversation_read.task_id = task_row.id
        and conversation_read.reader_contact_id = p_actor_contact_id;
    end if;
  end if;

  if result.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_CONVERSATION_READ_NOT_FOUND';
  end if;

  return result;
end;
$$;

comment on table public.task_conversation_reads is
  'Service-only monotonic per-participant cursors over append-only task comment events.';

comment on function public.mark_task_conversation_read(uuid, uuid, uuid, uuid, uuid) is
  'Service-only read cursor update. The through event must be a comment in the same task and the actor must be its named issuer or current assignee.';

revoke all on function public.mark_task_conversation_read(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_task_conversation_read(uuid, uuid, uuid, uuid, uuid)
  to service_role;

commit;
