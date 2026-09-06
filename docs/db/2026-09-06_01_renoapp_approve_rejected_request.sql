-- Allow an admin to correct an accidental rejection by approving the request.
-- Approved requests remain final because they may already have created a BRF.
begin;

create or replace function public.renoapp_start_brf_onboarding(
  p_actor uuid, p_input jsonb, p_token_hash text, p_expires_at timestamptz,
  p_request_id uuid default null, p_creation_key uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare req public.brf_requests; brf public.brf_associations; invite_id uuid;
  brf_name text; org text; email_address text; slug_base text; candidate text; suffix integer := 1;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  if p_request_id is not null then
    select * into req from public.brf_requests where id = p_request_id for update;
    if not found then raise exception 'BRF_REQUEST_NOT_FOUND'; end if;
    if req.status <> 'pending' then
      if req.status = p_input->>'decision' then
        select * into brf from public.brf_associations where id = req.approved_brf_id;
        return jsonb_build_object('request', to_jsonb(req), 'brf', case when brf.id is null then null else to_jsonb(brf) end, 'reused', true);
      end if;
      if not (req.status = 'rejected' and p_input->>'decision' = 'approved') then
        raise exception 'BRF_REQUEST_ALREADY_REVIEWED';
      end if;
    end if;
    if p_input->>'decision' = 'rejected' then
      update public.brf_requests set status = 'rejected', review_note = p_input->>'internalNote',
        external_message = p_input->>'externalMessage', reviewed_by = p_actor, reviewed_at = now()
        where id = req.id returning * into req;
      insert into public.renoapp_brf_events(request_id, actor_profile_id, kind) values(req.id, p_actor, 'request_rejected');
      return jsonb_build_object('request', to_jsonb(req), 'brf', null, 'reused', false);
    end if;
    if p_input->>'decision' is distinct from 'approved' then raise exception 'INVALID_ACTION'; end if;
    brf_name := req.name; org := req.org_number; email_address := lower(trim(req.contact_email));
  else
    if p_creation_key is null then raise exception 'CREATION_KEY_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_creation_key::text, 0));
    select * into brf from public.brf_associations where onboarding_key = p_creation_key;
    if found then return jsonb_build_object('brf', to_jsonb(brf), 'reused', true); end if;
    brf_name := trim(p_input->>'name'); org := p_input->>'orgNumber'; email_address := lower(trim(p_input->>'email'));
  end if;
  if coalesce(brf_name, '') = '' then raise exception 'BRF_NAME_REQUIRED'; end if;
  if coalesce(email_address, '') = '' then raise exception 'BOARD_EMAIL_INVALID'; end if;
  slug_base := coalesce(nullif(p_input->>'slug', ''), 'brf'); candidate := slug_base;
  perform pg_advisory_xact_lock(hashtextextended('renoapp-slug:' || slug_base, 0));
  while exists(select 1 from public.brf_associations where slug = candidate) loop
    suffix := suffix + 1; candidate := slug_base || '-' || suffix;
  end loop;
  insert into public.brf_associations(name, slug, org_number, address, primary_contact_name,
    primary_contact_email, primary_contact_phone, created_by, is_public_apply_enabled,
    is_public_apply_listed, onboarding_key, onboarding_source)
  values(brf_name, candidate, org, coalesce(req.address, p_input->>'address'), req.contact_name,
    email_address, req.contact_phone, p_actor, false, false, p_creation_key,
    case when p_request_id is null then 'manual' else 'request' end) returning * into brf;
  insert into public.brf_member_invites(brf_id, email, full_name, role, token_hash, expires_at, created_by, delivery_status)
    values(brf.id, email_address, req.contact_name, 'board', p_token_hash, p_expires_at, p_actor, 'pending') returning id into invite_id;
  if p_request_id is not null then
    update public.brf_requests set status = 'approved', review_note = p_input->>'internalNote',
      external_message = p_input->>'externalMessage', reviewed_by = p_actor, reviewed_at = now(), approved_brf_id = brf.id
      where id = req.id returning * into req;
    insert into public.renoapp_brf_events(brf_id, request_id, actor_profile_id, kind)
      values(brf.id, req.id, p_actor, 'request_approved');
  end if;
  return jsonb_build_object('brf', to_jsonb(brf), 'request', case when req.id is null then null else to_jsonb(req) end,
    'inviteId', invite_id, 'reused', false);
end $$;

commit;
