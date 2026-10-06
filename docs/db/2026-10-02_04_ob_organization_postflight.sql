-- READ ONLY. Run after 2026-10-02_03_ob_organization_bindings.sql.
-- This checks the ownership foundation, NOT readiness to activate managed OB.
-- Old creation flows may still produce unbound inspections until the later
-- API/UI/RLS rollout. A new unbound inspection requires review, never inference
-- from the inspector's default organization. Do not alter issued documents.
-- Contains only counts and schema/privilege checks; no customer/report content.
with approved(id) as (values
  ('1b7b0cb8-98f3-4e32-b00a-220b04656720'::uuid),
  ('1f4137eb-b470-49e4-9508-54fc5be0f6c0'::uuid),
  ('2164d9fd-a12e-447f-9e92-bb58851fb871'::uuid),
  ('35339399-291b-453c-9eba-14f7ff7b9639'::uuid),
  ('37dbf7e6-5618-4f46-b15a-c3afba21bdcc'::uuid),
  ('408235cd-c3a4-4dd0-9e48-7fb2db8a1aaa'::uuid),
  ('458cc307-4920-4630-beb5-525c409e7344'::uuid),
  ('4a6088cc-bdf5-4b39-9785-7f0dbdff7f26'::uuid),
  ('4d045972-e247-450b-b67e-742c2fe05a2a'::uuid),
  ('57821648-825f-4c5e-9a10-59fe29bff224'::uuid),
  ('591adba5-ef38-4771-99ea-d4419b898cbd'::uuid),
  ('8e177da0-d092-48ba-81c3-b3dfb94795e7'::uuid),
  ('950eac5a-8115-47ce-899e-62c3cdd09dc0'::uuid),
  ('adb8e3c4-9944-4ca3-84fb-000e07e6d847'::uuid),
  ('bd0426cd-a1e7-4739-830b-0b5aa31a7f3c'::uuid),
  ('c8739a4f-faee-4495-aee5-bcf8f9159cc1'::uuid),
  ('d3553a23-e756-4c6c-a993-402ed9287d9d'::uuid),
  ('de577fb8-a95f-46e8-aa22-6827d6a01c2b'::uuid),
  ('ea722ab3-9f3a-4514-a50a-62e1fd412df1'::uuid),
  ('eeb2b7d1-4e8a-401e-9307-e8d06519fcec'::uuid),
  ('f24ba8cc-080e-4d02-8d1c-81cc3b4b1c3f'::uuid)
), classified as (
  select i.id, p.owner, b.org_id,
    (to_jsonb(i)->>'inspection_family' = 'OB' or
      (to_jsonb(i)->>'inspection_family' is null and i.type in ('OB','STATUS'))) is true as is_ob,
    ((to_jsonb(i)->>'inspection_family' is not null and to_jsonb(i)->>'inspection_family' not in ('OB','EB','UHP','TU'))
      or (to_jsonb(i)->>'inspection_family' is null and
        (i.type is null or i.type not in ('OB','STATUS','EB','UHP','TU','SLB','FB','GB','KSB','SAB')))) as ambiguous_family
  from public.inspections i left join public.properties p on p.id=i.property_id
  left join public.ob_organization_bindings b on b.inspection_id=i.id
), recorded as (
  select i.id as inspection_id, (to_jsonb(i)->>'org_id')::uuid as org_id from public.inspections i
  union all select inspection_id, org_id from public.assignments
  union all select inspection_id, org_id from public.ob_assignment_workflows
  union all select w.inspection_id, a.org_id from public.ob_assignment_workflows w
    join public.assignments a on a.id=w.initial_assignment_id
  union all select w.inspection_id, a.org_id from public.ob_assignment_workflows w
    join public.assignments a on a.id=w.current_assignment_id
  union all select inspection_id, org_id from public.inspection_report_links
  union all select r.inspection_id, a.org_id from public.inspection_report_links r
    join public.assignments a on a.id=r.assignment_id
), checks(ordning, kontroll, antal, forvantat) as (
  select 1, 'Godkända äldre besiktningar finns kvar', count(*), 21 from approved a join classified i on i.id=a.id
  union all select 2, 'Godkända äldre besiktningar kopplade till BBSAB', count(*), 21
    from approved a join classified i on i.id=a.id
    where i.is_ob and i.org_id='71c056a9-aef5-42ce-872c-75952bc55795'::uuid
      and i.owner='fe8cde81-8fa4-4fef-bd4c-1d3c5dfbb8fa'::uuid
  union all select 3, 'ÖB med organisationskoppling', count(*), (select count(*) from classified where is_ob)
    from classified where is_ob and org_id is not null
  union all select 4, 'ÖB utan organisationskoppling – behöver granskas', count(*), 0
    from classified where is_ob and org_id is null
  union all select 5, 'Koppling på annan besiktningsfamilj än ÖB', count(*), 0
    from classified where not is_ob and org_id is not null
  union all select 6, 'Organisation skiljer sig från registrerade historiska källor', count(distinct i.id), 0
    from classified i join recorded r on r.inspection_id=i.id
    where i.is_ob and i.org_id is not null and r.org_id is not null and i.org_id<>r.org_id
  union all select 7, 'ÖB med motstridiga historiska organisationskällor', count(*), 0
    from (select i.id from classified i join recorded r on r.inspection_id=i.id
      where i.is_ob group by i.id having count(distinct r.org_id)>1) conflicts
  union all select 8, 'ÖB utan fastighetsägare', count(*), 0 from classified where is_ob and owner is null
  union all select 9, 'Oklar äldre besiktningsfamilj', count(*), 0 from classified where ambiguous_family
  union all select 10, 'Klientroller med läs- eller skrivrätt till koppling eller historik', count(*), 0
    from pg_roles r cross join (values ('public.ob_organization_bindings'::regclass),
      ('public.ob_organization_binding_audit'::regclass)) t(id)
    where r.rolname in ('anon','authenticated')
      and has_table_privilege(r.oid,t.id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  union all select 11, 'Tabeller där service role endast har läsrätt', count(*), 2
    from (values ('public.ob_organization_bindings'::regclass),
      ('public.ob_organization_binding_audit'::regclass)) t(id)
    where has_table_privilege('service_role',t.id,'SELECT')
      and not has_table_privilege('service_role',t.id,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  union all select 12, 'Tabeller med RLS aktiverat', count(*), 2
    from pg_class where oid in ('public.ob_organization_bindings'::regclass,
      'public.ob_organization_binding_audit'::regclass) and relrowsecurity
  union all select 13, 'Koppling saknar överensstämmande historik', count(*), 0
    from public.ob_organization_bindings b left join public.ob_organization_binding_audit a using(inspection_id)
    where a.inspection_id is null or a.org_id is distinct from b.org_id
      or a.attribution_source is distinct from b.attribution_source or a.created_at is distinct from b.created_at
  union all select 14, 'Historiska källhänvisningar behöver granskas', count(*), 0
    from classified i where i.is_ob and (
      exists(select 1 from public.assignments a where a.inspection_id=i.id
        and (a.org_id is null or a.assignment_type is null or a.assignment_type not in ('OB','STATUS')))
      or exists(select 1 from public.ob_assignment_workflows w
        left join public.assignments a on a.id=w.initial_assignment_id
        left join public.assignments b on b.id=w.current_assignment_id
        where w.inspection_id=i.id and (w.org_id is null or a.id is null or b.id is null
          or a.org_id is null or b.org_id is null or a.assignment_type is null or b.assignment_type is null
          or a.assignment_type not in ('OB','STATUS') or b.assignment_type not in ('OB','STATUS')
          or (a.inspection_id is not null and a.inspection_id<>w.inspection_id)
          or (b.inspection_id is not null and b.inspection_id<>w.inspection_id)))
      or exists(select 1 from public.inspection_report_links r
        left join public.assignments a on a.id=r.assignment_id
        where r.inspection_id=i.id and (r.org_id is null or (r.assignment_id is not null
          and (a.id is null or a.org_id is null or a.assignment_type is null
            or a.assignment_type not in ('OB','STATUS')
            or (a.inspection_id is not null and a.inspection_id<>r.inspection_id))))))
)
select kontroll, antal, forvantat,
  case when antal=forvantat then 'OK' else 'GRANSKA – aktivera inte ÖB ännu' end as resultat
from checks order by ordning;
