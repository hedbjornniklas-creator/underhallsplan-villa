-- READ ONLY. Run after 2026-10-08_03_ob_organization_invitations.sql.
-- Every row must show ok=true. This does not activate ÖB or send invitations.
begin read only;
with entry_points(signature) as (values
  ('public.platform_organization_create(uuid,uuid,jsonb)'),
  ('public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb)'),
  ('public.platform_organization_modules_save(uuid,uuid,text[],text[])'),
  ('public.organization_invitation_create(uuid,uuid,jsonb)'),
  ('public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz)'),
  ('public.organization_invitation_accept(uuid,text)'),
  ('public.organization_member_update(uuid,uuid,uuid,jsonb)')
), helpers(signature) as (values
  ('public.platform_organization_validate_modules(text[])'),
  ('public.organization_validate_modules(uuid,jsonb)'),
  ('public.organization_assert_ob_activation_reviewed(uuid)'),
  ('public.organization_apply_member_grants(uuid,uuid,uuid,text,boolean,text[])')
), checks as (
  select '01 Entry points: service only, SECURITY DEFINER, fixed search path' as check_name,
    coalesce(bool_and(p.oid is not null and p.prosecdef and p.proconfig @> array['search_path=""']::text[]
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')),false) as ok
    from entry_points e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  union all select '02 Internal helpers cannot be called by clients or service role',
    coalesce(bool_and(p.oid is not null and not has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')),false)
    from helpers h left join pg_proc p on p.oid=to_regprocedure(h.signature)
  union all select '03 Module set validator accepts and sorts OB + TU',
    public.platform_organization_validate_modules(array['technical_investigations','inspections'])
      =array['inspections','technical_investigations']::text[]
  union all select '04 Entitlement table accepts only OB + TU',
    exists(select 1 from pg_constraint where conrelid='public.organization_enabled_modules'::regclass
      and conname='organization_enabled_modules_module_key_check' and convalidated
      and pg_get_constraintdef(oid) like '%inspections%' and pg_get_constraintdef(oid) like '%technical_investigations%')
  union all select '05 Invitation table rejects duplicate or unsupported module sets',
    exists(select 1 from pg_constraint where conrelid='public.organization_invitations'::regclass
      and conname='organization_invitations_modules_check' and convalidated
      and pg_get_constraintdef(oid) like '%inspections%' and pg_get_constraintdef(oid) like '%modules[1] <> modules[2]%')
  union all select '06 No unsupported entitlement or invitation values',
    not exists(select 1 from public.organization_enabled_modules where module_key not in ('inspections','technical_investigations'))
      and not exists(select 1 from public.organization_invitations where
        not modules<@array['inspections','technical_investigations']::text[] or array_position(modules,null) is not null
        or cardinality(modules)>2 or (cardinality(modules)=2 and modules[1]=modules[2]))
  union all select '07 First OB activation has explicit legacy-access review guard',
    position('organization_assert_ob_activation_reviewed' in pg_get_functiondef('public.platform_organization_modules_save(uuid,uuid,text[],text[])'::regprocedure))>0
  union all select '08 Invitation acceptance protects prior legacy memberships',
    position('platform_organization_assert_managed_target' in pg_get_functiondef('public.organization_invitation_accept(uuid,text)'::regprocedure))>0
  union all select '09 New organizations receive explicit per-module markers',
    position('inspections' in pg_get_functiondef('public.platform_organization_create(uuid,uuid,jsonb)'::regprocedure))>0
  union all select '10 Private module data and invitations remain RLS protected',
    (select count(*)=2 and bool_and(relrowsecurity) from pg_class
      where oid in ('public.organization_enabled_modules'::regclass,'public.organization_invitations'::regclass))
)
select check_name,ok from checks order by check_name;
commit;
