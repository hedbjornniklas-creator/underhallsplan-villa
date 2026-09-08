-- Paid customer-owner links require a browser session verified by OTP.
-- Contractor bearer links and immutable orders are unchanged.
begin;

alter table public.eb_follow_up_challenges
  add column if not exists purpose text not null default 'report',
  add column if not exists owner_access_link_id uuid references public.eb_remediation_access_links(id) on delete cascade;
alter table public.eb_follow_up_challenges
  drop constraint if exists eb_follow_up_challenges_purpose_check;
alter table public.eb_follow_up_challenges
  add constraint eb_follow_up_challenges_purpose_check check (
    (purpose='report' and owner_access_link_id is null)
    or (purpose='owner' and owner_access_link_id is not null)
  );
create index if not exists eb_follow_up_challenges_owner_idx
  on public.eb_follow_up_challenges(owner_access_link_id,created_at desc) where purpose='owner';

create or replace function public.eb_request_follow_up_owner_challenge(
  p_id uuid,p_access_link_id uuid,p_email text,p_code_hash text,p_mail_ciphertext text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a eb_remediation_access_links; o eb_follow_up_orders; recipient text;
begin
  select * into a from eb_remediation_access_links where id=p_access_link_id
    and role='customer_owner' and follow_up_order_id is not null
    and revoked_at is null and expires_at>now() for share;
  if not found then return jsonb_build_object('limited',false); end if;
  select * into o from eb_follow_up_orders where id=a.follow_up_order_id and status='active'
    and org_id=a.org_id and eb_project_id=a.eb_project_id and inspection_id=a.inspection_id for share;
  if not found then return jsonb_build_object('limited',false); end if;
  recipient := lower(btrim(o.buyer_snapshot->>'email'));
  if recipient is null or recipient='' or recipient<>lower(btrim(a.email))
    or recipient<>lower(btrim(coalesce(p_email,''))) then
    return jsonb_build_object('limited',false);
  end if;
  if p_mail_ciphertext is null or btrim(p_mail_ciphertext)='' then
    raise exception 'EB_FOLLOW_UP_UNAVAILABLE';
  end if;
  -- Share the report-verification rate lock and counters, including every owner
  -- link for this inspection, so forwarding/renewing a link cannot reset limits.
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-code:'||o.inspection_id::text,0));
  if (select count(*) from eb_follow_up_challenges where inspection_id=o.inspection_id
      and created_at>now()-interval '1 hour')>=20
    or (select count(*) from eb_follow_up_challenges where inspection_id=o.inspection_id and email=recipient
      and created_at>now()-interval '1 hour')>=5
    or exists(select 1 from eb_follow_up_challenges where inspection_id=o.inspection_id and email=recipient
      and created_at>now()-interval '60 seconds') then
    return jsonb_build_object('limited',true);
  end if;
  -- Keep the purchased report reference even when its public link was revoked.
  -- Owner verification does not republish a report or create another order.
  insert into eb_follow_up_challenges(id,org_id,inspection_id,report_link_id,email,code_hash,eligible,purpose,owner_access_link_id)
    values(p_id,o.org_id,o.inspection_id,o.report_link_id,recipient,p_code_hash,true,'owner',a.id);
  insert into eb_follow_up_email_outbox(order_id,dedupe_key,kind,payload_ciphertext)
    values(o.id,'owner-challenge:'||p_id,'verification',p_mail_ciphertext);
  return jsonb_build_object('limited',false);
end $$;

revoke all on function public.eb_request_follow_up_owner_challenge(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.eb_request_follow_up_owner_challenge(uuid,uuid,text,text,text) to service_role;
commit;
