-- Gizmo: customer overview and versioned customer offers.
-- Prerequisites: action case foundation, participants/files, work quotes, grouped requests.
-- No existing reports, calculations, links or statuses are rewritten.
begin;

create table if not exists public.action_case_customer_offer_drafts (
  action_case_id uuid primary key references public.action_cases(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  revision integer not null check (revision > 0),
  body jsonb not null,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.action_case_customer_offers (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  participant_id uuid not null references public.action_case_participants(id) on delete restrict,
  version integer not null,
  draft_revision integer not null,
  snapshot jsonb not null,
  files jsonb not null default '[]',
  status text not null default 'published' check (status in ('published','accepted','withdrawn','superseded')),
  published_at timestamptz not null default now(),
  published_by uuid not null references public.profiles(id),
  accepted_at timestamptz,
  accepted_by text,
  accepted_option_ids jsonb not null default '[]',
  accepted_total_ore bigint,
  email_payload jsonb not null,
  first_attempt_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  unique(action_case_id, version),
  unique(action_case_id, draft_revision)
);
create unique index if not exists action_case_customer_offer_one_accepted
  on public.action_case_customer_offers(action_case_id) where status = 'accepted';
create table if not exists public.action_case_customer_offer_challenges (
  id uuid primary key,
  offer_id uuid not null references public.action_case_customer_offers(id) on delete restrict,
  access_link_id uuid not null references public.action_case_access_links(id) on delete restrict,
  code_hash text not null,
  selection jsonb not null,
  signer_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempts integer not null default 0,
  used_at timestamptz
);
create index if not exists customer_offer_challenge_offer_created_idx on public.action_case_customer_offer_challenges(offer_id, created_at desc);

alter table public.action_case_customer_offer_drafts enable row level security;
alter table public.action_case_customer_offers enable row level security;
alter table public.action_case_customer_offer_challenges enable row level security;
revoke all on public.action_case_customer_offer_drafts, public.action_case_customer_offers, public.action_case_customer_offer_challenges from public, anon, authenticated;
grant all on public.action_case_customer_offer_drafts, public.action_case_customer_offers, public.action_case_customer_offer_challenges to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values('action-case-customer-offers','action-case-customer-offers',false,26214400)
on conflict(id) do update set public=false;

create or replace function public.guard_customer_offer_snapshot() returns trigger language plpgsql as $$
begin
  if (new.id,new.org_id,new.action_case_id,new.participant_id,new.version,new.draft_revision,new.snapshot,new.files,new.published_at,new.published_by,new.email_payload)
    is distinct from (old.id,old.org_id,old.action_case_id,old.participant_id,old.version,old.draft_revision,old.snapshot,old.files,old.published_at,old.published_by,old.email_payload)
    or (old.status <> 'published' and (new.status,new.accepted_at,new.accepted_by,new.accepted_option_ids,new.accepted_total_ore)
      is distinct from (old.status,old.accepted_at,old.accepted_by,old.accepted_option_ids,old.accepted_total_ore)) then
    raise exception 'CUSTOMER_OFFER_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists customer_offer_immutable on public.action_case_customer_offers;
create trigger customer_offer_immutable before update on public.action_case_customer_offers for each row execute function public.guard_customer_offer_snapshot();

create or replace function public.write_customer_offer(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  d public.action_case_customer_offer_drafts%rowtype;
  o public.action_case_customer_offers%rowtype;
  c public.action_cases%rowtype;
  recipient public.action_case_participants%rowtype;
  f jsonb; n integer; v_id uuid; v_lease uuid;
begin
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if p_operation in ('save','publish') then
    select * into d from public.action_case_customer_offer_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
    if p_operation='publish' then
      select * into o from public.action_case_customer_offers where action_case_id=p_case_id and draft_revision=(p_data->>'revision')::integer;
      if found then return jsonb_build_object('id',o.id); end if;
    end if;
    if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted') then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
    if coalesce(d.revision,0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    if p_operation='save' then
      if jsonb_typeof(p_data->'body') is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      insert into public.action_case_customer_offer_drafts(action_case_id,org_id,revision,body,updated_by)
      values(p_case_id,p_org_id,1,p_data->'body',p_user_id)
      on conflict(action_case_id) do update set revision=action_case_customer_offer_drafts.revision+1,body=excluded.body,updated_by=p_user_id,updated_at=clock_timestamp();
      return '{}'::jsonb;
    end if;
    if d.action_case_id is null or p_data->>'confirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    select * into recipient from public.action_case_participants where id=(p_data->>'participantId')::uuid and action_case_id=p_case_id and org_id=p_org_id and role='customer' for update;
    if not found or recipient.email is null or lower(btrim(recipient.email)) is distinct from p_data->>'email' then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    if jsonb_typeof(d.body->'baseAmountOre') is distinct from 'number' or (d.body->>'baseAmountOre')::bigint < 0
      or (d.body->>'validUntil')::date < (now() at time zone 'Europe/Stockholm')::date then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_data->'snapshot' is distinct from d.body || jsonb_build_object('projectTitle',c.title,'propertyAddress',c.property_address,'customerName',recipient.name,'customerEmail',lower(btrim(recipient.email)),'issuerName',p_data->>'issuerName','replyEmail',p_data->>'replyEmail') then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    v_id := (p_data->>'id')::uuid;
    if jsonb_array_length(p_data->'files') <> jsonb_array_length(d.body->'attachmentIds') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    for f in select value from jsonb_array_elements(p_data->'files') loop
      if not d.body->'attachmentIds' ? (f->>'id') or f->>'path' <> p_org_id::text||'/'||p_case_id::text||'/'||v_id::text||'/'||(f->>'id') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
      if not exists(select 1 from public.action_case_attachments a where a.id=(f->>'id')::uuid and a.org_id=p_org_id and a.action_case_id=p_case_id and a.file_path=f->>'sourcePath' and a.file_size_bytes=(f->>'fileSizeBytes')::bigint) then raise exception 'CUSTOMER_OFFER_FILES'; end if;
      if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=(f->>'id')::uuid)
        or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=(f->>'id')::uuid) then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    end loop;
    if p_data->'emailPayload'->>'to' is distinct from lower(btrim(recipient.email)) then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    select coalesce(max(version),0)+1 into n from public.action_case_customer_offers where action_case_id=p_case_id;
    update public.action_case_customer_offers set status='superseded' where action_case_id=p_case_id and status='published';
    insert into public.action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,snapshot,files,email_payload,published_by)
    values(v_id,p_org_id,p_case_id,recipient.id,n,d.revision,p_data->'snapshot',p_data->'files',p_data->'emailPayload',p_user_id);
    insert into public.action_case_access_links(org_id,action_case_id,participant_id,token_hash,expires_at,created_by)
    values(p_org_id,p_case_id,recipient.id,p_data->>'tokenHash',now()+interval '90 days',p_user_id);
    insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_offer_published','Offertversion '||n,p_user_id);
    return jsonb_build_object('id',v_id);
  end if;
  select * into o from public.action_case_customer_offers where id=(p_data->>'id')::uuid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if p_operation='withdraw' then
    if o.status <> 'published' then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
    update public.action_case_customer_offers set status='withdrawn' where id=o.id;
    insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by) values(p_org_id,p_case_id,'customer_offer_withdrawn','Offertversion '||o.version,p_user_id);
    return '{}'::jsonb;
  elsif p_operation='claim_send' then
    if o.sent_at is not null then return jsonb_build_object('sent',true); end if;
    if o.status <> 'published' then raise exception 'CUSTOMER_OFFER_CLOSED'; end if;
    if o.lease_until > now() then raise exception 'CUSTOMER_OFFER_BUSY'; end if;
    -- Resend's idempotency window is 24 hours. Do not blindly retry older ambiguous sends.
    if o.first_attempt_at < now()-interval '23 hours' then raise exception 'CUSTOMER_OFFER_SEND_UNKNOWN'; end if;
    v_lease := gen_random_uuid();
    update public.action_case_customer_offers set lease_id=v_lease,lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=o.id;
    return jsonb_build_object('leaseId',v_lease,'payload',o.email_payload);
  elsif p_operation='finish_send' then
    if o.lease_id is distinct from (p_data->>'leaseId')::uuid then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    update public.action_case_customer_offers set lease_until=null,lease_id=null,sent_at=case when p_data->>'success'='true' then coalesce(sent_at,now()) else sent_at end,provider_message_id=coalesce(provider_message_id,p_data->>'providerMessageId') where id=o.id;
    return '{}'::jsonb;
  end if;
  raise exception 'CUSTOMER_OFFER_INVALID';
end $$;

-- Only the server calls this RPC, after resolving the revocable portal link.
-- Invalid OTP attempts return data (not exceptions), so the attempt counter commits.
create or replace function public.respond_customer_offer(p_token_hash text,p_offer_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  l public.action_case_access_links%rowtype;
  o public.action_case_customer_offers%rowtype;
  ch public.action_case_customer_offer_challenges%rowtype;
  v_case uuid; v_total bigint; v_option jsonb; v_id text; v_selection jsonb;
begin
  select action_case_id into v_case from public.action_case_customer_offers where id=p_offer_id;
  -- Same lock order as publication: case, offer, then challenge.
  perform 1 from public.action_cases where id=v_case for update;
  select * into l from public.action_case_access_links where token_hash=p_token_hash and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'CUSTOMER_OFFER_CLOSED'; end if;
  select * into o from public.action_case_customer_offers where id=p_offer_id and action_case_id=l.action_case_id and org_id=l.org_id and participant_id=l.participant_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if not exists(select 1 from public.action_case_participants where id=l.participant_id and org_id=l.org_id and action_case_id=l.action_case_id and role='customer' and lower(btrim(email))=o.snapshot->>'customerEmail') then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
  if o.status='accepted' and p_operation='accept' and exists(select 1 from public.action_case_customer_offer_challenges where id=(p_data->>'challengeId')::uuid and offer_id=o.id and access_link_id=l.id and used_at is not null and code_hash=p_data->>'codeHash') then return jsonb_build_object('accepted',true); end if;
  if o.status <> 'published' or (o.snapshot->>'validUntil')::date < (now() at time zone 'Europe/Stockholm')::date then raise exception 'CUSTOMER_OFFER_CLOSED'; end if;
  if p_operation='challenge' then
    if exists(select 1 from public.action_case_customer_offer_challenges where offer_id=o.id and created_at>now()-interval '1 minute')
      or (select count(*) from public.action_case_customer_offer_challenges where offer_id=o.id and created_at>now()-interval '1 hour')>=5 then raise exception 'CUSTOMER_OFFER_RATE_LIMIT'; end if;
    v_selection := p_data->'selection';
    if jsonb_typeof(v_selection) is distinct from 'array' or jsonb_array_length(v_selection)>200
      or length(btrim(coalesce(p_data->>'signerName','')))<2 or length(p_data->>'signerName')>200
      or p_data->>'confirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(v_selection)) <> jsonb_array_length(v_selection) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    for v_id in select value from jsonb_array_elements_text(v_selection) loop
      if not exists(select 1 from jsonb_array_elements(o.snapshot->'items') i where i->>'id'=v_id and i->>'kind'='option' and jsonb_typeof(i->'amountOre')='number') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end loop;
    update public.action_case_customer_offer_challenges set expires_at=now() where offer_id=o.id and used_at is null;
    insert into public.action_case_customer_offer_challenges(id,offer_id,access_link_id,code_hash,selection,signer_name)
    values((p_data->>'challengeId')::uuid,o.id,l.id,p_data->>'codeHash',v_selection,btrim(p_data->>'signerName'));
    return jsonb_build_object('challengeId',p_data->>'challengeId');
  elsif p_operation='accept' then
    select * into ch from public.action_case_customer_offer_challenges where id=(p_data->>'challengeId')::uuid and offer_id=o.id and access_link_id=l.id for update;
    if not found or ch.expires_at<=now() or ch.attempts>=5 or ch.used_at is not null then return jsonb_build_object('error','CUSTOMER_OFFER_CODE_EXPIRED'); end if;
    update public.action_case_customer_offer_challenges set attempts=attempts+1 where id=ch.id;
    if ch.code_hash is distinct from p_data->>'codeHash' then return jsonb_build_object('error','CUSTOMER_OFFER_CODE_INVALID'); end if;
    v_total := (o.snapshot->>'baseAmountOre')::bigint;
    for v_option in select value from jsonb_array_elements(o.snapshot->'items') loop
      if ch.selection ? (v_option->>'id') then v_total := v_total+(v_option->>'amountOre')::bigint; end if;
    end loop;
    update public.action_case_customer_offers set status='accepted',accepted_at=now(),accepted_by=ch.signer_name,accepted_option_ids=ch.selection,accepted_total_ore=v_total where id=o.id;
    update public.action_case_customer_offer_challenges set used_at=now() where id=ch.id;
    insert into public.action_case_events(org_id,action_case_id,event_type,message)
    values(o.org_id,o.action_case_id,'customer_offer_accepted','Offertversion '||o.version||' godkänd med e-postkod.');
    return jsonb_build_object('accepted',true);
  end if;
  raise exception 'CUSTOMER_OFFER_INVALID';
end $$;

revoke all on function public.write_customer_offer(uuid,uuid,uuid,text,jsonb), public.respond_customer_offer(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_customer_offer(uuid,uuid,uuid,text,jsonb), public.respond_customer_offer(text,uuid,text,jsonb) to service_role;
commit;
