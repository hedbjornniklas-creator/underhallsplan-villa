-- Complete only missing profile identity during future invitation acceptance.
-- Installation does not backfill profiles, grants, memberships or documents.
begin;

create or replace function public.organization_invitation_accept(p_actor uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.organization_invitations%rowtype; v_org uuid; v_email text; v_modules text[];
begin
  select org_id into v_org from public.organization_invitations where token_hash=p_token_hash;
  if not found then raise exception 'ORG_INVITE_INVALID'; end if;
  perform 1 from public.organizations where id=v_org for update;
  select * into invitation from public.organization_invitations where token_hash=p_token_hash and org_id=v_org for update;
  if not found then raise exception 'ORG_INVITE_INVALID'; end if;
  select lower(email) into v_email from auth.users where id=p_actor and email_confirmed_at is not null for update;
  if not found or v_email is distinct from invitation.email then raise exception 'ORG_INVITE_EMAIL_MISMATCH'; end if;
  if invitation.status='accepted' and invitation.accepted_by_profile_id=p_actor then
    if not exists(select 1 from public.org_members where org_id=v_org and profile_id=p_actor and is_active)
      then raise exception 'ORG_INVITE_INVALID'; end if;
    return jsonb_build_object('accepted',true,'reused',true,'organizationId',v_org,'profileId',p_actor);
  end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'ORG_INVITE_INVALID'; end if;
  if not exists(select 1 from public.org_members where org_id=v_org and profile_id=invitation.created_by_profile_id and role='admin' and is_active)
    then raise exception 'ORG_INVITE_INVALID'; end if;
  v_modules:=public.organization_validate_modules(v_org,to_jsonb(invitation.modules));
  if exists(select 1 from public.org_members where org_id=v_org and profile_id=p_actor) then raise exception 'ORG_MEMBER_EXISTS'; end if;
  insert into public.profiles(id,email,full_name,is_admin)
    values(p_actor,invitation.email,invitation.full_name,false)
    on conflict(id) do update set
      email=case when nullif(btrim(profiles.email),'') is null then excluded.email else profiles.email end,
      full_name=case when nullif(btrim(profiles.full_name),'') is null then excluded.full_name else profiles.full_name end;
  perform public.platform_organization_assert_managed_target(p_actor);
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,p_actor,invitation.role,true,not exists(select 1 from public.org_members where profile_id=p_actor and is_default));
  perform public.organization_apply_member_grants(invitation.created_by_profile_id,v_org,p_actor,invitation.role,true,v_modules);
  update public.organization_invitations set status='accepted',accepted_by_profile_id=p_actor,accepted_at=now(),revision=revision+1 where id=invitation.id;
  return jsonb_build_object('accepted',true,'reused',false,'organizationId',v_org,'profileId',p_actor);
end; $$;

revoke all on function public.organization_invitation_accept(uuid,text) from public,anon,authenticated;
grant execute on function public.organization_invitation_accept(uuid,text) to service_role;
commit;
