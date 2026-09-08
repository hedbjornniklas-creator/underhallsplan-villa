-- Stop automatic list-activity emails. The explicit "Skicka lista" invitation
-- and purchase/invoice/withdrawal emails keep their existing outbox workflow.
-- Task changes, images and their audit events are still saved by the action RPC.
-- Deploy the matching followUpDelivery worker to skip already queued activity
-- jobs (including encrypted emails expanded by the old worker).
begin;

create or replace function public.eb_skip_follow_up_activity_mail()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'task_event' then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.eb_skip_follow_up_activity_mail() from public, anon, authenticated;

drop trigger if exists eb_skip_follow_up_activity_mail on public.eb_follow_up_email_outbox;
create trigger eb_skip_follow_up_activity_mail
before insert on public.eb_follow_up_email_outbox
for each row when (new.kind = 'task_event')
execute function public.eb_skip_follow_up_activity_mail();

commit;
