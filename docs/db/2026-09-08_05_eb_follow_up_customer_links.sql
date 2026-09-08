-- Apply after 2026-09-08_04. Separate buyer-only links; public report tokens remain read-only.
-- Existing orders, owner links and consent snapshots are not changed.
begin;

create table if not exists public.eb_follow_up_customer_links (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  report_link_id uuid not null references public.inspection_report_links(id) on delete cascade,
  email text not null,
  token_hash text not null unique check (length(token_hash)=64),
  report_token_ciphertext text not null,
  expires_at timestamptz not null default now()+interval '180 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists eb_follow_up_customer_links_scope_idx
  on public.eb_follow_up_customer_links(inspection_id,created_at desc);
alter table public.eb_follow_up_customer_links enable row level security;
revoke all on public.eb_follow_up_customer_links from public,anon,authenticated;
grant select,update on public.eb_follow_up_customer_links to service_role;
alter table public.eb_follow_up_challenges add column if not exists personal_link_id uuid
  references public.eb_follow_up_customer_links(id) on delete cascade;

create or replace function public.eb_validate_follow_up_customer_link(
  p_id uuid,p_org_id uuid,p_inspection_id uuid,p_report_link_id uuid,p_email text
) returns boolean language plpgsql security definer set search_path=public as $$
declare l eb_follow_up_customer_links; buyer text;
begin
  select * into l from eb_follow_up_customer_links where id=p_id and org_id=p_org_id
    and inspection_id=p_inspection_id and report_link_id=p_report_link_id and email=p_email
    and revoked_at is null and expires_at>now();
  if not found then return false; end if;
  if not exists(select 1 from inspection_report_links where id=l.report_link_id and org_id=l.org_id
    and inspection_id=l.inspection_id and revoked_at is null) then return false; end if;
  select lower(btrim(buyer_snapshot->>'email')) into buyer from eb_follow_up_orders
    where inspection_id=l.inspection_id and org_id=l.org_id and eb_project_id=l.eb_project_id;
  if not found then
    buyer := eb_resolve_follow_up_customer_email(l.org_id,l.eb_project_id,l.inspection_id);
  end if;
  return coalesce(buyer=l.email,false);
end $$;

create or replace function public.eb_issue_follow_up_customer_link(
  p_id uuid,p_public_token_hash text,p_email text,p_token_hash text,
  p_report_token_ciphertext text,p_mail_ciphertext text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r inspection_report_links; project_id uuid; buyer text; v_email text:=lower(btrim(p_email));
begin
  select * into r from inspection_report_links where token_hash=p_public_token_hash and revoked_at is null;
  if not found then return jsonb_build_object('issued',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||r.inspection_id::text,0));
  select eb_project_id into project_id from eb_inspection_details
    where inspection_id=r.inspection_id and org_id=r.org_id;
  if not found then return jsonb_build_object('issued',false); end if;
  select lower(btrim(buyer_snapshot->>'email')) into buyer from eb_follow_up_orders
    where inspection_id=r.inspection_id and org_id=r.org_id and eb_project_id=project_id;
  if not found then buyer:=eb_resolve_follow_up_customer_email(r.org_id,project_id,r.inspection_id); end if;
  if buyer is null or buyer is distinct from v_email then return jsonb_build_object('issued',false); end if;
  -- Recovery is rate limited. Delivery is already authenticated and must not be
  -- blocked by an anonymous request immediately before a legitimate report send.
  if p_mail_ciphertext is not null and (
    (select count(*) from eb_follow_up_customer_links where inspection_id=r.inspection_id
      and created_at>now()-interval '1 hour')>=5 or
    exists(select 1 from eb_follow_up_customer_links where inspection_id=r.inspection_id
      and created_at>now()-interval '60 seconds')
  ) then return jsonb_build_object('issued',false,'limited',true); end if;
  insert into eb_follow_up_customer_links(id,org_id,eb_project_id,inspection_id,report_link_id,
    email,token_hash,report_token_ciphertext)
    values(p_id,r.org_id,project_id,r.inspection_id,r.id,v_email,p_token_hash,p_report_token_ciphertext);
  if p_mail_ciphertext is not null then
    insert into eb_follow_up_email_outbox(dedupe_key,kind,payload_ciphertext)
      values('customer-link:'||p_id,'email',p_mail_ciphertext);
  end if;
  return jsonb_build_object('issued',true);
end $$;

create or replace function public.eb_open_follow_up_customer_link(
  p_token_hash text,p_challenge_id uuid,p_code_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare l eb_follow_up_customer_links; expiry timestamptz:=now()+interval '15 minutes';
begin
  select * into l from eb_follow_up_customer_links where token_hash=p_token_hash;
  if not found or not eb_validate_follow_up_customer_link(l.id,l.org_id,l.inspection_id,l.report_link_id,l.email)
    then return jsonb_build_object('authorized',false); end if;
  expiry:=least(expiry,l.expires_at);
  -- Reuse the existing atomic purchase intent/idempotency machinery, but no code
  -- is sent or accepted from the browser. The personal bearer secret is authority.
  insert into eb_follow_up_challenges(id,org_id,inspection_id,report_link_id,email,code_hash,
    eligible,verified_at,expires_at,purpose,personal_link_id)
    values(p_challenge_id,l.org_id,l.inspection_id,l.report_link_id,l.email,p_code_hash,
      true,now(),expiry,'report',l.id);
  return jsonb_build_object('authorized',true,'orgId',l.org_id,'inspectionId',l.inspection_id,
    'reportLinkId',l.report_link_id,'personalLinkId',l.id,'email',l.email,'expiresAt',expiry,
    'reportTokenCiphertext',l.report_token_ciphertext);
end $$;

-- Recheck revocation and changed customer identity when the existing transaction
-- verifies OR completes an intent. A failure rolls back all order/access/mail rows.
create or replace function public.eb_guard_personal_follow_up_intent()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.personal_link_id is not null and not eb_validate_follow_up_customer_link(
    new.personal_link_id,new.org_id,new.inspection_id,new.report_link_id,new.email
  ) then raise exception 'EB_FOLLOW_UP_VERIFICATION_REQUIRED'; end if;
  return new;
end $$;
drop trigger if exists eb_guard_personal_follow_up_intent on public.eb_follow_up_challenges;
create trigger eb_guard_personal_follow_up_intent before insert or update on public.eb_follow_up_challenges
  for each row execute function public.eb_guard_personal_follow_up_intent();

revoke all on function public.eb_validate_follow_up_customer_link(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.eb_issue_follow_up_customer_link(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.eb_open_follow_up_customer_link(text,uuid,text) from public,anon,authenticated;
revoke all on function public.eb_guard_personal_follow_up_intent() from public,anon,authenticated;
grant execute on function public.eb_validate_follow_up_customer_link(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.eb_issue_follow_up_customer_link(uuid,text,text,text,text,text) to service_role;
grant execute on function public.eb_open_follow_up_customer_link(text,uuid,text) to service_role;
commit;
