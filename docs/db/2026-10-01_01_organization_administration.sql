-- Organization administration, shared company identity and private member cards.
-- Prerequisites: platform access foundation, Fortnox foundation, SQL 07 profile cards.
-- Platform ACL prerequisite: 2026-08-20_00_platform_access_assignments_rls.sql.
-- Run once before deploying the organization administration application changes.
-- Additive: no organization IDs, existing report snapshots or media are rewritten.
begin;
set local lock_timeout = '10s';

-- Repeat the small existing ACL prerequisite so a fresh installation cannot
-- bypass organization role management by writing platform grants directly.
alter table public.platform_access_assignments enable row level security;
revoke all privileges on public.platform_access_assignments from public,anon,authenticated;
grant select,insert,update,delete on public.platform_access_assignments to service_role;

alter table public.organizations
  add column if not exists profile_address text,
  add column if not exists profile_postal_code text,
  add column if not exists profile_city text,
  add column if not exists profile_website text,
  add column if not exists profile_logo_path text,
  add column if not exists profile_report_footer_text text,
  add column if not exists profile_configured boolean not null default false,
  add column if not exists profile_version bigint not null default 1,
  add column if not exists profile_updated_by_profile_id uuid references public.profiles(id) on delete set null;

-- Import only unanimous active-member company data. Names/legal identity must
-- also agree with the canonical organization record. Resolve conflicts in UI.
with candidates as (
  select c.org_id, count(distinct jsonb_build_array(c.company_name, c.company_orgno,
    c.company_address, c.company_postal_code, c.company_city, c.logo_path, c.report_footer_text)) as variants,
    min(c.company_name) as name, min(c.company_orgno) as orgno,
    min(c.company_address) as address, min(c.company_postal_code) as postal,
    min(c.company_city) as city, min(c.logo_path) as logo, min(c.report_footer_text) as footer
  from public.profile_org_cards c join public.org_members m
    on m.org_id=c.org_id and m.profile_id=c.profile_id and m.is_active
  group by c.org_id
)
update public.organizations o set profile_address=c.address, profile_postal_code=c.postal,
  profile_city=c.city, profile_logo_path=c.logo, profile_report_footer_text=c.footer, profile_configured=true
from candidates c where o.id=c.org_id and c.variants=1 and c.name=o.name
  and c.orgno is not distinct from o.organization_number
  and not o.profile_configured and o.profile_version=1;

-- Company mutations and destructive membership operations now pass through
-- service-only functions, including for organization administrators.
revoke insert, update, delete on public.organizations from authenticated, anon;
revoke insert, delete on public.org_members from authenticated, anon;
revoke delete on public.profile_org_cards from authenticated, anon;

-- Frozen documents reference these immutable UUID paths. Legacy bucket
-- policies may allow owners to overwrite their own files, so guard writes
-- independently of those permissive policies. Public downloads are unchanged.
do $$ begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then
    raise exception 'ORG_STORAGE_RLS_REQUIRED';
  end if;
end; $$;
drop policy if exists organization_profile_media_insert_boundary on storage.objects;
create policy organization_profile_media_insert_boundary on storage.objects as restrictive for insert to public
  with check(bucket_id<>'property-media' or (name !~ '^organizations/' and name !~ '^profiles/[^/]+/organizations/'));
drop policy if exists organization_profile_media_update_boundary on storage.objects;
create policy organization_profile_media_update_boundary on storage.objects as restrictive for update to public
  using(bucket_id<>'property-media' or (name !~ '^organizations/' and name !~ '^profiles/[^/]+/organizations/'))
  with check(bucket_id<>'property-media' or (name !~ '^organizations/' and name !~ '^profiles/[^/]+/organizations/'));
drop policy if exists organization_profile_media_delete_boundary on storage.objects;
create policy organization_profile_media_delete_boundary on storage.objects as restrictive for delete to public
  using(bucket_id<>'property-media' or (name !~ '^organizations/' and name !~ '^profiles/[^/]+/organizations/'));

create or replace function public.organization_members_protect_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op <> 'UPDATE' then raise exception 'ORG_ADMIN_REQUIRED' using errcode='42501'; end if;
    if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.profile_id is distinct from old.profile_id
      or new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'ORG_ADMIN_REQUIRED' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists trg_organization_members_protect_write on public.org_members;
create trigger trg_organization_members_protect_write before insert or update or delete
  on public.org_members for each row execute function public.organization_members_protect_write();

create or replace function public.organization_member_cards_protect_write()
returns trigger language plpgsql set search_path='' as $$
declare o public.organizations%rowtype;
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.org_id is distinct from old.org_id
      or new.profile_id is distinct from old.profile_id) then raise exception 'ORG_INPUT_INVALID'; end if;
  if current_user in ('authenticated','anon') then
    if auth.uid() is distinct from new.profile_id or not exists(select 1 from public.org_members
      where org_id=new.org_id and profile_id=auth.uid() and is_active) then
      raise exception 'ORG_PERSONAL_PROFILE_REQUIRED' using errcode='42501';
    end if;
    if new.avatar_path is not null and (tg_op='INSERT' or new.avatar_path is distinct from old.avatar_path)
      and new.avatar_path !~ ('^profiles/'||new.profile_id::text||'/organizations/'||new.org_id::text||
        '/avatarPath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$') then
      raise exception 'ORG_INPUT_INVALID';
    end if;
    if new.signature_path is not null and (tg_op='INSERT' or new.signature_path is distinct from old.signature_path)
      and new.signature_path !~ ('^profiles/'||new.profile_id::text||'/organizations/'||new.org_id::text||
        '/signaturePath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$') then
      raise exception 'ORG_INPUT_INVALID';
    end if;
    if tg_op='UPDATE' then
      if row(new.company_name,new.company_orgno,new.company_address,new.company_postal_code,
        new.company_city,new.logo_path,new.report_footer_text) is distinct from
        row(old.company_name,old.company_orgno,old.company_address,old.company_postal_code,
        old.company_city,old.logo_path,old.report_footer_text) then
        raise exception 'ORG_COMPANY_FIELDS_MANAGED' using errcode='42501';
      end if;
    else
      select * into strict o from public.organizations where id=new.org_id;
      if row(new.company_name,new.company_orgno,new.company_address,new.company_postal_code,
        new.company_city,new.logo_path,new.report_footer_text) is distinct from
        row(o.name,o.organization_number,o.profile_address,o.profile_postal_code,
        o.profile_city,o.profile_logo_path,o.profile_report_footer_text) then
        raise exception 'ORG_COMPANY_FIELDS_MANAGED' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_organization_member_cards_protect_write on public.profile_org_cards;
create trigger trg_organization_member_cards_protect_write before insert or update
  on public.profile_org_cards for each row execute function public.organization_member_cards_protect_write();
drop policy if exists profile_org_cards_insert_own_or_admin on public.profile_org_cards;
create policy profile_org_cards_insert_own_or_admin on public.profile_org_cards for insert to authenticated
  with check(profile_id=auth.uid() and public.is_org_member(org_id));
drop policy if exists profile_org_cards_update_own_or_admin on public.profile_org_cards;
create policy profile_org_cards_update_own_or_admin on public.profile_org_cards for update to authenticated
  using(profile_id=auth.uid() and public.is_org_member(org_id))
  with check(profile_id=auth.uid() and public.is_org_member(org_id));

create table if not exists public.organization_enabled_modules (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null check(module_key='technical_investigations'),
  is_active boolean not null default true,
  primary key(org_id,module_key)
);
alter table public.organization_enabled_modules enable row level security;
revoke all on public.organization_enabled_modules from public, anon, authenticated;
grant select, insert, update, delete on public.organization_enabled_modules to service_role;

-- Only existing, valid TU access establishes an organization entitlement.
insert into public.organization_enabled_modules(org_id,module_key)
select distinct member.org_id,'technical_investigations'
from public.org_members member
join public.platform_access_assignments a on a.profile_id=member.profile_id
join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
join public.platform_modules m on m.id=a.module_id and m.product_id=p.id and m.key='technical_investigations' and m.is_active
join public.platform_roles r on r.id=a.role_id and r.product_id=p.id and r.is_active
where member.is_active and a.is_active and (a.expires_at is null or a.expires_at>now())
  and (a.scope_type='global' or (a.scope_type='organization' and a.scope_id=member.org_id::text))
on conflict do nothing;

-- Preserve global TU/admin grants as inactive audit records, and copy valid
-- grants to existing active memberships. No OB/EB/RenoApp or product-wide
-- grants are touched. An admin grant is meaningful only for an org admin.
do $$
declare a record; member record; copied integer:=0; retired integer:=0;
begin
  for a in select x.*,m.key as module_key from public.platform_access_assignments x
    join public.platform_products p on p.id=x.product_id and p.key='dashboard' and p.is_active
    join public.platform_modules m on m.id=x.module_id and m.product_id=p.id and m.is_active
    join public.platform_roles r on r.id=x.role_id and r.product_id=p.id and r.is_active
    where x.is_active and x.scope_type='global' and (x.expires_at is null or x.expires_at>now())
      and m.key in ('technical_investigations','admin')
  loop
    for member in select org_id from public.org_members where profile_id=a.profile_id and is_active
      and (a.module_key<>'admin' or role='admin')
    loop
      if not exists(select 1 from public.platform_access_assignments e where e.profile_id=a.profile_id
        and e.product_id=a.product_id and e.module_id=a.module_id and e.role_id=a.role_id
        and e.scope_type='organization' and e.scope_id=member.org_id::text) then
        insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,
          is_active,granted_by_profile_id,granted_reason,source_system,source_record_id,expires_at)
        values(a.profile_id,a.product_id,a.module_id,a.role_id,'organization',member.org_id::text,true,
          a.granted_by_profile_id,a.granted_reason,'organization_admin_migration',a.id::text,a.expires_at);
        copied:=copied+1;
      elsif exists(select 1 from public.platform_access_assignments e where e.profile_id=a.profile_id
        and e.product_id=a.product_id and e.module_id=a.module_id and e.role_id=a.role_id
        and e.scope_type='organization' and e.scope_id=member.org_id::text
        and (not e.is_active or (e.expires_at is not null and (a.expires_at is null or e.expires_at<a.expires_at)))) then
        raise exception 'ORG_MIGRATION_ACCESS_CONFLICT: existing organization grant conflicts with global grant';
      end if;
    end loop;
    update public.platform_access_assignments set is_active=false where id=a.id;
    retired:=retired+1;
  end loop;
  raise notice 'Organization administration: copied % scoped grants; retired % global TU/admin grants.',copied,retired;
end; $$;

-- Existing organization admins in TU-enabled organizations receive the exact
-- administration grant required by existing Fortnox access checks.
-- A previously revoked/expired exact grant needs an explicit access decision;
-- do not silently reactivate it or leave an administrator with broken access.
do $$ begin
  if exists(select 1 from public.org_members member
    join public.organization_enabled_modules enabled on enabled.org_id=member.org_id and enabled.is_active
    join public.platform_products p on p.key='dashboard' and p.is_active
    join public.platform_modules m on m.product_id=p.id and m.key='admin' and m.is_active
    join public.platform_roles r on r.product_id=p.id and r.key='dashboard_admin' and r.is_active
    join public.platform_access_assignments a on a.profile_id=member.profile_id and a.product_id=p.id
      and a.module_id=m.id and a.role_id=r.id and a.scope_type='organization' and a.scope_id=member.org_id::text
    where member.is_active and member.role='admin' and (not a.is_active or a.expires_at<=now())) then
    raise exception 'ORG_MIGRATION_ACCESS_CONFLICT: existing organization admin grant is revoked or expired';
  end if;
end; $$;
insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,
  is_active,granted_reason,source_system,source_record_id)
select member.profile_id,p.id,m.id,r.id,'organization',member.org_id::text,true,
  'Existing organization administrator','organization_admin_migration',member.org_id::text
from public.org_members member
join public.organization_enabled_modules enabled on enabled.org_id=member.org_id and enabled.is_active
join public.platform_products p on p.key='dashboard' and p.is_active
join public.platform_modules m on m.product_id=p.id and m.key='admin' and m.is_active
join public.platform_roles r on r.product_id=p.id and r.key='dashboard_admin' and r.is_active
where member.is_active and member.role='admin'
on conflict do nothing;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  org_id uuid not null references public.organizations(id) on delete restrict,
  email text not null check(char_length(email) between 3 and 254 and email=lower(btrim(email)) and email !~ '[[:space:]]'),
  full_name text not null check(char_length(btrim(full_name)) between 1 and 160),
  role text not null check(role in ('admin','inspector')),
  modules text[] not null check(cardinality(modules)<=1 and array_position(modules,null) is null and modules<@array['technical_investigations']::text[]),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','accepted','revoked')),
  revision bigint not null default 0 check(revision>=0),
  created_by_profile_id uuid not null references public.profiles(id),
  accepted_by_profile_id uuid references public.profiles(id),
  accepted_at timestamptz,
  notification_state text not null default 'pending' check(notification_state in ('pending','sending','accepted','failed')),
  created_at timestamptz not null default now()
);
create index if not exists organization_invitations_org_created_idx on public.organization_invitations(org_id,created_at desc);
create unique index if not exists organization_invitations_pending_email_idx on public.organization_invitations(org_id,email) where status='pending';
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;
grant select,insert,update,delete on public.organization_invitations to service_role;

create or replace function public.organization_assert_admin(p_actor uuid,p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists(select 1 from public.org_members where org_id=p_org
    and profile_id=p_actor and is_active and role='admin') then
    raise exception 'ORG_ADMIN_REQUIRED' using errcode='42501';
  end if;
end; $$;

create or replace function public.organization_validate_values(p_values jsonb,p_keys text[])
returns void language plpgsql set search_path='' as $$
begin
  if p_values is null or jsonb_typeof(p_values)<>'object' or exists(
    select 1 from jsonb_object_keys(p_values) k where not k=any(p_keys)) then
    raise exception 'ORG_INPUT_INVALID' using errcode='22023';
  end if;
end; $$;

create or replace function public.organization_text_value(p_values jsonb,p_key text,p_limit integer,p_required boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare value text;
begin
  if p_values ? p_key and jsonb_typeof(p_values->p_key) not in ('string','null') then raise exception 'ORG_INPUT_INVALID'; end if;
  value:=nullif(btrim(p_values->>p_key),'');
  if (p_required and value is null) or char_length(value)>p_limit or value ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
    raise exception 'ORG_INPUT_INVALID' using errcode='22023';
  end if;
  return value;
end; $$;

create or replace function public.organization_validate_modules(p_org uuid,p_modules jsonb)
returns text[] language plpgsql security definer set search_path='' as $$
declare result text[];
begin
  if p_modules is null or jsonb_typeof(p_modules)<>'array' then raise exception 'ORG_INPUT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(p_modules) v where jsonb_typeof(v)<>'string') then raise exception 'ORG_INPUT_INVALID'; end if;
  select coalesce(array_agg(value),array[]::text[]) into result from jsonb_array_elements_text(p_modules);
  if cardinality(result)>1 or not result<@array['technical_investigations']::text[] then raise exception 'ORG_MODULE_NOT_ENABLED'; end if;
  if exists(select 1 from unnest(result) k where not exists(select 1 from public.organization_enabled_modules e
    join public.platform_products p on p.key='dashboard' and p.is_active
    join public.platform_modules m on m.product_id=p.id and m.key=e.module_key and m.is_active
    where e.org_id=p_org and e.module_key=k and e.is_active)) then raise exception 'ORG_MODULE_NOT_ENABLED'; end if;
  return result;
end; $$;

create or replace function public.organization_profile_save(p_actor uuid,p_org uuid,p_expected_version bigint,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizations%rowtype; v_name text; v_number text; v_logo text; v_site text;
begin
  perform public.organization_assert_admin(p_actor,p_org);
  perform public.organization_validate_values(p_values,array['name','organizationNumber','address','postalCode','city','website','logoPath','reportFooterText']);
  select * into strict o from public.organizations where id=p_org;
  if p_expected_version is distinct from o.profile_version then raise exception 'ORG_CONFLICT'; end if;
  v_name:=public.organization_text_value(p_values,'name',240,true);
  v_number:=public.organization_text_value(p_values,'organizationNumber',11);
  if v_number is not null and not public.is_valid_swedish_organization_number(v_number) then raise exception 'ORG_INPUT_INVALID'; end if;
  if v_number is distinct from o.organization_number and exists(select 1 from public.fortnox_connections where org_id=p_org) then
    raise exception 'ORG_FORTNOX_IDENTITY_LOCKED';
  end if;
  v_logo:=public.organization_text_value(p_values,'logoPath',2048);
  if v_logo is not null and v_logo is distinct from o.profile_logo_path and v_logo !~
    ('^organizations/'||p_org::text||'/logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$') then raise exception 'ORG_INPUT_INVALID'; end if;
  v_site:=public.organization_text_value(p_values,'website',500);
  if v_site is not null and (v_site ~ '[[:space:]]' or v_site ~* '^(javascript|data|file):') then raise exception 'ORG_INPUT_INVALID'; end if;
  update public.organizations set name=v_name,organization_number=v_number,
    profile_address=public.organization_text_value(p_values,'address',300),
    profile_postal_code=public.organization_text_value(p_values,'postalCode',40),
    profile_city=public.organization_text_value(p_values,'city',160),profile_website=v_site,profile_logo_path=v_logo,
    profile_report_footer_text=public.organization_text_value(p_values,'reportFooterText',2000),
    profile_configured=true,profile_version=profile_version+1,profile_updated_by_profile_id=p_actor where id=p_org;
  return jsonb_build_object('saved',true);
end; $$;

create or replace function public.organization_member_profile_save(p_actor uuid,p_org uuid,p_expected_version bigint,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizations%rowtype; c public.profile_org_cards%rowtype; v_display text; v_email text; v_avatar text; v_signature text;
begin
  select * into o from public.organizations where id=p_org for update;
  if not found or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active) then raise exception 'ORG_MEMBER_REQUIRED'; end if;
  perform public.organization_validate_values(p_values,array['displayName','title','phone','email','avatarPath','signaturePath']);
  select * into c from public.profile_org_cards where org_id=p_org and profile_id=p_actor for update;
  if p_expected_version is distinct from coalesce(c.version,0) then raise exception 'ORG_CONFLICT'; end if;
  v_display:=public.organization_text_value(p_values,'displayName',200,true);
  v_email:=lower(public.organization_text_value(p_values,'email',320));
  if v_email is not null and (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'ORG_INPUT_INVALID'; end if;
  v_avatar:=public.organization_text_value(p_values,'avatarPath',2048);
  v_signature:=public.organization_text_value(p_values,'signaturePath',2048);
  if v_avatar is not null and v_avatar is distinct from c.avatar_path and v_avatar !~
    ('^profiles/'||p_actor::text||'/organizations/'||p_org::text||'/avatarPath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$') then raise exception 'ORG_INPUT_INVALID'; end if;
  if v_signature is not null and v_signature is distinct from c.signature_path and v_signature !~
    ('^profiles/'||p_actor::text||'/organizations/'||p_org::text||'/signaturePath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$') then raise exception 'ORG_INPUT_INVALID'; end if;
  insert into public.profile_org_cards(org_id,profile_id,display_name,title,phone,email,avatar_path,signature_path,
    company_name,company_orgno,company_address,company_postal_code,company_city,logo_path,report_footer_text,
    created_by_profile_id,updated_by_profile_id)
  values(p_org,p_actor,v_display,public.organization_text_value(p_values,'title',160),public.organization_text_value(p_values,'phone',80),
    v_email,v_avatar,v_signature,o.name,o.organization_number,o.profile_address,o.profile_postal_code,o.profile_city,
    o.profile_logo_path,o.profile_report_footer_text,p_actor,p_actor)
  on conflict(org_id,profile_id) do update set display_name=excluded.display_name,title=excluded.title,phone=excluded.phone,
    email=excluded.email,avatar_path=excluded.avatar_path,signature_path=excluded.signature_path,updated_by_profile_id=p_actor;
  return jsonb_build_object('saved',true);
end; $$;

-- Internal grant writer: every write is scoped to one organization. Callers
-- hold its organization lock and have validated membership and entitlement.
create or replace function public.organization_apply_member_grants(p_actor uuid,p_org uuid,p_profile uuid,p_role text,p_active boolean,p_modules text[])
returns void language plpgsql security definer set search_path='' as $$
declare product uuid; inspector uuid; administrator uuid; tu_module uuid; mod record; chosen_role uuid;
begin
  select id into product from public.platform_products where key='dashboard' and is_active;
  select id into inspector from public.platform_roles where product_id=product and key='inspector' and is_active;
  select id into administrator from public.platform_roles where product_id=product and key='dashboard_admin' and is_active;
  select id into tu_module from public.platform_modules where product_id=product and key='technical_investigations';
  if product is null or inspector is null or administrator is null or tu_module is null or not exists(select 1 from public.platform_modules
    where product_id=product and key='admin' and is_active) then raise exception 'ORG_CATALOG_REQUIRED'; end if;
  update public.platform_access_assignments a set is_active=false
  where a.profile_id=p_profile and a.product_id=product and a.scope_type='organization' and a.scope_id=p_org::text
    and (not p_active or a.module_id in (select id from public.platform_modules where product_id=product and key in ('technical_investigations','admin')));
  -- An explicit empty selection must remain distinguishable from untouched
  -- legacy membership after its last grant is revoked. This inactive scoped
  -- marker prevents the application from restoring legacy module defaults.
  update public.platform_access_assignments set is_active=false,granted_by_profile_id=p_actor,
    granted_reason='Organization membership administration',source_system='organization_administration',source_record_id=p_org::text
  where profile_id=p_profile and product_id=product and module_id=tu_module and role_id=inspector
    and scope_type='organization' and scope_id=p_org::text;
  if not found then
    insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,
      granted_by_profile_id,granted_reason,source_system,source_record_id)
    values(p_profile,product,tu_module,inspector,'organization',p_org::text,false,p_actor,
      'Organization membership administration','organization_administration',p_org::text);
  end if;
  if not p_active then return; end if;
  for mod in select id,key from public.platform_modules where product_id=product and is_active
    and (key=any(p_modules) or (key='admin' and p_role='admin'))
  loop
    chosen_role:=case when mod.key='admin' then administrator else inspector end;
    update public.platform_access_assignments set is_active=true,expires_at=null,granted_by_profile_id=p_actor,
      granted_reason='Organization membership administration',source_system='organization_administration',source_record_id=p_org::text
    where profile_id=p_profile and product_id=product and module_id=mod.id and role_id=chosen_role
      and scope_type='organization' and scope_id=p_org::text;
    if not found then
      insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,
        granted_by_profile_id,granted_reason,source_system,source_record_id)
      values(p_profile,product,mod.id,chosen_role,'organization',p_org::text,true,p_actor,
        'Organization membership administration','organization_administration',p_org::text);
    end if;
  end loop;
end; $$;

create or replace function public.organization_invitation_create(p_actor uuid,p_org uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.organization_invitations%rowtype; v_request uuid; v_email text; v_name text; v_role text; v_hash text; v_expiry timestamptz; v_modules text[];
begin
  perform public.organization_assert_admin(p_actor,p_org);
  perform public.organization_validate_values(p_values,array['requestId','email','fullName','role','modules','tokenHash','expiresAt']);
  begin
    v_request:=public.organization_text_value(p_values,'requestId',36,true)::uuid;
    v_expiry:=public.organization_text_value(p_values,'expiresAt',60,true)::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'ORG_INPUT_INVALID'; end;
  v_email:=lower(public.organization_text_value(p_values,'email',254,true));
  v_name:=public.organization_text_value(p_values,'fullName',160,true);
  v_role:=public.organization_text_value(p_values,'role',20,true);
  v_hash:=public.organization_text_value(p_values,'tokenHash',64,true);
  v_modules:=public.organization_validate_modules(p_org,p_values->'modules');
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v_role not in ('admin','inspector')
    or (v_role='inspector' and cardinality(v_modules)=0)
    or v_hash !~ '^[a-f0-9]{64}$' or v_expiry<=now() or v_expiry>now()+interval '30 days' then raise exception 'ORG_INPUT_INVALID'; end if;
  select * into invitation from public.organization_invitations where request_id=v_request;
  if found then
    if invitation.org_id<>p_org or invitation.created_by_profile_id<>p_actor or invitation.email<>v_email
      or invitation.full_name<>v_name or invitation.role<>v_role or invitation.modules<>v_modules then raise exception 'ORG_CONFLICT'; end if;
    return to_jsonb(invitation);
  end if;
  if exists(select 1 from public.org_members m join auth.users u on u.id=m.profile_id where m.org_id=p_org and lower(u.email)=v_email)
    then raise exception 'ORG_MEMBER_EXISTS'; end if;
  if exists(select 1 from public.organization_invitations where org_id=p_org and email=v_email and status='pending')
    then raise exception 'ORG_CONFLICT'; end if;
  insert into public.organization_invitations(request_id,org_id,email,full_name,role,modules,token_hash,expires_at,created_by_profile_id)
    values(v_request,p_org,v_email,v_name,v_role,v_modules,v_hash,v_expiry,p_actor) returning * into invitation;
  return to_jsonb(invitation);
exception when unique_violation then raise exception 'ORG_CONFLICT';
end; $$;

create or replace function public.organization_invitation_change(p_actor uuid,p_org uuid,p_id uuid,p_revision bigint,p_action text,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.organization_invitations%rowtype;
begin
  perform public.organization_assert_admin(p_actor,p_org);
  select * into invitation from public.organization_invitations where id=p_id and org_id=p_org for update;
  if not found then raise exception 'ORG_INVITE_INVALID'; end if;
  if invitation.revision is distinct from p_revision or invitation.status<>'pending' then raise exception 'ORG_CONFLICT'; end if;
  if p_action='revoke' then
    update public.organization_invitations set status='revoked',revision=revision+1 where id=p_id returning * into invitation;
  elsif p_action='resend' then
    if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_token_hash=invitation.token_hash
      or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '30 days' then raise exception 'ORG_INPUT_INVALID'; end if;
    perform public.organization_validate_modules(p_org,to_jsonb(invitation.modules));
    update public.organization_invitations set token_hash=p_token_hash,expires_at=p_expires_at,notification_state='pending',revision=revision+1
      where id=p_id returning * into invitation;
  else raise exception 'ORG_INPUT_INVALID'; end if;
  return to_jsonb(invitation);
exception when unique_violation then raise exception 'ORG_CONFLICT';
end; $$;

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
  -- An invitation cannot outlive the authority of its inviter.
  if not exists(select 1 from public.org_members where org_id=v_org and profile_id=invitation.created_by_profile_id and role='admin' and is_active)
    then raise exception 'ORG_INVITE_INVALID'; end if;
  v_modules:=public.organization_validate_modules(v_org,to_jsonb(invitation.modules));
  if exists(select 1 from public.org_members where org_id=v_org and profile_id=p_actor) then raise exception 'ORG_MEMBER_EXISTS'; end if;
  insert into public.profiles(id,email,full_name,is_admin) values(p_actor,invitation.email,invitation.full_name,false) on conflict(id) do nothing;
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,p_actor,invitation.role,true,not exists(select 1 from public.org_members where profile_id=p_actor and is_default));
  perform public.organization_apply_member_grants(invitation.created_by_profile_id,v_org,p_actor,invitation.role,true,v_modules);
  update public.organization_invitations set status='accepted',accepted_by_profile_id=p_actor,accepted_at=now(),revision=revision+1 where id=invitation.id;
  return jsonb_build_object('accepted',true,'reused',false,'organizationId',v_org,'profileId',p_actor);
end; $$;

create or replace function public.organization_member_update(p_actor uuid,p_org uuid,p_profile uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.org_members%rowtype; v_role text; v_active boolean; v_modules text[];
begin
  perform public.organization_assert_admin(p_actor,p_org);
  perform public.organization_validate_values(p_values,array['role','isActive','modules']);
  v_role:=public.organization_text_value(p_values,'role',20,true);
  if v_role not in ('admin','inspector') or jsonb_typeof(p_values->'isActive') is distinct from 'boolean' then raise exception 'ORG_INPUT_INVALID'; end if;
  v_active:=(p_values->>'isActive')::boolean;
  v_modules:=public.organization_validate_modules(p_org,p_values->'modules');
  select * into member from public.org_members where org_id=p_org and profile_id=p_profile for update;
  if not found then raise exception 'ORG_MEMBER_REQUIRED'; end if;
  if member.is_active and member.role='admin' and (not v_active or v_role<>'admin') and not exists(
    select 1 from public.org_members where org_id=p_org and is_active and role='admin' and profile_id<>p_profile) then
    raise exception 'ORG_LAST_ADMIN';
  end if;
  update public.org_members set role=v_role,is_active=v_active where org_id=p_org and profile_id=p_profile;
  perform public.organization_apply_member_grants(p_actor,p_org,p_profile,v_role,v_active,v_modules);
  return jsonb_build_object('saved',true);
end; $$;

revoke all on function public.organization_members_protect_write(),public.organization_member_cards_protect_write(),
  public.organization_assert_admin(uuid,uuid),public.organization_validate_values(jsonb,text[]),
  public.organization_text_value(jsonb,text,integer,boolean),public.organization_validate_modules(uuid,jsonb),
  public.organization_apply_member_grants(uuid,uuid,uuid,text,boolean,text[])
  from public,anon,authenticated,service_role;
revoke all on function public.organization_profile_save(uuid,uuid,bigint,jsonb),
  public.organization_member_profile_save(uuid,uuid,bigint,jsonb),public.organization_invitation_create(uuid,uuid,jsonb),
  public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz),
  public.organization_invitation_accept(uuid,text),public.organization_member_update(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.organization_profile_save(uuid,uuid,bigint,jsonb),
  public.organization_member_profile_save(uuid,uuid,bigint,jsonb),public.organization_invitation_create(uuid,uuid,jsonb),
  public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz),
  public.organization_invitation_accept(uuid,text),public.organization_member_update(uuid,uuid,uuid,jsonb)
  to service_role;
commit;
