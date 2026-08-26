-- Keep execution actions with the named task recipient.
--
-- The application server verifies the exact assignee before calling these
-- service-role RPCs. Removing direct authenticated execution prevents an
-- organization administrator from bypassing that role boundary in the client.

begin;

revoke execute on function public.transition_operational_task(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  uuid,
  uuid,
  uuid
) from authenticated;

revoke execute on function public.request_operational_task_deadline_change(
  uuid,
  timestamptz,
  text,
  uuid,
  uuid,
  uuid
) from authenticated;

grant execute on function public.transition_operational_task(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  uuid,
  uuid,
  uuid
) to service_role;

grant execute on function public.request_operational_task_deadline_change(
  uuid,
  timestamptz,
  text,
  uuid,
  uuid,
  uuid
) to service_role;

commit;
