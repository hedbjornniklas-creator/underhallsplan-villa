-- OWNERSHIP FOUNDATION ONLY. Requires a reviewed OB organization preflight.
-- Does NOT activate organization authorization, change existing RLS/RPCs,
-- enable modules, create grants or modify inspections/issued documents.
-- Explicit user approval covers only the 21 IDs below, not every inspection
-- belonging to that owner, and not future records. New unattributed OBs abort.
-- Existing recorded organization evidence is preserved, including historical
-- and revoked report links; conflicting evidence aborts the entire transaction.
-- Re-run only after reviewing current data. Missing approved IDs abort; an
-- existing approved binding can acquire SAME-org evidence but cannot move.
-- Deleting an inspection still cascades its binding. Deleting an organization
-- with surviving bound OBs is deliberately RESTRICTED. No public write API.
-- A separate private append-only audit retains original attribution after an
-- inspection is deleted; it has no foreign keys and contains no report data.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Required source tables/columns are explicit: do not silently ignore a missing
-- evidence source. inspection_family/type/org_id alone may be optional.
do $$
declare required record;
begin
  for required in select * from (values
    ('inspections',array['id','property_id']),('properties',array['id','owner']),
    ('organizations',array['id']),('assignments',array['id','inspection_id','org_id','assignment_type']),
    ('ob_assignment_workflows',array['inspection_id','org_id','initial_assignment_id','current_assignment_id']),
    ('inspection_report_links',array['id','inspection_id','org_id','assignment_id'])
  ) s(table_name,column_names) loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=required.table_name and c.relkind in ('r','p')
      and required.column_names <@ array(select a.attname::text from pg_attribute a
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) then
      raise exception 'OB_BINDING_SCHEMA_REVIEW_REQUIRED: %',required.table_name;
    end if;
  end loop;
  if not exists(select 1 from pg_attribute where attrelid='public.inspections'::regclass
    and attname in ('inspection_family','type') and attnum>0 and not attisdropped) then
    raise exception 'OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED';
  end if;
end $$;

-- SHARE excludes concurrent INSERT/UPDATE/DELETE on every evidence source while
-- retaining reads. Acquire one stable set before selecting migration candidates.
lock table public.organizations,public.properties,public.inspections,public.assignments,
  public.ob_assignment_workflows,public.inspection_report_links in share mode;

create table if not exists public.ob_organization_bindings (
  inspection_id uuid primary key references public.inspections(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  attribution_source text not null check(attribution_source in ('recorded_sources','approved_legacy_bbsab')),
  created_at timestamptz not null default now()
);
lock table public.ob_organization_bindings in share row exclusive mode;
create index if not exists ob_organization_bindings_org_idx on public.ob_organization_bindings(org_id);
alter table public.ob_organization_bindings enable row level security;
revoke all on public.ob_organization_bindings from public,anon,authenticated,service_role;
grant select on public.ob_organization_bindings to service_role;

create table if not exists public.ob_organization_binding_audit (
  inspection_id uuid primary key,
  org_id uuid not null,
  attribution_source text not null check(attribution_source in ('recorded_sources','approved_legacy_bbsab')),
  created_at timestamptz not null
);
lock table public.ob_organization_binding_audit in share row exclusive mode;
alter table public.ob_organization_binding_audit enable row level security;
revoke all on public.ob_organization_binding_audit from public,anon,authenticated,service_role;
grant select on public.ob_organization_binding_audit to service_role;

create or replace function public.ob_organization_binding_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'OB_ORGANIZATION_BINDING_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function public.ob_organization_binding_immutable() from public,anon,authenticated,service_role;
drop trigger if exists ob_organization_binding_immutable on public.ob_organization_bindings;
create trigger ob_organization_binding_immutable before update on public.ob_organization_bindings
  for each row execute function public.ob_organization_binding_immutable();
drop trigger if exists ob_organization_binding_audit_immutable on public.ob_organization_binding_audit;
create trigger ob_organization_binding_audit_immutable before update or delete on public.ob_organization_binding_audit
  for each row execute function public.ob_organization_binding_immutable();

create temporary table ob_binding_approved_ids(inspection_id uuid primary key) on commit drop;
insert into ob_binding_approved_ids values
  ('1b7b0cb8-98f3-4e32-b00a-220b04656720'),('1f4137eb-b470-49e4-9508-54fc5be0f6c0'),
  ('2164d9fd-a12e-447f-9e92-bb58851fb871'),('35339399-291b-453c-9eba-14f7ff7b9639'),
  ('37dbf7e6-5618-4f46-b15a-c3afba21bdcc'),('408235cd-c3a4-4dd0-9e48-7fb2db8a1aaa'),
  ('458cc307-4920-4630-beb5-525c409e7344'),('4a6088cc-bdf5-4b39-9785-7f0dbdff7f26'),
  ('4d045972-e247-450b-b67e-742c2fe05a2a'),('57821648-825f-4c5e-9a10-59fe29bff224'),
  ('591adba5-ef38-4771-99ea-d4419b898cbd'),('8e177da0-d092-48ba-81c3-b3dfb94795e7'),
  ('950eac5a-8115-47ce-899e-62c3cdd09dc0'),('adb8e3c4-9944-4ca3-84fb-000e07e6d847'),
  ('bd0426cd-a1e7-4739-830b-0b5aa31a7f3c'),('c8739a4f-faee-4495-aee5-bcf8f9159cc1'),
  ('d3553a23-e756-4c6c-a993-402ed9287d9d'),('de577fb8-a95f-46e8-aa22-6827d6a01c2b'),
  ('ea722ab3-9f3a-4514-a50a-62e1fd412df1'),('eeb2b7d1-4e8a-401e-9307-e8d06519fcec'),
  ('f24ba8cc-080e-4d02-8d1c-81cc3b4b1c3f');

-- A legacy type-only SB can mean EB Slutbesiktning. Canonical family OB includes
-- its SB variant, but ambiguous type-only SB must be reviewed, not inferred.
do $$ begin
  if exists(select 1 from public.inspections i where
    (to_jsonb(i)->>'inspection_family' is not null and to_jsonb(i)->>'inspection_family' not in ('OB','EB','UHP','TU'))
    or (to_jsonb(i)->>'inspection_family' is null and
      (to_jsonb(i)->>'type' is null or to_jsonb(i)->>'type' not in ('OB','STATUS','EB','UHP','TU','SLB','FB','GB','KSB','SAB')))) then
    raise exception 'OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED';
  end if;
end $$;

create temporary table ob_binding_cases on commit drop as
  select i.id as inspection_id,p.owner as owner_id,
    nullif(to_jsonb(i)->>'org_id','')::uuid as inspection_org_id
  from public.inspections i left join public.properties p on p.id=i.property_id
  where to_jsonb(i)->>'inspection_family'='OB'
    or (to_jsonb(i)->>'inspection_family' is null and to_jsonb(i)->>'type' in ('OB','STATUS'));
create unique index on ob_binding_cases(inspection_id);

-- Validate pointers instead of dropping dangling or wrong-family evidence.
do $$ begin
  if exists(select 1 from ob_binding_cases where owner_id is null) then raise exception 'OB_BINDING_OWNER_REQUIRED'; end if;
  if exists(select 1 from ob_binding_approved_ids a left join ob_binding_cases c using(inspection_id)
    where c.inspection_id is null or c.owner_id<>'fe8cde81-8fa4-4fef-bd4c-1d3c5dfbb8fa'::uuid) then
    raise exception 'OB_BINDING_APPROVAL_DRIFT';
  end if;
  if exists(select 1 from public.ob_assignment_workflows w join ob_binding_cases c using(inspection_id)
    left join public.assignments a on a.id=w.initial_assignment_id left join public.assignments b on b.id=w.current_assignment_id
    where a.id is null or b.id is null or a.assignment_type is null or b.assignment_type is null
      or a.assignment_type not in ('OB','STATUS') or b.assignment_type not in ('OB','STATUS')
      or a.org_id is null or b.org_id is null or w.org_id is null
      or (a.inspection_id is not null and a.inspection_id<>w.inspection_id)
      or (b.inspection_id is not null and b.inspection_id<>w.inspection_id))
    or exists(select 1 from public.inspection_report_links r join ob_binding_cases c using(inspection_id)
      left join public.assignments a on a.id=r.assignment_id where r.org_id is null or (r.assignment_id is not null
        and (a.id is null or a.assignment_type is null or a.assignment_type not in ('OB','STATUS') or a.org_id is null
          or (a.inspection_id is not null and a.inspection_id<>r.inspection_id))))
    or exists(select 1 from public.assignments a join ob_binding_cases c using(inspection_id)
      where a.org_id is null or a.assignment_type is null or a.assignment_type not in ('OB','STATUS')) then
    raise exception 'OB_BINDING_RECORDED_SOURCE_REVIEW_REQUIRED';
  end if;
end $$;

create temporary table ob_binding_evidence on commit drop as
  select inspection_id,inspection_org_id as org_id from ob_binding_cases where inspection_org_id is not null
  union all select a.inspection_id,a.org_id from public.assignments a join ob_binding_cases c using(inspection_id)
  union all select w.inspection_id,w.org_id from public.ob_assignment_workflows w join ob_binding_cases c using(inspection_id)
  union all select w.inspection_id,a.org_id from public.ob_assignment_workflows w join ob_binding_cases c using(inspection_id)
    join public.assignments a on a.id=w.initial_assignment_id
  union all select w.inspection_id,a.org_id from public.ob_assignment_workflows w join ob_binding_cases c using(inspection_id)
    join public.assignments a on a.id=w.current_assignment_id
  union all select r.inspection_id,r.org_id from public.inspection_report_links r join ob_binding_cases c using(inspection_id)
  union all select r.inspection_id,a.org_id from public.inspection_report_links r join ob_binding_cases c using(inspection_id)
    join public.assignments a on a.id=r.assignment_id;

do $$ begin
  if exists(select 1 from ob_binding_evidence group by inspection_id having count(distinct org_id)>1) then
    raise exception 'OB_BINDING_ORGANIZATION_CONFLICT';
  end if;
  if exists(select 1 from ob_binding_evidence e left join public.organizations o on o.id=e.org_id where o.id is null)
    or not exists(select 1 from public.organizations where id='71c056a9-aef5-42ce-872c-75952bc55795') then
    raise exception 'OB_BINDING_ORGANIZATION_MISSING';
  end if;
  -- First insertion of any approved fallback requires the audited absence of
  -- recorded evidence. Later compatible evidence is allowed only when the exact
  -- approved BBSAB binding already exists; no provenance rewriting on reruns.
  if exists(select 1 from ob_binding_approved_ids a join ob_binding_evidence e using(inspection_id)
    left join public.ob_organization_bindings b using(inspection_id)
    where b.inspection_id is null or b.org_id<>'71c056a9-aef5-42ce-872c-75952bc55795'::uuid
      or e.org_id<>b.org_id) then raise exception 'OB_BINDING_APPROVAL_DRIFT'; end if;
  if exists(select 1 from ob_binding_cases c where
    not exists(select 1 from ob_binding_evidence e where e.inspection_id=c.inspection_id)
    and not exists(select 1 from ob_binding_approved_ids a where a.inspection_id=c.inspection_id)) then
    raise exception 'OB_BINDING_UNAPPROVED_INSPECTION';
  end if;
end $$;

create temporary table ob_binding_candidates on commit drop as
  select c.inspection_id,
    coalesce((select e.org_id from ob_binding_evidence e where e.inspection_id=c.inspection_id limit 1),
      '71c056a9-aef5-42ce-872c-75952bc55795'::uuid) as org_id,
    case when exists(select 1 from ob_binding_approved_ids a where a.inspection_id=c.inspection_id)
      then 'approved_legacy_bbsab' else 'recorded_sources' end as attribution_source
  from ob_binding_cases c;
do $$ begin
  if exists(select 1 from public.ob_organization_bindings b left join ob_binding_candidates c using(inspection_id)
    where c.inspection_id is null or b.org_id<>c.org_id or b.attribution_source<>c.attribution_source) then
    raise exception 'OB_BINDING_EXISTING_CONFLICT';
  end if;
end $$;
insert into public.ob_organization_bindings(inspection_id,org_id,attribution_source)
  select c.inspection_id,c.org_id,c.attribution_source from ob_binding_candidates c
  where not exists(select 1 from public.ob_organization_bindings b where b.inspection_id=c.inspection_id);

do $$ begin
  if exists(select 1 from public.ob_organization_bindings b join public.ob_organization_binding_audit a using(inspection_id)
    where b.org_id<>a.org_id or b.attribution_source<>a.attribution_source or b.created_at<>a.created_at) then
    raise exception 'OB_BINDING_AUDIT_CONFLICT';
  end if;
end $$;
insert into public.ob_organization_binding_audit(inspection_id,org_id,attribution_source,created_at)
  select b.inspection_id,b.org_id,b.attribution_source,b.created_at from public.ob_organization_bindings b
  where not exists(select 1 from public.ob_organization_binding_audit a where a.inspection_id=b.inspection_id);

commit;
