begin;

-- Only the server may check the account behind an active personal invitation.
-- NULL means the invitation is not eligible; false means no account exists.
create or replace function public.renoapp_invite_account_exists(p_token_hash text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(btrim(i.email))
  )
  from public.brf_member_invites i
  where i.token_hash = p_token_hash
    and i.invite_kind = 'member_access'
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

revoke all on function public.renoapp_invite_account_exists(text) from public, anon, authenticated;
grant execute on function public.renoapp_invite_account_exists(text) to service_role;

commit;
