-- Read-only checks before applying the BRF lifecycle migration.
-- Duplicate associations need manual assessment, never automatic merging.
select regexp_replace(org_number, '[^0-9]', '', 'g') as org_number,
  array_agg(id) as brf_ids, array_agg(name) as names
from public.brf_associations where nullif(trim(org_number), '') is not null
group by regexp_replace(org_number, '[^0-9]', '', 'g') having count(*) > 1;

-- Inactive memberships with active board access: migration revokes these board grants.
select b.brf_id, b.profile_id, a.id as assignment_id
from public.brf_members b
join public.platform_access_assignments a on a.profile_id = b.profile_id and a.scope_type = 'brf' and a.scope_id = b.brf_id::text
join public.platform_products p on p.id = a.product_id and p.key = 'renoapp'
join public.platform_roles r on r.id = a.role_id and r.key in ('board_member', 'renoapp_admin')
left join public.platform_modules m on m.id = a.module_id
where not b.is_active and a.is_active and (m.key = 'board_portal' or a.module_id is null);

-- Active membership with explicitly disabled/expired access: migration preserves the denial.
select b.brf_id, b.profile_id, a.id as assignment_id, a.is_active, a.expires_at
from public.brf_members b
join public.platform_access_assignments a on a.profile_id = b.profile_id and a.scope_type = 'brf' and a.scope_id = b.brf_id::text
join public.platform_products p on p.id = a.product_id and p.key = 'renoapp'
left join public.platform_modules m on m.id = a.module_id
where b.is_active and (not a.is_active or a.expires_at <= now()) and (m.key = 'board_portal' or a.module_id is null);
