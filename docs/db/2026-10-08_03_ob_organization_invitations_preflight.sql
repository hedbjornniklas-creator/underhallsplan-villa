-- READ ONLY. Before 2026-10-08_03_ob_organization_invitations.sql.
-- A listed access-review row does NOT block installing SQL03: installation
-- changes no organization or personal access. It blocks first ÖB activation
-- for that organization until current access has been deliberately reviewed.
-- Do not auto-copy global/product/legacy grants. Do not infer identity from name.
-- Keep the existing ÖB entitlement absent until review is complete; a new off
-- row would switch existing users away from legacy access as well.
begin read only;

select 'Prerequisite: organization administration' as check_name,
  to_regprocedure('public.organization_invitation_accept(uuid,text)') is not null as ok
union all select 'Prerequisite: central organization administration',
  to_regprocedure('public.platform_organization_modules_save(uuid,uuid,text[],text[])') is not null
union all select 'Prerequisite: ÖB organization runtime',
  to_regprocedure('public.ob_actor_has_organization_access(uuid,uuid)') is not null;

-- Review each affected profile in each organization independently. An exact
-- org-scoped inspector grant for ÖB is needed before first managed activation
-- for members whose existing access must be retained. Preserve grant expiry;
-- existing global/product assignments and other organizations stay untouched.
-- The migration itself deliberately provides no automatic grant/backfill.
with review as (
  select o.id as organization_id,o.name as organization_name,
    member.profile_id,profile.full_name as profile_name,member.role as organization_role,
    public.ob_actor_has_organization_access(o.id,member.profile_id) as current_ob_access,
    exists(select 1 from public.platform_access_assignments broad
      join public.platform_products product on product.id=broad.product_id and product.key='dashboard'
      where broad.profile_id=member.profile_id and broad.module_id is null and broad.is_active
        and (broad.expires_at is null or broad.expires_at>now())
        and (broad.scope_type='global' or (broad.scope_type='organization' and broad.scope_id=o.id::text))) as product_wide_access,
    exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
      join public.platform_modules m on m.id=a.module_id and m.product_id=p.id and m.key='inspections' and m.is_active
      join public.platform_roles r on r.id=a.role_id and r.product_id=p.id and r.key='inspector' and r.is_active
      where a.profile_id=member.profile_id and a.scope_type='organization' and a.scope_id=o.id::text
        and a.is_active and (a.expires_at is null or a.expires_at>now())) as exact_scoped_inspector
  from public.organizations o
  join public.org_members member on member.org_id=o.id and member.is_active
  join public.profiles profile on profile.id=member.profile_id
  where not exists(select 1 from public.organization_enabled_modules e where e.org_id=o.id and e.module_key='inspections')
)
select organization_id,organization_name,profile_id,profile_name,organization_role,
  current_ob_access,product_wide_access,exact_scoped_inspector,
  'Explicit access review required before first OB activation; no automatic grant' as action
from review
where (current_ob_access or product_wide_access) and not exact_scoped_inspector
order by organization_name,profile_name,profile_id;

commit;
