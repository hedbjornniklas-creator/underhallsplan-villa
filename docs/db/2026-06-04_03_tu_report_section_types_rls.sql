-- Technical investigations report section type RLS policies
-- Date: 2026-06-04
-- Scope:
-- 1) Allow BesiktApp admins to manage TU report section headings from admin
-- 2) Keep TU section heading settings protected from regular authenticated users

create or replace function public.is_hushub_besiktapp_admin()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id::text = auth.uid()::text
      and coalesce(p.is_admin, false) = true
  )
  or exists (
    select 1
    from public.platform_access_assignments paa
    join public.platform_products pp
      on pp.id = paa.product_id
     and pp.key = 'hushub_admin'
    join public.platform_modules pm
      on pm.id = paa.module_id
     and pm.key = 'besiktapp_admin'
    join public.platform_roles pr
      on pr.id = paa.role_id
     and pr.key in ('hushub_superadmin', 'product_admin')
    where paa.profile_id::text = auth.uid()::text
      and paa.is_active = true
      and (paa.expires_at is null or paa.expires_at > now())
      and paa.scope_type = 'global'
      and paa.scope_id is null
  );
$$;

grant execute on function public.is_hushub_besiktapp_admin() to authenticated;

alter table public.settings_tu_report_section_types enable row level security;

drop policy if exists settings_tu_report_section_types_admin_all
  on public.settings_tu_report_section_types;
create policy settings_tu_report_section_types_admin_all
  on public.settings_tu_report_section_types
  for all
  to authenticated
  using (public.is_hushub_besiktapp_admin())
  with check (public.is_hushub_besiktapp_admin());
