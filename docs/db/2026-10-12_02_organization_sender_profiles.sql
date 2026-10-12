-- Sender-profile foundation only. Requires organization administration 2026-10-01_01.
-- Additive and rerunnable: no guessed legal names, profile seeds, name/number changes,
-- membership changes or document bindings. Existing document resolvers are unchanged.
-- p_actor must come from authenticated server Auth, never a browser request field.
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.organization_assert_admin(uuid,uuid)') is null
    or to_regprocedure('public.organization_text_value(jsonb,text,integer,boolean)') is null
    or to_regclass('storage.objects') is null then raise exception 'ORG_SENDER_PREREQUISITES_REQUIRED'; end if;
end $$;

alter table public.organizations
  add column if not exists legal_name text,
  add column if not exists legal_name_version bigint not null default 0;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.organizations'::regclass and conname='organizations_legal_name_check') then
    alter table public.organizations add constraint organizations_legal_name_check
      check((legal_name is null or (length(btrim(legal_name)) between 1 and 240 and legal_name !~ '[\x00-\x1F\x7F]')) and legal_name_version>=0);
  end if;
end $$;

create table if not exists public.organization_sender_profiles (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 240),
  address text, postal_code text, city text, email text, phone text, website text,
  logo_path text, report_footer_text text,
  is_active boolean not null default true,
  version bigint not null default 1 check(version>=1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict
);
create unique index if not exists organization_sender_profiles_name_idx on public.organization_sender_profiles(org_id,lower(btrim(name)));
create index if not exists organization_sender_profiles_org_idx on public.organization_sender_profiles(org_id,created_at,id);
alter table public.organization_sender_profiles enable row level security;
revoke all on public.organization_sender_profiles from public,anon,authenticated,service_role;
grant select on public.organization_sender_profiles to authenticated,service_role;
drop policy if exists organization_sender_profiles_member_read on public.organization_sender_profiles;
create policy organization_sender_profiles_member_read on public.organization_sender_profiles for select to authenticated
  using(public.is_org_member(org_id));

-- Identifier-only audit. No names, contact details, snapshots or secrets are copied.
create table if not exists public.organization_sender_profile_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  sender_profile_id uuid references public.organization_sender_profiles(id) on delete restrict,
  action text not null check(action in ('legal_name_updated','sender_profile_created','sender_profile_updated','sender_profile_archived','sender_profile_restored')),
  version bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_sender_profile_audit_org_idx on public.organization_sender_profile_audit(org_id,created_at);
alter table public.organization_sender_profile_audit enable row level security;
revoke all on public.organization_sender_profile_audit from public,anon,authenticated,service_role;
grant select on public.organization_sender_profile_audit to service_role;

create or replace function public.organization_sender_assert_admin(p_actor uuid,p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- Use the existing organization lock order, then lock the authorizing membership.
  -- A concurrent membership revocation must finish before it can authorize a write.
  perform public.organization_assert_admin(p_actor,p_org);
  perform 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active and role='admin' for update;
  if not found then raise exception 'ORG_ADMIN_REQUIRED' using errcode='42501'; end if;
end $$;

create or replace function public.organization_legal_name_save(p_actor uuid,p_org uuid,p_expected_version bigint,p_legal_name text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare current_name text; current_version bigint; v_name text;
begin
  perform public.organization_sender_assert_admin(p_actor,p_org);
  v_name:=nullif(btrim(p_legal_name),'');
  if v_name is null or length(p_legal_name)>240 or p_legal_name ~ '[\x00-\x1F\x7F]' then raise exception 'ORG_INPUT_INVALID'; end if;
  select legal_name,legal_name_version into current_name,current_version from public.organizations where id=p_org;
  if p_expected_version is distinct from current_version then raise exception 'ORG_CONFLICT'; end if;
  if v_name is not distinct from current_name then return jsonb_build_object('saved',true); end if;
  update public.organizations set legal_name=v_name,legal_name_version=legal_name_version+1 where id=p_org;
  insert into public.organization_sender_profile_audit(org_id,actor_profile_id,action,version)
    values(p_org,p_actor,'legal_name_updated',current_version+1);
  return jsonb_build_object('saved',true);
end $$;

create or replace function public.organization_sender_profile_save(p_actor uuid,p_org uuid,p_id uuid,p_expected_version bigint,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare current_profile public.organization_sender_profiles%rowtype; v_found boolean;
  v_name text; v_address text; v_postal text; v_city text; v_email text; v_phone text; v_site text; v_logo text; v_footer text; v_active boolean;
  v_values jsonb; v_current jsonb; v_action text; v_key text;
begin
  perform public.organization_sender_assert_admin(p_actor,p_org);
  if p_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'ORG_INPUT_INVALID'; end if;
  perform public.organization_validate_values(p_values,array['name','address','postalCode','city','email','phone','website','logoPath','reportFooterText','isActive']);
  if (select count(*) from jsonb_object_keys(p_values))<>10 or jsonb_typeof(p_values->'isActive') is distinct from 'boolean' then raise exception 'ORG_INPUT_INVALID'; end if;
  -- Single-line fields cannot smuggle header controls or line breaks. Footer allows
  -- line breaks, but follows the shared bounded-text validator for other controls.
  foreach v_key in array array['name','address','postalCode','city','email','phone','website','logoPath'] loop
    if p_values->>v_key ~ '[\x00-\x1F\x7F]' then raise exception 'ORG_INPUT_INVALID'; end if;
  end loop;
  if p_values->>'reportFooterText' ~ '[\x7F]' then raise exception 'ORG_INPUT_INVALID'; end if;
  v_name:=public.organization_text_value(p_values,'name',240,true);
  v_address:=public.organization_text_value(p_values,'address',300);
  v_postal:=public.organization_text_value(p_values,'postalCode',40);
  v_city:=public.organization_text_value(p_values,'city',160);
  v_email:=lower(public.organization_text_value(p_values,'email',320));
  v_phone:=public.organization_text_value(p_values,'phone',80);
  v_site:=public.organization_text_value(p_values,'website',500);
  v_logo:=public.organization_text_value(p_values,'logoPath',2048);
  v_footer:=public.organization_text_value(p_values,'reportFooterText',2000);
  v_active:=(p_values->>'isActive')::boolean;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'ORG_INPUT_INVALID'; end if;
  if v_site is not null and (v_site !~* '^https?://[^/@[:space:]]+\.[^/@[:space:]]+([/:?#][^[:space:]]*)?$' or v_site ~ '[\\]') then raise exception 'ORG_INPUT_INVALID'; end if;
  if v_logo is not null and (v_logo !~ ('^organizations/'||p_org::text||'/logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$')
      or not exists(select 1 from storage.objects where bucket_id='property-media' and name=v_logo)) then raise exception 'ORG_SENDER_MEDIA_INVALID'; end if;

  select * into current_profile from public.organization_sender_profiles where id=p_id for update;
  v_found:=found;
  -- Never disclose or claim a profile belonging to another organization.
  if v_found and current_profile.org_id<>p_org then raise exception 'ORG_CONFLICT'; end if;
  v_values:=jsonb_build_array(v_name,v_address,v_postal,v_city,v_email,v_phone,v_site,v_logo,v_footer,v_active);
  if v_found then
    v_current:=jsonb_build_array(current_profile.name,current_profile.address,current_profile.postal_code,current_profile.city,
      current_profile.email,current_profile.phone,current_profile.website,current_profile.logo_path,current_profile.report_footer_text,current_profile.is_active);
    -- Creation retry only. No historical payload can overwrite a later edit/archive.
    if p_expected_version=0 and current_profile.version=1 and v_values=v_current then return jsonb_build_object('saved',true); end if;
    if p_expected_version is distinct from current_profile.version then raise exception 'ORG_CONFLICT'; end if;
    if v_values=v_current then return jsonb_build_object('saved',true); end if;
  elsif p_expected_version<>0 or not v_active then raise exception 'ORG_CONFLICT';
  elsif (select count(*) from public.organization_sender_profiles where org_id=p_org)>=20 then raise exception 'ORG_SENDER_LIMIT';
  end if;
  if exists(select 1 from public.organization_sender_profiles where org_id=p_org and id<>p_id and lower(btrim(name))=lower(v_name)) then raise exception 'ORG_SENDER_NAME_EXISTS'; end if;
  if not v_found then
    insert into public.organization_sender_profiles(id,org_id,name,address,postal_code,city,email,phone,website,logo_path,report_footer_text,is_active,updated_by_profile_id)
      values(p_id,p_org,v_name,v_address,v_postal,v_city,v_email,v_phone,v_site,v_logo,v_footer,v_active,p_actor);
    v_action:='sender_profile_created';
  else
    update public.organization_sender_profiles set name=v_name,address=v_address,postal_code=v_postal,city=v_city,email=v_email,phone=v_phone,
      website=v_site,logo_path=v_logo,report_footer_text=v_footer,is_active=v_active,version=version+1,updated_at=now(),updated_by_profile_id=p_actor where id=p_id;
    v_action:=case when current_profile.is_active and not v_active then 'sender_profile_archived'
      when not current_profile.is_active and v_active then 'sender_profile_restored' else 'sender_profile_updated' end;
  end if;
  insert into public.organization_sender_profile_audit(org_id,actor_profile_id,sender_profile_id,action,version)
    values(p_org,p_actor,p_id,v_action,case when v_found then current_profile.version+1 else 1 end);
  return jsonb_build_object('saved',true);
end $$;

revoke all on function public.organization_sender_assert_admin(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.organization_legal_name_save(uuid,uuid,bigint,text),public.organization_sender_profile_save(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.organization_legal_name_save(uuid,uuid,bigint,text),public.organization_sender_profile_save(uuid,uuid,uuid,bigint,jsonb) to service_role;
do $$ begin
  if has_function_privilege('anon','public.organization_legal_name_save(uuid,uuid,bigint,text)','EXECUTE')
    or has_function_privilege('authenticated','public.organization_legal_name_save(uuid,uuid,bigint,text)','EXECUTE')
    or has_function_privilege('anon','public.organization_sender_profile_save(uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.organization_sender_profile_save(uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','public.organization_sender_profiles','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('anon','public.organization_sender_profiles','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated','public.organization_sender_profile_audit','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('anon','public.organization_sender_profile_audit','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'ORG_SENDER_ACL_INVALID'; end if;
end $$;
commit;
