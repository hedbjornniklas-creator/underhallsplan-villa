-- DRAFT: separate security release, AFTER reviewed 09 and staging acceptance.
-- Changes ACLs and Storage policies only. No object/file/bucket/record changes.
-- Public download URLs remain public; this is NOT a private-image migration.
begin;
set local lock_timeout = '5s';
-- After approval only, add inside this transaction:
-- set local app.inspection_access_hardening_approved = 'true';
do $$
declare f record; function_oid oid;
begin
  if current_setting('app.inspection_access_hardening_approved',true) is distinct from 'true' then
    raise exception 'INSPECTION_ACCESS_REVIEW_REQUIRED';
  end if;
  if not exists(select 1 from pg_policy where polrelid='public.building_media'::regclass
    and polname='inspection_access_boundary' and not polpermissive) then
    raise exception 'INSPECTION_ACCESS_TABLE_HARDENING_REQUIRED';
  end if;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'INSPECTION_ACCESS_STORAGE_RLS_REQUIRED';
  end if;
  -- Installed definitions matched these repo definitions, with CRLF/LF bodies.
  -- Stop on later/unknown definitions instead of silently changing their contract.
  for f in select * from (values
    ('public.ensure_inspection_default_other_room_and_points(uuid)','06902b860e20f813e4f4aae6a729827a','6448c6c2a8e5eb8b22cb2de0674e7bb4'),
    ('public.lock_eb_inspection_report(uuid,uuid,uuid,uuid)','df8bc722c26e1eb4075eb1c6f8395fb3','969ddc8a3601ba34410bb691fb169414'),
    ('public.unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)','7bbae76d009e1db0849283dd9c07cba3','8d469538d340ee09aba2476aef6b9a3d'),
    ('public.unlock_tu_investigation_report(uuid,uuid,text,uuid)','8a7123812755f31745a7e3690a938354','3f1df97e3b7d4974c6759e39746c2ac8')
  ) as reviewed(signature,crlf_hash,lf_hash) loop
    function_oid := to_regprocedure(f.signature);
    if function_oid is null or md5(pg_get_functiondef(function_oid)) not in (f.crlf_hash,f.lf_hash) then
      raise exception 'INSPECTION_ACCESS_UNREVIEWED_FUNCTION: %',f.signature;
    end if;
    execute format('revoke all on function %s from public,anon,authenticated',function_oid::regprocedure);
    execute format('grant execute on function %s to service_role',function_oid::regprocedure);
    if has_function_privilege('anon',function_oid,'EXECUTE') or has_function_privilege('authenticated',function_oid,'EXECUTE') then
      raise exception 'INSPECTION_ACCESS_INHERITED_EXECUTE: %',f.signature;
    end if;
  end loop;
end $$;

-- Keep existing bucket policies but AND them with the real owner/path boundary.
-- This also limits object listing/signing; public asset serving bypasses RLS.
-- Other buckets and server-managed TU/EB uploads keep their existing rules.
drop policy if exists inspection_media_owner_boundary on storage.objects;
create policy inspection_media_owner_boundary on storage.objects
  as restrictive for all to public
  using (
    case when objects.bucket_id='inspection-images' then
      auth.uid() is not null and objects.name !~ '(^|/)\.\.?(/|$)' and position('/' in objects.name)>0 and
      exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
        where i.id::text=split_part(objects.name,'/',1) and p.owner=(select auth.uid()))
    when objects.bucket_id='property-media' then
      auth.uid() is not null and objects.name !~ '(^|/)\.\.?(/|$)' and position('/' in objects.name)>0 and (
        exists(select 1 from public.properties p where p.id::text=split_part(objects.name,'/',1) and p.owner=(select auth.uid()))
        or (split_part(objects.name,'/',1)='profiles' and split_part(objects.name,'/',2)=(select auth.uid())::text
          and split_part(objects.name,'/',3)<>'')
      )
    else true end
  )
  with check (
    case when objects.bucket_id='inspection-images' then
      auth.uid() is not null and objects.name !~ '(^|/)\.\.?(/|$)' and position('/' in objects.name)>0 and
      exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
        where i.id::text=split_part(objects.name,'/',1) and p.owner=(select auth.uid()))
    when objects.bucket_id='property-media' then
      auth.uid() is not null and objects.name !~ '(^|/)\.\.?(/|$)' and position('/' in objects.name)>0 and (
        exists(select 1 from public.properties p where p.id::text=split_part(objects.name,'/',1) and p.owner=(select auth.uid()))
        or (split_part(objects.name,'/',1)='profiles' and split_part(objects.name,'/',2)=(select auth.uid())::text
          and split_part(objects.name,'/',3)<>'')
      )
    else true end
  );
notify pgrst,'reload schema';
commit;
