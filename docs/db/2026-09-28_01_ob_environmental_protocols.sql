-- New add-ons only. No backfill and no updates to published report snapshots.
begin;
-- Offer availability is still controlled by each inspector's existing settings.
-- Do not overwrite prices, disabled services or existing catalogue aliases.
insert into public.settings_addon_services(key,name,sort_order)
select 'radon','Radonindikering',300
where not exists(select 1 from public.settings_addon_services where lower(key) in ('radon','radonindikering'))
on conflict do nothing;
insert into public.settings_addon_services(key,name,sort_order)
select 'mould','Mögelprov',310
where not exists(select 1 from public.settings_addon_services where lower(key) in ('mould','mold','mogelprov','mogel'))
on conflict do nothing;
create table if not exists public.inspection_environmental_protocols (
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  org_id uuid not null, kind text not null check (kind in ('radon','mould')),
  document jsonb not null check (jsonb_typeof(document)='object'),
  revision integer not null default 1 check (revision > 0), updated_at timestamptz not null default now(),
  primary key (inspection_id,kind)
);
create table if not exists public.inspection_environmental_files (
  id uuid primary key, inspection_id uuid not null references public.inspections(id),
  org_id uuid not null, kind text not null check (kind in ('radon','mould')),
  name text not null, path text not null unique, sha256 text not null,
  size integer not null check (size > 0 and size <= 4194304), created_at timestamptz not null default now()
);
alter table public.inspection_environmental_protocols enable row level security;
alter table public.inspection_environmental_files enable row level security;
revoke all on public.inspection_environmental_protocols,public.inspection_environmental_files from anon,authenticated;
grant select on public.inspection_environmental_protocols,public.inspection_environmental_files to authenticated;
grant all on public.inspection_environmental_protocols,public.inspection_environmental_files to service_role;
drop policy if exists environmental_read on public.inspection_environmental_protocols;
create policy environmental_read on public.inspection_environmental_protocols for select to authenticated using (
  exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id where i.id=inspection_id and p.owner=auth.uid())
  and exists(select 1 from public.org_members m where m.org_id=inspection_environmental_protocols.org_id and m.profile_id=auth.uid() and m.is_active)
);
drop policy if exists environmental_read on public.inspection_environmental_files;
create policy environmental_read on public.inspection_environmental_files for select to authenticated using (
  exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id where i.id=inspection_id and p.owner=auth.uid())
  and exists(select 1 from public.org_members m where m.org_id=inspection_environmental_files.org_id and m.profile_id=auth.uid() and m.is_active)
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ob-environmental-files','ob-environmental-files',false,4194304,array['application/pdf'])
on conflict(id) do nothing;

create or replace function public.ob_environmental_command(p_inspection_id uuid,p_org_id uuid,p_actor uuid,p_kind text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.inspection_environmental_protocols; d jsonb; f jsonb;
begin
  perform public.ob_building_access(p_inspection_id,p_org_id,p_actor,false);
  if p_kind is null or p_kind not in ('radon','mould') then raise exception 'OB_ENV_INVALID'; end if;
  -- Serialize edits with inspection locking/publication and other editors.
  perform 1 from public.inspections where id=p_inspection_id for update;
  select * into v from public.inspection_environmental_protocols where inspection_id=p_inspection_id and kind=p_kind;
  if v.org_id is not null and v.org_id<>p_org_id then raise exception 'OB_ROUND_FORBIDDEN'; end if;
  if p_operation='read' then
    return jsonb_build_object('document',v.document,'revision',coalesce(v.revision,0),'files',
      (select coalesce(jsonb_agg(to_jsonb(x) order by created_at),'[]') from public.inspection_environmental_files x where inspection_id=p_inspection_id and org_id=p_org_id and kind=p_kind));
  end if;
  perform public.ob_building_access(p_inspection_id,p_org_id,p_actor,true);
  if p_operation='save' then
    if coalesce((p_payload->>'revision')::integer,-1)<>coalesce(v.revision,0) then raise exception 'OB_ENV_CONFLICT'; end if;
    d:=p_payload->'document';
    if d->'schema' is distinct from '1'::jsonb or jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(d->'rows') is distinct from 'array'
      or jsonb_typeof(d->'include') is distinct from 'boolean' or jsonb_typeof(d->'attachments') is distinct from 'array'
      or length(d::text)>200000 then raise exception 'OB_ENV_INVALID'; end if;
    if jsonb_array_length(d->'rows')>100 or jsonb_array_length(d->'attachments')>20 then raise exception 'OB_ENV_INVALID'; end if;
    if exists(select 1 from jsonb_array_elements_text(d->'attachments') a(id) where not exists(
      select 1 from public.inspection_environmental_files x where x.id::text=a.id and x.inspection_id=p_inspection_id and x.org_id=p_org_id and x.kind=p_kind)) then raise exception 'OB_ENV_INVALID'; end if;
    insert into public.inspection_environmental_protocols(inspection_id,org_id,kind,document,revision)
    values(p_inspection_id,p_org_id,p_kind,d,coalesce(v.revision,0)+1)
    on conflict(inspection_id,kind) do update set document=excluded.document,revision=excluded.revision,updated_at=now();
    return jsonb_build_object('revision',coalesce(v.revision,0)+1);
  elsif p_operation='file' then
    f:=p_payload;
    if nullif(f->>'id','') is null or f->>'path' is distinct from p_org_id::text||'/'||p_inspection_id::text||'/'||p_kind||'/'||(f->>'id')||'.pdf'
      or coalesce(f->>'sha256','') !~ '^[0-9a-f]{64}$' or coalesce(length(f->>'name'),0) not between 1 and 200 then raise exception 'OB_ENV_INVALID'; end if;
    insert into public.inspection_environmental_files(id,inspection_id,org_id,kind,name,path,sha256,size)
    values((f->>'id')::uuid,p_inspection_id,p_org_id,p_kind,f->>'name',f->>'path',f->>'sha256',(f->>'size')::integer);
    return f;
  end if;
  raise exception 'OB_ENV_INVALID';
end $$;
revoke all on function public.ob_environmental_command(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ob_environmental_command(uuid,uuid,uuid,text,text,jsonb) to service_role;
commit;
