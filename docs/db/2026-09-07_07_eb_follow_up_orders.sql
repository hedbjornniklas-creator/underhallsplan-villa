-- EB paid follow-up. Apply after the EB remediation and inspection-scope migrations.
-- Additive: legacy portal links/tasks stay separate from purchased snapshots.
-- New sales require EB_FOLLOW_UP_ENABLED=true and complete seller configuration.
begin;

alter table public.organizations add column if not exists eb_follow_up_seller jsonb;

create table if not exists public.eb_follow_up_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  eb_project_id uuid not null references public.eb_projects(id) on delete restrict,
  inspection_id uuid not null unique references public.inspections(id) on delete restrict,
  report_link_id uuid not null references public.inspection_report_links(id) on delete restrict,
  report_snapshot jsonb not null,
  buyer_snapshot jsonb not null,
  seller_snapshot jsonb not null,
  price_ore integer not null default 59900 check (price_ore = 59900),
  net_price_ore integer not null default 47920 check (net_price_ore = 47920),
  vat_ore integer not null default 11980 check (vat_ore = 11980),
  vat_rate integer not null default 25 check (vat_rate = 25),
  currency text not null default 'SEK' check (currency = 'SEK'),
  status text not null default 'active' check (status = 'active'),
  billing_status text not null default 'pending' check (billing_status in ('pending','on_hold','invoiced','cancelled')),
  terms_version text not null,
  accept_terms boolean not null check (accept_terms),
  request_immediate_start boolean not null check (request_immediate_start),
  accept_invoice boolean not null check (accept_invoice),
  accepted_at timestamptz not null default now(),
  activated_at timestamptz not null default now(),
  withdrawal_requested_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.eb_follow_up_challenges (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  report_link_id uuid not null references public.inspection_report_links(id) on delete cascade,
  email text not null,
  code_hash text not null check (length(code_hash) = 64),
  eligible boolean not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  completed_order_id uuid references public.eb_follow_up_orders(id),
  encrypted_result text,
  created_at timestamptz not null default now()
);
create index if not exists eb_follow_up_challenges_rate_idx on public.eb_follow_up_challenges(inspection_id,created_at desc);

create table if not exists public.eb_follow_up_email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.eb_follow_up_orders(id) on delete restrict,
  event_id uuid,
  dedupe_key text not null unique,
  kind text not null check (kind in ('email','verification','receipt','invoice','access','withdrawal','task_event')),
  payload jsonb not null default '{}'::jsonb,
  payload_ciphertext text,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists eb_follow_up_email_outbox_due_idx on public.eb_follow_up_email_outbox(next_attempt_at)
  where status in ('pending','processing');

alter table public.eb_remediation_tasks
  add column if not exists follow_up_order_id uuid references public.eb_follow_up_orders(id) on delete restrict,
  add column if not exists original_note_id uuid,
  add column if not exists original_images jsonb not null default '[]'::jsonb;
alter table public.eb_remediation_tasks alter column eb_note_id drop not null;
alter table public.eb_remediation_tasks drop constraint if exists eb_remediation_tasks_eb_note_id_fkey;
alter table public.eb_remediation_tasks add constraint eb_remediation_tasks_eb_note_id_fkey
  foreign key (eb_note_id) references public.eb_notes(id) on delete set null;
drop index if exists public.eb_remediation_tasks_note_unique_idx;
create unique index if not exists eb_remediation_tasks_legacy_note_unique_idx
  on public.eb_remediation_tasks(eb_note_id) where follow_up_order_id is null;
create unique index if not exists eb_remediation_tasks_order_note_unique_idx
  on public.eb_remediation_tasks(follow_up_order_id,original_note_id) where follow_up_order_id is not null;

-- Preserve the former CASCADE behavior for legacy tasks only. Paid evidence
-- survives source-note deletion through its independent original_note_id.
create or replace function public.eb_delete_legacy_remediation_for_note() returns trigger
language plpgsql set search_path = public as $$
begin
  delete from eb_remediation_tasks where eb_note_id=old.id and follow_up_order_id is null;
  return old;
end $$;
drop trigger if exists eb_delete_legacy_remediation_for_note on public.eb_notes;
create trigger eb_delete_legacy_remediation_for_note before delete on public.eb_notes
  for each row execute function public.eb_delete_legacy_remediation_for_note();

alter table public.eb_remediation_assignees add column if not exists follow_up_order_id uuid
  references public.eb_follow_up_orders(id) on delete restrict;
drop index if exists public.eb_remediation_assignees_project_name_unique_idx;
create unique index if not exists eb_remediation_assignees_project_order_name_unique_idx
  on public.eb_remediation_assignees(eb_project_id,normalized_name,follow_up_order_id) nulls not distinct;

alter table public.eb_remediation_access_links add column if not exists follow_up_order_id uuid
  references public.eb_follow_up_orders(id) on delete restrict;
alter table public.eb_remediation_access_links drop constraint if exists eb_remediation_access_links_role_check;
alter table public.eb_remediation_access_links add constraint eb_remediation_access_links_role_check
  check (role in ('contractor_admin','contractor_viewer','assignee','customer_owner'));
alter table public.eb_remediation_access_links drop constraint if exists eb_follow_up_owner_scope_check;
alter table public.eb_remediation_access_links add constraint eb_follow_up_owner_scope_check
  check (role <> 'customer_owner' or (follow_up_order_id is not null and inspection_id is not null));

-- No browser role can create a purchase, challenge, or queued email directly.
alter table public.eb_follow_up_orders enable row level security;
alter table public.eb_follow_up_challenges enable row level security;
alter table public.eb_follow_up_email_outbox enable row level security;
revoke all on public.eb_follow_up_orders,public.eb_follow_up_challenges,public.eb_follow_up_email_outbox from anon,authenticated;
grant all on public.eb_follow_up_orders,public.eb_follow_up_challenges,public.eb_follow_up_email_outbox to service_role;

create or replace function public.eb_follow_up_guard_order() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['billing_status','withdrawal_requested_at'])
    is distinct from (to_jsonb(old) - array['billing_status','withdrawal_requested_at']) then
    raise exception 'EB_FOLLOW_UP_ORDER_IMMUTABLE';
  end if;
  if old.withdrawal_requested_at is not null and new.withdrawal_requested_at is distinct from old.withdrawal_requested_at then
    raise exception 'EB_FOLLOW_UP_WITHDRAWAL_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists eb_follow_up_order_immutable on public.eb_follow_up_orders;
create trigger eb_follow_up_order_immutable before update on public.eb_follow_up_orders
  for each row execute function public.eb_follow_up_guard_order();

create or replace function public.eb_request_follow_up_challenge(
  p_id uuid,p_org_id uuid,p_inspection_id uuid,p_report_link_id uuid,p_email text,
  p_code_hash text,p_eligible boolean,p_mail_ciphertext text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-code:' || p_inspection_id::text,0));
  if not exists (select 1 from inspection_report_links where id=p_report_link_id and org_id=p_org_id
    and inspection_id=p_inspection_id and revoked_at is null) then raise exception 'EB_FOLLOW_UP_REPORT_UNAVAILABLE'; end if;
  if (select count(*) from eb_follow_up_challenges where inspection_id=p_inspection_id
      and created_at > now()-interval '1 hour') >= 20
    or (select count(*) from eb_follow_up_challenges where inspection_id=p_inspection_id and email=p_email
      and created_at > now()-interval '1 hour') >= 5
    or exists(select 1 from eb_follow_up_challenges where inspection_id=p_inspection_id and email=p_email
      and created_at > now()-interval '60 seconds') then
    return jsonb_build_object('limited',true);
  end if;
  insert into eb_follow_up_challenges(id,org_id,inspection_id,report_link_id,email,code_hash,eligible)
    values(p_id,p_org_id,p_inspection_id,p_report_link_id,p_email,p_code_hash,p_eligible);
  if p_eligible then
    insert into eb_follow_up_email_outbox(dedupe_key,kind,payload_ciphertext)
      values('challenge:'||p_id,'verification',p_mail_ciphertext);
  end if;
  return jsonb_build_object('limited',false);
end $$;

create or replace function public.eb_verify_follow_up_challenge(p_id uuid,p_report_link_id uuid,p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c eb_follow_up_challenges;
begin
  select * into c from eb_follow_up_challenges where id=p_id and report_link_id=p_report_link_id for update;
  if not found or c.expires_at <= now() or c.attempts >= 5 then return jsonb_build_object('verified',false); end if;
  if not c.eligible or c.code_hash <> p_code_hash then
    update eb_follow_up_challenges set attempts=attempts+1 where id=c.id;
    return jsonb_build_object('verified',false);
  end if;
  update eb_follow_up_challenges set verified_at=coalesce(verified_at,now()) where id=c.id;
  return jsonb_build_object('verified',true,'email',c.email);
end $$;

-- Verification + owner access are separate from the read-only public report token.
-- All activation rows and confirmation email jobs commit together; retries cannot bill twice.
create or replace function public.eb_complete_follow_up_order(
  p_challenge_id uuid,p_report_link_id uuid,p_candidate_order_id uuid,p_project_id uuid,
  p_buyer jsonb,p_seller jsonb,p_tasks jsonb,p_access jsonb,p_emails jsonb,p_create boolean,p_terms_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c eb_follow_up_challenges; r inspection_report_links; o eb_follow_up_orders;
  task jsonb; mail jsonb; task_id uuid; created boolean := false; v_source_note_id uuid;
begin
  select * into c from eb_follow_up_challenges where id=p_challenge_id and report_link_id=p_report_link_id for update;
  if not found or not c.eligible or c.verified_at is null or c.expires_at <= now() then
    raise exception 'EB_FOLLOW_UP_VERIFICATION_REQUIRED'; end if;
  if c.completed_order_id is not null then
    return jsonb_build_object('orderId',c.completed_order_id,'encryptedResult',c.encrypted_result,'created',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||c.inspection_id::text,0));
  select * into r from inspection_report_links where id=p_report_link_id and org_id=c.org_id and revoked_at is null for share;
  if not found then raise exception 'EB_FOLLOW_UP_REPORT_UNAVAILABLE'; end if;
  select * into o from eb_follow_up_orders where inspection_id=c.inspection_id for update;
  if not found then
    if not p_create then raise exception 'EB_FOLLOW_UP_ORDER_REQUIRED'; end if;
    if exists(select 1 from inspection_report_links where inspection_id=c.inspection_id and org_id=c.org_id
      and revoked_at is null and (created_at,id) > (r.created_at,r.id)) then
      raise exception 'EB_FOLLOW_UP_REPORT_REPLACED'; end if;
    if p_terms_version <> '2026-09-07' or p_buyer->>'email' <> c.email then
      raise exception 'EB_FOLLOW_UP_CONSENT_REQUIRED'; end if;
    if not exists(select 1 from eb_projects where id=p_project_id and org_id=c.org_id) then
      raise exception 'EB_FOLLOW_UP_REPORT_UNAVAILABLE'; end if;
    insert into eb_follow_up_orders(id,org_id,eb_project_id,inspection_id,report_link_id,report_snapshot,
      buyer_snapshot,seller_snapshot,terms_version,accept_terms,request_immediate_start,accept_invoice)
      values(p_candidate_order_id,c.org_id,p_project_id,c.inspection_id,r.id,r.snapshot_payload,
        p_buyer,p_seller,p_terms_version,true,true,true) returning * into o;
    created := true;
    for task in select value from jsonb_array_elements(p_tasks) loop
      v_source_note_id := (task->>'noteId')::uuid;
      insert into eb_remediation_tasks(org_id,eb_project_id,inspection_id,eb_note_id,original_note_id,
        follow_up_order_id,assignment_managed_by,note_snapshot,original_images)
        values(c.org_id,p_project_id,c.inspection_id,
          (select source_note.id from eb_notes as source_note where source_note.id=v_source_note_id and source_note.inspection_id=c.inspection_id),v_source_note_id,
          o.id,'contractor',task->'snapshot',coalesce(task->'images','[]'::jsonb)) returning id into task_id;
      insert into eb_remediation_events(org_id,eb_project_id,task_id,event_type,actor_name,actor_email,metadata)
        values(c.org_id,p_project_id,task_id,'task_created',p_buyer->>'name',c.email,
          jsonb_build_object('followUpOrderId',o.id,'reportLinkId',r.id));
    end loop;
  elsif lower(o.buyer_snapshot->>'email') <> c.email then
    raise exception 'EB_FOLLOW_UP_BUYER_MISMATCH';
  end if;
  insert into eb_remediation_access_links(id,org_id,eb_project_id,inspection_id,follow_up_order_id,
    role,display_name,email,token_hash,expires_at)
    values((p_access->>'id')::uuid,o.org_id,o.eb_project_id,o.inspection_id,o.id,'customer_owner',
      o.buyer_snapshot->>'name',c.email,p_access->>'tokenHash',(p_access->>'expiresAt')::timestamptz);
  for mail in select value from jsonb_array_elements(p_emails) loop
    if (created and mail->>'kind' in ('receipt','invoice')) or (not created and mail->>'kind'='access') then
      insert into eb_follow_up_email_outbox(order_id,dedupe_key,kind,payload_ciphertext)
        values(o.id,mail->>'dedupeKey',mail->>'kind',mail->>'ciphertext') on conflict(dedupe_key) do nothing;
    end if;
  end loop;
  update eb_follow_up_challenges set completed_order_id=o.id,encrypted_result=p_access->>'encryptedResult' where id=c.id;
  return jsonb_build_object('orderId',o.id,'encryptedResult',p_access->>'encryptedResult','created',created);
end $$;

create or replace function public.eb_withdraw_follow_up_order(p_order_id uuid,p_actor_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o eb_follow_up_orders;
begin
  select * into o from eb_follow_up_orders where id=p_order_id for update;
  if not found or lower(o.buyer_snapshot->>'email') <> lower(p_actor_email) then raise exception 'EB_FOLLOW_UP_FORBIDDEN'; end if;
  if o.withdrawal_requested_at is null then
    update eb_follow_up_orders set withdrawal_requested_at=now(),billing_status='on_hold' where id=o.id returning * into o;
    insert into eb_follow_up_email_outbox(order_id,dedupe_key,kind)
      values(o.id,'withdrawal:'||o.id,'withdrawal') on conflict(dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id',o.id,'withdrawalRequestedAt',o.withdrawal_requested_at,'billingStatus',o.billing_status);
end $$;

create or replace function public.eb_renew_follow_up_owner_access(
  p_previous_id uuid,p_new_id uuid,p_token_hash text,p_expires_at timestamptz,p_mail_ciphertext text
) returns boolean language plpgsql security definer set search_path = public as $$
declare a eb_remediation_access_links; o eb_follow_up_orders;
begin
  select * into a from eb_remediation_access_links where id=p_previous_id and role='customer_owner' and revoked_at is null;
  if not found then return false; end if;
  select * into o from eb_follow_up_orders where id=a.follow_up_order_id for update;
  if not found or lower(o.buyer_snapshot->>'email') <> lower(a.email) then return false; end if;
  if (select count(*) from eb_remediation_access_links where follow_up_order_id=o.id and role='customer_owner'
    and created_at>now()-interval '24 hours') >= 6
    or exists(select 1 from eb_remediation_access_links where follow_up_order_id=o.id and role='customer_owner'
      and created_at>now()-interval '60 seconds') then return false; end if;
  insert into eb_remediation_access_links(id,org_id,eb_project_id,inspection_id,follow_up_order_id,
    role,display_name,email,token_hash,expires_at)
    values(p_new_id,o.org_id,o.eb_project_id,o.inspection_id,o.id,'customer_owner',o.buyer_snapshot->>'name',
      o.buyer_snapshot->>'email',p_token_hash,p_expires_at);
  insert into eb_follow_up_email_outbox(order_id,dedupe_key,kind,payload_ciphertext)
    values(o.id,'owner-renewal:'||p_new_id,'access',p_mail_ciphertext);
  return true;
end $$;

create or replace function public.eb_claim_follow_up_emails(p_limit integer default 10)
returns setof public.eb_follow_up_email_outbox language plpgsql security definer set search_path = public as $$
begin
  update eb_follow_up_email_outbox set status='failed',lease_id=null,locked_at=null,
    last_error='Leveransen avbröts efter maximalt antal försök.'
    where attempts>=10 and status='processing' and locked_at<now()-interval '5 minutes';
  return query update eb_follow_up_email_outbox set status='processing',attempts=attempts+1,locked_at=now(),lease_id=gen_random_uuid()
  where id in (select id from eb_follow_up_email_outbox where attempts < 10
    and ((status='pending' and next_attempt_at<=now()) or (status='processing' and locked_at<now()-interval '5 minutes'))
    order by next_attempt_at limit greatest(1,least(p_limit,50)) for update skip locked) returning *;
end
$$;

create or replace function public.eb_finish_follow_up_email(p_id uuid,p_lease_id uuid,p_success boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update eb_follow_up_email_outbox set
    status=case when p_success then 'sent' when attempts>=10 then 'failed' else 'pending' end,
    sent_at=case when p_success then now() else null end,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)),
    last_error=case when p_success then null else left(p_error,300) end,locked_at=null,lease_id=null,
    payload_ciphertext=case when p_success then null else payload_ciphertext end
    where id=p_id and status='processing' and lease_id=p_lease_id;
  return found;
end $$;

revoke all on function public.eb_request_follow_up_challenge(uuid,uuid,uuid,uuid,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.eb_verify_follow_up_challenge(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.eb_complete_follow_up_order(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text) from public,anon,authenticated;
revoke all on function public.eb_withdraw_follow_up_order(uuid,text) from public,anon,authenticated;
revoke all on function public.eb_renew_follow_up_owner_access(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.eb_claim_follow_up_emails(integer) from public,anon,authenticated;
revoke all on function public.eb_finish_follow_up_email(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.eb_request_follow_up_challenge(uuid,uuid,uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.eb_verify_follow_up_challenge(uuid,uuid,text) to service_role;
grant execute on function public.eb_complete_follow_up_order(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text) to service_role;
grant execute on function public.eb_withdraw_follow_up_order(uuid,text) to service_role;
grant execute on function public.eb_renew_follow_up_owner_access(uuid,uuid,text,timestamptz,text) to service_role;
grant execute on function public.eb_claim_follow_up_emails(integer) to service_role;
grant execute on function public.eb_finish_follow_up_email(uuid,uuid,boolean,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('eb-follow-up-originals','eb-follow-up-originals',false,15728640,
    array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do nothing;
-- Intentionally no anon/authenticated storage policies. Access uses scoped signed URLs.
commit;
