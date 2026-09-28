-- Fuktsäkerhet stage 1: independent organization-scoped projects.
-- Prerequisites: organizations, org_members, profiles, properties, buildings,
-- platform_products/modules and 2026-09-10_05_organization_customers.sql.
-- Apply explicitly to the intended database; this file does not deploy itself.
-- No inspections, TU rows, existing permissions or legal property owners are changed.
begin;
set local lock_timeout = '10s';

insert into public.platform_modules(product_id,key,label,description,is_active,sort_order)
select id,'moisture_safety','Fuktsäkerhet','Fuktinventering, fuktsäkerhetsbeskrivning och projektering.',true,280
from public.platform_products where key='dashboard'
on conflict(product_id,key) do update set label=excluded.label,description=excluded.description,
  is_active=excluded.is_active,sort_order=excluded.sort_order;
-- Access must be assigned explicitly. There is intentionally no access backfill from TU.

create table if not exists public.moisture_projects (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  property_id uuid not null references public.properties(id),
  customer_id uuid,
  title text not null check(char_length(btrim(title)) between 1 and 200),
  description text check(description is null or char_length(description)<=5000),
  scopes text[] not null check(cardinality(scopes) between 1 and 3
    and array_position(scopes,null) is null and scopes <@ array['inventory','description','design']::text[]),
  pricing_mode text not null default 'undecided' check(pricing_mode in ('undecided','fixed','hourly')),
  status text not null default 'draft' check(status in ('draft','active','archived')),
  revision integer not null default 1 check(revision>0),
  created_by_profile_id uuid not null references public.profiles(id),
  updated_by_profile_id uuid not null references public.profiles(id),
  creation_input jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,property_id),
  foreign key(org_id,customer_id) references public.organization_customers(org_id,id)
);
create index if not exists moisture_projects_org_updated_idx on public.moisture_projects(org_id,updated_at desc,id);
create index if not exists moisture_projects_org_property_idx on public.moisture_projects(org_id,property_id);

-- A redundant identity index allows a durable composite FK: a linked building
-- cannot silently be moved to a different property by an unrelated legacy writer.
create unique index if not exists moisture_buildings_property_identity_idx on public.buildings(id,property_id);
create table if not exists public.moisture_project_buildings (
  project_id uuid not null,
  property_id uuid not null,
  building_id uuid not null,
  sort_order integer not null check(sort_order>=0),
  primary key(project_id,building_id),
  foreign key(project_id,property_id) references public.moisture_projects(id,property_id) on delete cascade,
  foreign key(building_id,property_id) references public.buildings(id,property_id)
);
comment on column public.moisture_projects.creation_input is
  'Normalized original create request. An idempotent retry must match both this payload and its original creator.';

alter table public.moisture_projects enable row level security;
alter table public.moisture_project_buildings enable row level security;
revoke all on public.moisture_projects,public.moisture_project_buildings from public,anon,authenticated;
grant select,insert,update,delete on public.moisture_projects,public.moisture_project_buildings to service_role;
-- No browser policies: both reads and writes go through the module-gated server.

create or replace function public.moisture_assert_member(p_org uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.org_members m where m.org_id=p_org and m.profile_id=p_actor and m.is_active=true for share;
  if not found then raise exception 'MOISTURE_FORBIDDEN'; end if;
end $$;

create or replace function public.moisture_property_access(p_property uuid,p_org uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.properties p where p.id=p_property and
    (p.owner=p_actor or exists(select 1 from public.moisture_projects m where m.org_id=p_org and m.property_id=p.id)))
$$;

create or replace function public.moisture_project_view(p_project uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',m.id,'orgId',m.org_id,'title',m.title,'description',m.description,'scopes',to_jsonb(m.scopes),
    'pricingMode',m.pricing_mode,'status',m.status,'revision',m.revision,'createdAt',m.created_at,'updatedAt',m.updated_at,
    'customerId',m.customer_id,'propertyId',m.property_id,
    'property',jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'cadastralId',p.cadastral_id,
      'municipality',p.municipality,'postalCode',p.postal_code,'city',p.city),
    'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'customerNumber',c.customer_number::text) end,
    'buildings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by mb.sort_order,b.id)
      from public.moisture_project_buildings mb join public.buildings b on b.id=mb.building_id and b.property_id=mb.property_id
      where mb.project_id=m.id),'[]'::jsonb))
  from public.moisture_projects m join public.properties p on p.id=m.property_id
  left join public.organization_customers c on c.id=m.customer_id and c.org_id=m.org_id where m.id=p_project
$$;

create or replace function public.moisture_projects_read(p_org_id uuid,p_actor_id uuid,p_project_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.moisture_assert_member(p_org_id,p_actor_id);
  if p_project_id is not null then
    if not exists(select 1 from public.moisture_projects where id=p_project_id and org_id=p_org_id) then
      raise exception 'MOISTURE_NOT_FOUND';
    end if;
    return public.moisture_project_view(p_project_id);
  end if;
  return coalesce((select jsonb_agg(public.moisture_project_view(m.id) order by m.updated_at desc,m.id)
    from public.moisture_projects m where m.org_id=p_org_id),'[]'::jsonb);
end $$;

create or replace function public.moisture_options_read(p_org_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.moisture_assert_member(p_org_id,p_actor_id);
  return jsonb_build_object(
    'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',p.address,
      'cadastralId',p.cadastral_id,'municipality',p.municipality,'postalCode',p.postal_code,'city',p.city,
      'buildings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name,b.id)
        from public.buildings b where b.property_id=p.id),'[]'::jsonb)) order by p.name,p.id)
      from public.properties p where public.moisture_property_access(p.id,p_org_id,p_actor_id)),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'customerNumber',c.customer_number::text)
      order by c.name,c.id) from public.organization_customers c where c.org_id=p_org_id and c.is_active=true),'[]'::jsonb));
end $$;

create or replace function public.moisture_project_write(p_org_id uuid,p_actor_id uuid,p_project_id uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  current_project public.moisture_projects%rowtype;
  selected_property uuid;
  selected_customer uuid;
  building uuid;
  item jsonb;
  selected_scopes text[];
  selected_buildings uuid[];
  property_input jsonb;
  item_name text;
  position integer:=0;
begin
  perform public.moisture_assert_member(p_org_id,p_actor_id);
  if p_project_id is null or p_operation is null or p_operation not in ('create','update')
    or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  -- Serialize a client's create key even before the project row exists.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,684392));
  select * into current_project from public.moisture_projects where id=p_project_id for update;
  if p_operation='create' and found then
    if current_project.org_id<>p_org_id or current_project.created_by_profile_id<>p_actor_id
      or current_project.creation_input is distinct from p_input then raise exception 'MOISTURE_CREATE_CONFLICT'; end if;
    return public.moisture_project_view(current_project.id);
  elsif p_operation='update' then
    if current_project.id is null or current_project.org_id<>p_org_id then raise exception 'MOISTURE_NOT_FOUND'; end if;
    if jsonb_typeof(p_input->'revision') is distinct from 'number' or (p_input->>'revision') !~ '^[0-9]+$'
      then raise exception 'MOISTURE_INVALID_INPUT'; end if;
    if (p_input->>'revision')::bigint<>current_project.revision then raise exception 'MOISTURE_CONFLICT'; end if;
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('title','description','scopes','pricingMode','customerId','buildingIds','newBuildings')
    and not (p_operation='create' and k in ('projectId','property'))
    and not (p_operation='update' and k='revision')) then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  if jsonb_typeof(p_input->'title') is distinct from 'string'
    or char_length(btrim(p_input->>'title')) not between 1 and 200
    or (p_input->'description' is not null and jsonb_typeof(p_input->'description') not in ('string','null'))
    or char_length(p_input->>'description')>5000
    or coalesce(p_input->>'pricingMode','') not in ('undecided','fixed','hourly')
    or jsonb_typeof(p_input->'scopes') is distinct from 'array'
    or jsonb_typeof(p_input->'buildingIds') is distinct from 'array'
    or jsonb_typeof(p_input->'newBuildings') is distinct from 'array' then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  selected_scopes:=array(select jsonb_array_elements_text(p_input->'scopes'));
  if cardinality(selected_scopes) not between 1 and 3 or array_position(selected_scopes,null) is not null
    or not selected_scopes <@ array['inventory','description','design']::text[]
    or cardinality(selected_scopes)<>(select count(distinct s) from unnest(selected_scopes) s)
    or jsonb_array_length(p_input->'newBuildings')>50
    or jsonb_array_length(p_input->'buildingIds')+jsonb_array_length(p_input->'newBuildings')>100
    then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'buildingIds') b where jsonb_typeof(b)<>'string')
    then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  selected_buildings:=array(select v::uuid from jsonb_array_elements_text(p_input->'buildingIds') v);
  if cardinality(selected_buildings)<>(select count(distinct b) from unnest(selected_buildings) b)
    then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  if p_input->'customerId' is not null and jsonb_typeof(p_input->'customerId') not in ('string','null')
    then raise exception 'MOISTURE_INVALID_INPUT'; end if;
  selected_customer:=nullif(p_input->>'customerId','')::uuid;
  if selected_customer is not null then
    perform 1 from public.organization_customers c where c.id=selected_customer and c.org_id=p_org_id
      and (c.is_active=true or (p_operation='update' and current_project.customer_id=selected_customer)) for share;
    if not found then raise exception 'MOISTURE_CUSTOMER_INVALID'; end if;
  end if;
  if p_operation='create' then
    if (p_input->>'projectId')::uuid is distinct from p_project_id then raise exception 'MOISTURE_INVALID_INPUT'; end if;
    property_input:=p_input->'property';
    if jsonb_typeof(property_input) is distinct from 'object' then raise exception 'MOISTURE_INVALID_INPUT'; end if;
    if property_input->>'mode'='existing' then
      if exists(select 1 from jsonb_object_keys(property_input) k where k not in ('mode','id')) then raise exception 'MOISTURE_INVALID_INPUT'; end if;
      selected_property:=(property_input->>'id')::uuid;
      perform 1 from public.properties p where p.id=selected_property for share;
      if not found or not public.moisture_property_access(selected_property,p_org_id,p_actor_id) then raise exception 'MOISTURE_PROPERTY_INVALID'; end if;
    elsif property_input->>'mode'='new' then
      if cardinality(selected_buildings)>0 then raise exception 'MOISTURE_BUILDING_INVALID'; end if;
      if exists(select 1 from jsonb_object_keys(property_input) k where k not in
        ('mode','name','address','cadastralId','municipality','postalCode','city'))
        or jsonb_typeof(property_input->'name') is distinct from 'string'
        or char_length(btrim(property_input->>'name')) not between 1 and 200 then raise exception 'MOISTURE_INVALID_INPUT'; end if;
      for item_name in select unnest(array['address','cadastralId','municipality','postalCode','city']) loop
        if property_input->item_name is not null and jsonb_typeof(property_input->item_name) not in ('string','null')
          then raise exception 'MOISTURE_INVALID_INPUT'; end if;
        if char_length(property_input->>item_name)>(case item_name when 'address' then 255 when 'cadastralId' then 200 when 'postalCode' then 32 else 120 end)
          then raise exception 'MOISTURE_INVALID_INPUT'; end if;
      end loop;
      -- owner is access ownership only. Do not infer the legal owner_name from the actor/customer.
      insert into public.properties(owner,name,address,cadastral_id,municipality,postal_code,city)
      values(p_actor_id,btrim(property_input->>'name'),nullif(btrim(property_input->>'address'),''),
        nullif(btrim(property_input->>'cadastralId'),''),nullif(btrim(property_input->>'municipality'),''),
        nullif(btrim(property_input->>'postalCode'),''),nullif(btrim(property_input->>'city'),'')) returning id into selected_property;
    else raise exception 'MOISTURE_INVALID_INPUT'; end if;
    insert into public.moisture_projects(id,org_id,property_id,customer_id,title,description,scopes,pricing_mode,
      created_by_profile_id,updated_by_profile_id,creation_input)
    values(p_project_id,p_org_id,selected_property,selected_customer,btrim(p_input->>'title'),nullif(btrim(p_input->>'description'),''),
      selected_scopes,p_input->>'pricingMode',p_actor_id,p_actor_id,p_input);
  else
    selected_property:=current_project.property_id;
    update public.moisture_projects set title=btrim(p_input->>'title'),description=nullif(btrim(p_input->>'description'),''),
      scopes=selected_scopes,pricing_mode=p_input->>'pricingMode',customer_id=selected_customer,
      revision=revision+1,updated_at=clock_timestamp(),updated_by_profile_id=p_actor_id where id=p_project_id;
    delete from public.moisture_project_buildings where project_id=p_project_id;
  end if;
  foreach building in array selected_buildings loop
    perform 1 from public.buildings b where b.id=building and b.property_id=selected_property for share;
    if not found then raise exception 'MOISTURE_BUILDING_INVALID'; end if;
    insert into public.moisture_project_buildings(project_id,property_id,building_id,sort_order)
      values(p_project_id,selected_property,building,position);
    position:=position+1;
  end loop;
  for item in select v from jsonb_array_elements(p_input->'newBuildings') v loop
    if jsonb_typeof(item) is distinct from 'string' then raise exception 'MOISTURE_INVALID_INPUT'; end if;
    item_name:=btrim(item#>>'{}');
    if char_length(item_name) not between 1 and 200 then raise exception 'MOISTURE_INVALID_INPUT'; end if;
    insert into public.buildings(property_id,name) values(selected_property,item_name) returning id into building;
    insert into public.moisture_project_buildings(project_id,property_id,building_id,sort_order)
      values(p_project_id,selected_property,building,position);
    position:=position+1;
  end loop;
  return public.moisture_project_view(p_project_id);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'MOISTURE_INVALID_INPUT';
end $$;

revoke all on function public.moisture_assert_member(uuid,uuid),
  public.moisture_property_access(uuid,uuid,uuid),public.moisture_project_view(uuid),
  public.moisture_projects_read(uuid,uuid,uuid),public.moisture_options_read(uuid,uuid),
  public.moisture_project_write(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.moisture_projects_read(uuid,uuid,uuid),public.moisture_options_read(uuid,uuid),
  public.moisture_project_write(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
