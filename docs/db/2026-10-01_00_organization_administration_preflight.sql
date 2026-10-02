-- READ ONLY: run in the target Supabase SQL editor before SQL 01.
-- This report changes no data and grants no access.
-- Deployment sequence:
-- 1. Review results and the target project; take a normal database backup.
-- 2. Confirm exact BBSAB organization ID and your existing active admin role.
--    A matching company name/number never establishes membership.
-- 3. Resolve grant conflicts deliberately; do not delete/re-enable rows blindly.
-- 4. In a maintenance window run 2026-10-01_01_organization_administration.sql,
--    then deploy the reviewed application branch. Do not publish a mixed version.
-- 5. Verify /settings/organisation?orgId=<verified UUID>, save company data,
--    then save your card at /settings/profil?orgId=<same UUID>.
-- 6. With approval invite a test colleague to TU. Confirm they can edit their
--    personal card but not company, Fortnox or roles. Verify a test document.
--
-- Current rollout: organization administration and TU document identity.
-- OB/EB retain /ob/settings until separately migrated/tested. RenoApp unchanged.
-- No organization is created or merged here. Historical snapshots stay intact.
-- Existing APP_BASE_URL, ASSIGNMENTS_MAIL_FROM and RESEND_API_KEY send emails.
-- Review project-specific Supabase Auth hooks/triggers on auth.users/profiles
-- before live invitations: none are versioned here. They must not auto-grant
-- other organizations or global modules. Never log secrets or invitation links.
-- Local tests send no real email and do not mutate Fortnox or production data.

-- A: prerequisites. Missing tables or disabled storage RLS must be resolved.
select table_schema,table_name from information_schema.tables
where (table_schema='public' and table_name in
  ('organizations','org_members','profiles','profile_org_cards','platform_products',
   'platform_modules','platform_roles','platform_access_assignments','fortnox_connections'))
  or (table_schema='storage' and table_name='objects')
order by table_schema,table_name;

select n.nspname as schema_name,c.relname,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='storage' and c.relname='objects')
   or (n.nspname='public' and c.relname='platform_access_assignments');

-- B: exact identity/membership including inactive ones; no auto-promotion.
select o.id as organization_id,o.name,o.organization_number,m.profile_id,
  p.full_name,m.role,m.is_active,m.is_default
from public.organizations o
left join public.org_members m on m.org_id=o.id
left join public.profiles p on p.id=m.profile_id
order by o.name,m.is_active desc,m.role,m.profile_id;

select o.id as organization_id,o.name as organization_without_active_admin
from public.organizations o where not exists (
  select 1 from public.org_members m where m.org_id=o.id and m.is_active and m.role='admin'
);

-- C: copy only unanimous active-member company data matching canonical identity.
-- Otherwise an administrator confirms the profile in the new UI.
select o.id as organization_id,o.name,o.organization_number,
  count(c.id) as active_member_cards,
  count(distinct jsonb_build_array(c.company_name,c.company_orgno,c.company_address,
    c.company_postal_code,c.company_city,c.logo_path,c.report_footer_text))
    filter(where c.id is not null) as company_variants,
  bool_and(c.company_name=o.name and c.company_orgno is not distinct from o.organization_number)
    filter(where c.id is not null) as matches_organization_identity
from public.organizations o
left join public.org_members m on m.org_id=o.id and m.is_active
left join public.profile_org_cards c on c.org_id=m.org_id and c.profile_id=m.profile_id
group by o.id,o.name,o.organization_number order by o.name;

-- D: global dashboard TU/admin grants SQL 01 retires (not deletes), copying
-- valid grants only to existing active memberships, with expiration retained.
-- Admin copies require existing admin role. hushub_admin and other modules stay.
select a.id as grant_id,a.profile_id,m.key as module_key,r.key as role_key,a.expires_at,
  array_agg(member.org_id) filter(where member.org_id is not null) as destination_organizations
from public.platform_access_assignments a
join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
join public.platform_modules m on m.id=a.module_id and m.is_active and m.key in ('technical_investigations','admin')
join public.platform_roles r on r.id=a.role_id and r.is_active
left join public.org_members member on member.profile_id=a.profile_id and member.is_active
  and (m.key<>'admin' or member.role='admin')
where a.is_active and a.scope_type='global' and (a.expires_at is null or a.expires_at>now())
group by a.id,a.profile_id,m.key,r.key,a.expires_at;

-- E: SQL 01 stops on conflicting revoked/shorter exact grants. Review manually.
select global_grant.id as global_grant_id,existing.id as conflicting_grant_id,
  existing.profile_id,existing.scope_id,existing.is_active,existing.expires_at
from public.platform_access_assignments global_grant
join public.platform_products p on p.id=global_grant.product_id and p.key='dashboard' and p.is_active
join public.platform_modules m on m.id=global_grant.module_id and m.is_active and m.key in ('technical_investigations','admin')
join public.platform_roles r on r.id=global_grant.role_id and r.is_active
join public.org_members member on member.profile_id=global_grant.profile_id and member.is_active
  and (m.key<>'admin' or member.role='admin')
join public.platform_access_assignments existing on existing.profile_id=global_grant.profile_id
  and existing.product_id=global_grant.product_id and existing.module_id=global_grant.module_id
  and existing.role_id=global_grant.role_id and existing.scope_type='organization' and existing.scope_id=member.org_id::text
where global_grant.is_active and global_grant.scope_type='global'
  and (global_grant.expires_at is null or global_grant.expires_at>now())
  and (not existing.is_active or (existing.expires_at is not null
    and (global_grant.expires_at is null or existing.expires_at<global_grant.expires_at)));

-- F: revoked/expired administration for active organization admins.
-- Review before SQL 01's bootstrap of admin grants for TU-enabled organizations.
select a.id as grant_id,o.id as organization_id,o.name,a.profile_id,a.is_active,a.expires_at
from public.platform_access_assignments a
join public.platform_products p on p.id=a.product_id and p.key='dashboard'
join public.platform_modules mod on mod.id=a.module_id and mod.key='admin'
join public.platform_roles role on role.id=a.role_id and role.key='dashboard_admin'
join public.organizations o on a.scope_type='organization' and a.scope_id=o.id::text
join public.org_members member on member.org_id=o.id and member.profile_id=a.profile_id and member.is_active and member.role='admin'
where not a.is_active or (a.expires_at is not null and a.expires_at<=now());

-- If SQL 01 fails, its transaction rolls back. Resolve the conflict and retry
-- as a unit. Do not undo installation by deleting memberships/profiles or by
-- dropping policies. An application rollback must retain the access guards.
