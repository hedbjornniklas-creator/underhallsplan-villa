-- Correlate an invitation with Resend without storing its personal access link.
alter table public.brf_member_invites
  add column if not exists provider_message_id text;

comment on column public.brf_member_invites.provider_message_id is
  'Resend message id for the most recent accepted send. Sent does not imply inbox delivery.';
