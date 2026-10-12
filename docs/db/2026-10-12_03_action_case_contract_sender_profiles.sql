-- Explicit sender selection for the independent Uppdrag contract draft only.
-- Requires sender profiles 2026-10-12_02 and contract delivery 2026-10-11_04.
-- No existing draft, publication, signing document, customer or organization is rewritten.
begin;
set local lock_timeout='10s';
do $$ begin
  if to_regclass('public.organization_sender_profiles') is null
    or to_regclass('public.action_case_customer_contract_drafts') is null
    or to_regclass('public.action_case_contract_signing_delivery') is null then raise exception 'CUSTOMER_SENDER_SCHEMA'; end if;
end $$;

create unique index if not exists action_cases_id_org_sender_idx on public.action_cases(id,org_id);
create unique index if not exists organization_sender_profiles_id_org_idx on public.organization_sender_profiles(id,org_id);
create table if not exists public.action_case_contract_senders (
  action_case_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  sender_profile_id uuid not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  selected_by uuid not null references public.profiles(id),
  selected_at timestamptz not null default now(),
  foreign key(action_case_id,org_id) references public.action_cases(id,org_id) on delete restrict,
  foreign key(sender_profile_id,org_id) references public.organization_sender_profiles(id,org_id) on delete restrict
);
create table if not exists public.action_case_contract_sender_requests (
  request_id uuid primary key,
  action_case_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id),
  request_values jsonb not null check(jsonb_typeof(request_values)='object'),
  draft_revision integer not null check(draft_revision>0),
  created_at timestamptz not null default now(),
  foreign key(action_case_id,org_id) references public.action_cases(id,org_id) on delete restrict
);
alter table public.action_case_contract_senders enable row level security;
alter table public.action_case_contract_sender_requests enable row level security;
revoke all on public.action_case_contract_senders,public.action_case_contract_sender_requests from public,anon,authenticated,service_role;
grant select on public.action_case_contract_senders,public.action_case_contract_sender_requests to service_role;

-- Matches the existing organization-scoped tasks guard, including its legacy
-- fallback only when no current dashboard grant or managed grant history exists.
create or replace function public.assert_contract_sender_actor(p_org_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
  -- Match organization administration's organization-before-membership order.
  perform 1 from public.organizations where id=p_org_id for share;
  if not found then raise exception 'CUSTOMER_SENDER_FORBIDDEN'; end if;
  select role into member_role from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active for share;
  if not found then raise exception 'CUSTOMER_SENDER_FORBIDDEN'; end if;
  if exists(select 1 from public.platform_access_assignments a join public.platform_products p on p.id=a.product_id
      where a.profile_id=p_user_id and p.key='dashboard' and a.is_active and (a.expires_at is null or a.expires_at>now())) then
    perform a.id from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      join public.platform_modules m on m.id=a.module_id and m.key='tasks' and m.product_id=p.id
      where a.profile_id=p_user_id and a.is_active and (a.expires_at is null or a.expires_at>now())
        and a.scope_type='organization' and a.scope_id=p_org_id::text for share of a;
    if not found then raise exception 'CUSTOMER_SENDER_FORBIDDEN'; end if;
  elsif exists(select 1 from public.platform_access_assignments a join public.platform_products p on p.id=a.product_id
      where a.profile_id=p_user_id and p.key='dashboard' and a.scope_type='organization'
        and a.source_system in ('organization_administration','organization_admin_migration')) then raise exception 'CUSTOMER_SENDER_FORBIDDEN';
  elsif member_role<>'admin' and not exists(select 1 from public.profiles where id=p_user_id and is_admin) then raise exception 'CUSTOMER_SENDER_FORBIDDEN';
  end if;
end $$;

create or replace function public.contract_sender_protected_fields(p_snapshot jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('companyName',p_snapshot->>'name','organizationNumber',p_snapshot->>'organizationNumber',
    'street',coalesce(p_snapshot->>'address',''),'postalCode',coalesce(p_snapshot->>'postalCode',''),'city',coalesce(p_snapshot->>'city',''),
    'email',coalesce(p_snapshot->>'email',''),'phone',coalesce(p_snapshot->>'phone',''));
$$;

create or replace function public.assert_action_case_contract_sender_body(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_body jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare frozen jsonb; field_name text;
begin
  perform public.assert_contract_sender_actor(p_org_id,p_user_id);
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select snapshot into frozen from public.action_case_contract_senders where action_case_id=p_case_id and org_id=p_org_id;
  if p_body->'senderProfile' is distinct from frozen then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is not null then
    for field_name in select jsonb_object_keys(public.contract_sender_protected_fields(frozen)) loop
      if p_body#>array['contractParties','contractor',field_name] is distinct from public.contract_sender_protected_fields(frozen)->field_name then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end loop;
  end if;
end $$;

create or replace function public.guard_contract_sender_draft()
returns trigger language plpgsql security definer set search_path='' as $$
declare frozen jsonb; field_name text;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.action_case_contract_senders where action_case_id=old.action_case_id) then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    return old;
  end if;
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select snapshot into frozen from public.action_case_contract_senders where action_case_id=new.action_case_id and org_id=new.org_id;
  if new.body->'senderProfile' is distinct from frozen then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is not null then
    for field_name in select jsonb_object_keys(public.contract_sender_protected_fields(frozen)) loop
      if new.body#>array['contractParties','contractor',field_name] is distinct from public.contract_sender_protected_fields(frozen)->field_name then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists contract_sender_draft_guard on public.action_case_customer_contract_drafts;
create trigger contract_sender_draft_guard before insert or update or delete on public.action_case_customer_contract_drafts
  for each row execute function public.guard_contract_sender_draft();

-- Only new publications are checked against the current draft. Existing sent,
-- accepted and signing snapshots keep their original identity on later status writes.
create or replace function public.guard_contract_sender_publication()
returns trigger language plpgsql security definer set search_path='' as $$
declare frozen jsonb; field_name text;
begin
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select snapshot into frozen from public.action_case_contract_senders where action_case_id=new.action_case_id and org_id=new.org_id;
  if new.snapshot->'senderProfile' is distinct from frozen then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is not null then
    if new.snapshot->>'issuerName' is distinct from frozen->>'name'
      or new.snapshot->>'replyEmail' is distinct from coalesce(frozen->>'email','') then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    for field_name in select jsonb_object_keys(public.contract_sender_protected_fields(frozen)) loop
      if new.snapshot#>array['contractParties','contractor',field_name] is distinct from public.contract_sender_protected_fields(frozen)->field_name then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end loop;
    if tg_table_name='action_case_customer_offers' then
      if new.email_payload->>'replyTo' is distinct from frozen->>'email' then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists contract_sender_publication_guard on public.action_case_customer_offers;
create trigger contract_sender_publication_guard before insert on public.action_case_customer_offers for each row execute function public.guard_contract_sender_publication();
drop trigger if exists contract_sender_publication_guard on public.action_case_contract_signing_documents;
create trigger contract_sender_publication_guard before insert on public.action_case_contract_signing_documents for each row execute function public.guard_contract_sender_publication();

create or replace function public.select_action_case_contract_sender(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_data jsonb,p_logo_data_url text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare d public.action_case_customer_contract_drafts%rowtype; sender public.organization_sender_profiles%rowtype;
  org public.organizations%rowtype; previous public.action_case_contract_sender_requests%rowtype;
  v_request_id uuid; profile_id uuid; requested_revision integer; profile_version bigint; legal_version bigint;
  frozen jsonb; next_body jsonb; buyers text;
begin
  perform public.assert_contract_sender_actor(p_org_id,p_user_id);
  if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>7
    or not p_data ?& array['requestId','revision','profileId','profileVersion','legalNameVersion','organizationNumber','confirmed']
    or p_data->'confirmed' is distinct from 'true'::jsonb then raise exception 'CUSTOMER_SENDER_INVALID'; end if;
  if jsonb_typeof(p_data->'requestId') is distinct from 'string' or jsonb_typeof(p_data->'profileId') is distinct from 'string'
    or jsonb_typeof(p_data->'revision') is distinct from 'number' or jsonb_typeof(p_data->'profileVersion') is distinct from 'number'
    or jsonb_typeof(p_data->'legalNameVersion') is distinct from 'number'
    or p_data->>'revision' !~ '^[1-9][0-9]*$' or p_data->>'profileVersion' !~ '^[1-9][0-9]*$'
    or p_data->>'legalNameVersion' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_data->'organizationNumber') is distinct from 'string' or p_data->>'organizationNumber' !~ '^[0-9]{6}-?[0-9]{4}$' then raise exception 'CUSTOMER_SENDER_INVALID'; end if;
  begin
    v_request_id:=(p_data->>'requestId')::uuid; profile_id:=(p_data->>'profileId')::uuid;
    requested_revision:=(p_data->>'revision')::integer; profile_version:=(p_data->>'profileVersion')::bigint; legal_version:=(p_data->>'legalNameVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CUSTOMER_SENDER_INVALID'; end;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into previous from public.action_case_contract_sender_requests where request_id=v_request_id;
  if found then
    if previous.action_case_id<>p_case_id or previous.org_id<>p_org_id or previous.actor_profile_id<>p_user_id or previous.request_values is distinct from p_data then raise exception 'CUSTOMER_SENDER_STALE'; end if;
    return jsonb_build_object('saved',true,'revision',previous.draft_revision);
  end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted') then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='published') then raise exception 'CUSTOMER_SENDER_WITHDRAW_FIRST'; end if;
  if exists(select 1 from public.action_case_contract_signing_documents where action_case_id=p_case_id and released_at is null) then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  select * into d from public.action_case_customer_contract_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  if not found or d.revision<>requested_revision then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if jsonb_typeof(d.body->'contractParties') is distinct from 'object' or jsonb_typeof(d.body#>'{contractParties,contractor}') is distinct from 'object' then raise exception 'CUSTOMER_SENDER_INVALID'; end if;
  select * into org from public.organizations where id=p_org_id for share;
  if org.legal_name is null or org.organization_number is null or not public.is_valid_swedish_organization_number(org.organization_number) then raise exception 'CUSTOMER_SENDER_IDENTITY_REQUIRED'; end if;
  select * into sender from public.organization_sender_profiles where id=profile_id and org_id=p_org_id for share;
  if not found or not sender.is_active then raise exception 'CUSTOMER_SENDER_PROFILE'; end if;
  if sender.version<>profile_version or org.legal_name_version<>legal_version or org.organization_number is distinct from p_data->>'organizationNumber' then raise exception 'CUSTOMER_SENDER_STALE'; end if;
  if sender.logo_path is null and p_logo_data_url is not null then raise exception 'CUSTOMER_SENDER_MEDIA'; end if;
  if sender.logo_path is not null and (p_logo_data_url is null or length(p_logo_data_url)>200000
    or p_logo_data_url !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$') then raise exception 'CUSTOMER_SENDER_MEDIA'; end if;
  frozen:=jsonb_build_object('version',1,'organizationId',p_org_id,'profileId',sender.id,'profileVersion',sender.version,
    'legalNameVersion',org.legal_name_version,'legalName',org.legal_name,'organizationNumber',org.organization_number,
    'name',sender.name,'address',sender.address,'postalCode',sender.postal_code,'city',sender.city,'email',sender.email,'phone',sender.phone,
    'website',sender.website,'logoPath',sender.logo_path,'logoDataUrl',p_logo_data_url,'reportFooterText',sender.report_footer_text);
  next_body:=jsonb_set(d.body,'{senderProfile}',frozen);
  next_body:=jsonb_set(next_body,'{contractParties,contractor}',(d.body#>'{contractParties,contractor}')||public.contract_sender_protected_fields(frozen));
  -- Match normalizeCustomerOffer/contractPartiesSummary byte-for-byte. Otherwise
  -- a later PDF/publication would normalize a different snapshot than raw SQL.
  if jsonb_typeof(next_body->'contractDetails')='object' then
    select coalesce(string_agg(btrim(buyer->>'name'),', ' order by ordinal) filter(where coalesce(btrim(buyer->>'name'),'')<>''),'') into buyers
      from jsonb_array_elements(next_body#>'{contractParties,customers}') with ordinality as customer(buyer,ordinal);
    next_body:=jsonb_set(next_body,'{contractDetails,fields,parties}',jsonb_build_object('status','specified','text','Beställare: '||buyers||'. Entreprenör: '||sender.name||'.'));
  end if;
  insert into public.action_case_contract_senders(action_case_id,org_id,sender_profile_id,snapshot,selected_by)
    values(p_case_id,p_org_id,sender.id,frozen,p_user_id)
    on conflict(action_case_id) do update set sender_profile_id=excluded.sender_profile_id,snapshot=excluded.snapshot,selected_by=excluded.selected_by,selected_at=now();
  update public.action_case_customer_contract_drafts set body=next_body,revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp()
    where action_case_id=p_case_id and org_id=p_org_id;
  insert into public.action_case_contract_sender_requests(request_id,action_case_id,org_id,actor_profile_id,request_values,draft_revision)
    values(v_request_id,p_case_id,p_org_id,p_user_id,p_data,d.revision+1);
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'contract_sender_selected','Avsändarprofil vald för avtalsutkastet',p_user_id);
  return jsonb_build_object('saved',true,'revision',d.revision+1);
end $$;

revoke all on function public.assert_contract_sender_actor(uuid,uuid),public.contract_sender_protected_fields(jsonb),
  public.assert_action_case_contract_sender_body(uuid,uuid,uuid,jsonb),public.guard_contract_sender_draft(),public.guard_contract_sender_publication(),public.select_action_case_contract_sender(uuid,uuid,uuid,jsonb,text)
from public,anon,authenticated,service_role;
grant execute on function public.select_action_case_contract_sender(uuid,uuid,uuid,jsonb,text),public.assert_action_case_contract_sender_body(uuid,uuid,uuid,jsonb) to service_role;
do $$ begin
  if has_function_privilege('anon','public.select_action_case_contract_sender(uuid,uuid,uuid,jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.select_action_case_contract_sender(uuid,uuid,uuid,jsonb,text)','EXECUTE')
    or has_function_privilege('anon','public.assert_action_case_contract_sender_body(uuid,uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.assert_action_case_contract_sender_body(uuid,uuid,uuid,jsonb)','EXECUTE')
    or has_table_privilege('anon','public.action_case_contract_senders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated','public.action_case_contract_senders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('anon','public.action_case_contract_sender_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated','public.action_case_contract_sender_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.action_case_contract_senders','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.action_case_contract_sender_requests','INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'CUSTOMER_SENDER_ACL_INVALID'; end if;
end $$;
notify pgrst,'reload schema';
commit;
