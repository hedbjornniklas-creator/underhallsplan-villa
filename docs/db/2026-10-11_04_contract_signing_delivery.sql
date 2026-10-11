-- Run after 2026-10-11_03. No draft, archive or customer publication is rewritten.
begin;
create table if not exists public.action_case_contract_signing_delivery (
  document_id uuid primary key references public.action_case_contract_signing_documents(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  participant_id uuid references public.action_case_participants(id) on delete restrict,
  shared_at timestamptz,
  shared_by uuid references public.profiles(id),
  withdrawn_at timestamptz,
  customer_pdf jsonb,
  signed_copy jsonb,
  signed_at timestamptz,
  signed_by uuid references public.profiles(id),
  check ((shared_at is null and participant_id is null and customer_pdf is null and shared_by is null)
    or (shared_at is not null and participant_id is not null and customer_pdf is not null and shared_by is not null)),
  check ((signed_copy is null and signed_at is null and signed_by is null)
    or (signed_copy is not null and signed_at is not null and signed_by is not null)),
  check (withdrawn_at is null or shared_at is not null)
);
alter table public.action_case_contract_signing_delivery enable row level security;
revoke all on public.action_case_contract_signing_delivery from public,anon,authenticated;
grant all on public.action_case_contract_signing_delivery to service_role;

create or replace function public.guard_contract_signing_delivery() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare s public.action_case_contract_signing_documents%rowtype;
begin
  if tg_op='DELETE' then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  select * into s from public.action_case_contract_signing_documents where id=new.document_id and org_id=new.org_id and action_case_id=new.action_case_id;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if tg_op='UPDATE' then
    if (new.document_id,new.org_id,new.action_case_id) is distinct from (old.document_id,old.org_id,old.action_case_id)
      or (old.shared_at is not null and (new.participant_id,new.shared_at,new.shared_by,new.customer_pdf) is distinct from (old.participant_id,old.shared_at,old.shared_by,old.customer_pdf))
      or (old.signed_copy is not null and (new.signed_copy,new.signed_at,new.signed_by) is distinct from (old.signed_copy,old.signed_at,old.signed_by))
      then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
  end if;
  if s.released_at is not null and (tg_op='INSERT' or new.signed_copy is distinct from old.signed_copy or new.withdrawn_at is null)
    then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if new.participant_id is not null and not exists(select 1 from public.action_case_participants where id=new.participant_id and org_id=new.org_id and action_case_id=new.action_case_id and role='customer')
    then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
  return new;
end $$;
drop trigger if exists contract_signing_delivery_guard on public.action_case_contract_signing_delivery;
create trigger contract_signing_delivery_guard before insert or update or delete on public.action_case_contract_signing_delivery for each row execute function public.guard_contract_signing_delivery();

create or replace function public.guard_contract_signing_method() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare method text;
begin
  if tg_table_name='action_case_customer_contract_drafts' then
    method:=new.body->>'signingMethod';
    if new.body ? 'signingMethod' and (jsonb_typeof(new.body->'signingMethod') is distinct from 'string' or method not in ('external','email_code'))
      then raise exception 'CUSTOMER_OFFER_SIGNING_METHOD'; end if;
    if tg_op='UPDATE' and old.body ? 'signingMethod' and not new.body ? 'signingMethod' then raise exception 'CUSTOMER_OFFER_SIGNING_METHOD'; end if;
  elsif tg_table_name='action_case_customer_offers' then
    if new.status in ('published','accepted') and new.snapshot->>'signingMethod'='external' then raise exception 'CUSTOMER_OFFER_SIGNING_METHOD'; end if;
  elsif tg_table_name='action_case_contract_signing_documents' then
    if tg_op='INSERT' and new.snapshot->>'signingMethod'='email_code' then raise exception 'CUSTOMER_OFFER_SIGNING_METHOD'; end if;
    if tg_op='UPDATE' and new.released_at is distinct from old.released_at and exists(select 1 from public.action_case_contract_signing_delivery where document_id=old.id and signed_copy is not null)
      then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  end if;
  return new;
end $$;
drop trigger if exists contract_signing_method on public.action_case_customer_contract_drafts;
create trigger contract_signing_method before insert or update on public.action_case_customer_contract_drafts for each row execute function public.guard_contract_signing_method();
drop trigger if exists contract_signing_method on public.action_case_customer_offers;
create trigger contract_signing_method before insert or update of status on public.action_case_customer_offers for each row execute function public.guard_contract_signing_method();
drop trigger if exists contract_signing_method on public.action_case_contract_signing_documents;
create trigger contract_signing_method before insert or update on public.action_case_contract_signing_documents for each row execute function public.guard_contract_signing_method();

create or replace function public.guard_contract_delivery_recipient() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  perform 1 from public.action_cases where id=old.action_case_id and org_id=old.org_id for update;
  if (tg_op='DELETE' or (new.org_id,new.action_case_id,new.role,new.name,new.email) is distinct from (old.org_id,old.action_case_id,old.role,old.name,old.email))
    and exists(select 1 from public.action_case_contract_signing_delivery where participant_id=old.id)
    then raise exception 'CUSTOMER_REGISTRY_HISTORY_LOCKED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists contract_delivery_recipient on public.action_case_participants;
create trigger contract_delivery_recipient before update or delete on public.action_case_participants for each row execute function public.guard_contract_delivery_recipient();

create or replace function public.write_contract_signing_delivery(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare s public.action_case_contract_signing_documents%rowtype; d public.action_case_contract_signing_delivery%rowtype;
  recipient public.action_case_participants%rowtype; f jsonb; prefix text;
begin
  perform 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active=true for share;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into s from public.action_case_contract_signing_documents where id=(p_data->>'id')::uuid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if p_data->>'confirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_CONFIRM'; end if;
  if s.draft_revision is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if p_operation not in ('share','withdraw','register_signed') or p_operation is null then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if s.released_at is not null and p_operation<>'withdraw' then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  select * into d from public.action_case_contract_signing_delivery where document_id=s.id for update;
  prefix:=p_org_id::text||'/'||p_case_id::text||'/signing/'||s.id::text||'/';
  if p_operation='withdraw' then
    if d.shared_at is null then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
    update public.action_case_contract_signing_delivery set withdrawn_at=coalesce(withdrawn_at,clock_timestamp()) where document_id=s.id;
    return jsonb_build_object('id',s.id);
  elsif p_operation='share' then
    select * into recipient from public.action_case_participants where id=(p_data->>'participantId')::uuid and org_id=p_org_id and action_case_id=p_case_id and role='customer' for share;
    if not found or coalesce(trim(recipient.name),'')='' or coalesce(recipient.email,'') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
      or recipient.name is distinct from p_data->>'recipientName' or lower(trim(recipient.email)) is distinct from p_data->>'recipientEmail'
      or (d.participant_id is not null and d.participant_id<>recipient.id) then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    f:=coalesce(d.customer_pdf,p_data->'customerPdf');
    if jsonb_typeof(f) is distinct from 'object' or coalesce(f->>'path','') !~ ('^'||prefix||'customer/[a-f0-9-]{36}\.pdf$')
      or coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce((f->>'fileSizeBytes')::bigint,0) not between 100 and 50000000
      or coalesce(p_data->>'tokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    insert into public.action_case_contract_signing_delivery(document_id,org_id,action_case_id,participant_id,shared_at,shared_by,customer_pdf)
      values(s.id,p_org_id,p_case_id,recipient.id,clock_timestamp(),p_user_id,f)
      on conflict(document_id) do update set participant_id=excluded.participant_id,
        shared_at=coalesce(action_case_contract_signing_delivery.shared_at,excluded.shared_at),shared_by=coalesce(action_case_contract_signing_delivery.shared_by,excluded.shared_by),
        customer_pdf=coalesce(action_case_contract_signing_delivery.customer_pdf,excluded.customer_pdf),withdrawn_at=null;
    insert into public.action_case_access_links(org_id,action_case_id,participant_id,token_hash,expires_at,created_by)
      values(p_org_id,p_case_id,recipient.id,p_data->>'tokenHash',clock_timestamp()+interval '90 days',p_user_id) on conflict(token_hash) do nothing;
    if not exists(select 1 from public.action_case_access_links where token_hash=p_data->>'tokenHash'
      and org_id=p_org_id and action_case_id=p_case_id and participant_id=recipient.id and revoked_at is null and expires_at>clock_timestamp())
      then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
  else
    f:=p_data->'signedCopy';
    if d.signed_copy is not null then
      if d.signed_copy->>'sha256' is distinct from f->>'sha256' then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
      return jsonb_build_object('id',s.id);
    end if;
    if jsonb_typeof(f) is distinct from 'object' or coalesce(f->>'path','') !~ ('^'||prefix||'signed/[a-f0-9-]{36}\.pdf$')
      or coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce((f->>'fileSizeBytes')::bigint,0) not between 100 and 20000000
      or coalesce(length(f->>'fileName'),0) not between 1 and 250 then raise exception 'CUSTOMER_OFFER_SIGNED_COPY'; end if;
    insert into public.action_case_contract_signing_delivery(document_id,org_id,action_case_id,signed_copy,signed_at,signed_by)
      values(s.id,p_org_id,p_case_id,f,clock_timestamp(),p_user_id)
      on conflict(document_id) do update set signed_copy=excluded.signed_copy,signed_at=excluded.signed_at,signed_by=excluded.signed_by;
  end if;
  return jsonb_build_object('id',s.id);
end $$;
revoke all on function public.write_contract_signing_delivery(uuid,uuid,uuid,text,jsonb),public.guard_contract_signing_delivery(),public.guard_contract_signing_method(),public.guard_contract_delivery_recipient() from public,anon,authenticated;
grant execute on function public.write_contract_signing_delivery(uuid,uuid,uuid,text,jsonb),public.guard_contract_signing_delivery(),public.guard_contract_signing_method(),public.guard_contract_delivery_recipient() to service_role;
notify pgrst,'reload schema';
commit;
