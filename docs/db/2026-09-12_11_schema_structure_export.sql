-- READ ONLY: schema review inventory, NOT executable restore SQL or a backup.
-- No application rows, auth users, image paths, bucket contents, sequence state,
-- role passwords, vault values, cron jobs or external-service credentials.
-- Function/default/policy definitions are source code: keep the result private
-- and review it for embedded configuration before importing or sharing it.
-- Scope: public objects plus auth/storage policies and public-function triggers.
-- Supabase-managed schemas are inventoried, not recreated by this export.
-- Download ALL result rows as CSV. The payload is split into plain-text parts
-- to avoid rendering a multi-megabyte JSON cell in the Supabase SQL Editor.
-- Verify/reassemble with scripts/verify-schema-structure-export.ps1.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '2s';
set local search_path = pg_catalog;

with relations as (
  select c.*, n.nspname as schema_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f','c')
), routines as (
  select p.*, n.nspname as schema_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
), app_types as (
  select t.*, n.nspname as schema_name
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  left join pg_class c on c.oid = t.typrelid
  where n.nspname = 'public' and t.typisdefined
    and (t.typrelid = 0 or c.relkind = 'c')
    and (t.typelem = 0 or t.typtype = 'd')
), triggers as (
  select t.*, n.nspname as schema_name, c.relname as table_name
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal and (n.nspname = 'public'
    or (n.nspname in ('auth','storage') and pn.nspname = 'public'))
), constraints as (
  select c.* from pg_constraint c where c.conrelid in (select oid from relations)
    or c.contypid in (select oid from app_types)
), rules as (
  select r.* from pg_rewrite r where r.ev_class in (select oid from relations)
), owned_objects as (
  select 'pg_class'::regclass::oid as class_id, oid as object_id from relations
  union all select 'pg_proc'::regclass, oid from routines
  union all select 'pg_type'::regclass, oid from app_types
  union all select 'pg_trigger'::regclass, oid from triggers
  union all select 'pg_constraint'::regclass, oid from constraints
  union all select 'pg_rewrite'::regclass, oid from rules
  union all select 'pg_attrdef'::regclass, oid from pg_attrdef
    where adrelid in (select oid from relations)
  union all select 'pg_class'::regclass, indexrelid from pg_index
    where indrelid in (select oid from relations)
), table_definitions as (
  select c.oid, c.schema_name, c.relname as name, c.relkind as kind,
    pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced, c.relreplident as replica_identity,
    c.relpersistence as persistence, c.reloptions as options,
    c.relacl::text as explicit_acl, c.relispartition as is_partition,
    case when c.relispartition then pg_get_expr(c.relpartbound,c.oid) end as partition_bound,
    case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end as partition_key,
    coalesce((select jsonb_agg(i.inhparent::regclass::text order by i.inhseqno)
      from pg_inherits i where i.inhrelid = c.oid),'[]'::jsonb) as parents
  from relations c
), column_definitions as (
  select c.schema_name, c.relname as relation_name, a.attnum as position,
    a.attname as name, format_type(a.atttypid,a.atttypmod) as data_type,
    a.attnotnull as not_null, a.attidentity as identity_kind,
    a.attgenerated as generated_kind, a.attislocal as is_local,
    pg_get_expr(d.adbin,d.adrelid) as default_expression,
    case when a.attcollation <> 0 then a.attcollation::regcollation::text end as collation,
    a.attacl::text as explicit_acl, a.attstorage as storage, a.attcompression as compression
  from relations c join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind <> 'S'
), function_definitions as (
  select p.oid, p.schema_name, p.oid::regprocedure::text as signature,
    p.prokind as kind, pg_get_userbyid(p.proowner) as owner,
    l.lanname as language, p.prosecdef as security_definer,
    p.proacl::text as explicit_acl,
    case when p.prokind <> 'a' then pg_get_functiondef(p.oid) end as definition,
    case when p.prokind <> 'a' then md5(pg_get_functiondef(p.oid)) end as definition_md5,
    exists(select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
      and d.objid = p.oid and d.deptype = 'e') as extension_owned
  from routines p join pg_language l on l.oid = p.prolang
), constraint_definitions as (
  select c.oid, c.conname as name, c.contype as kind,
    case when c.conrelid <> 0 then c.conrelid::regclass::text end as relation_name,
    case when c.contypid <> 0 then c.contypid::regtype::text end as domain_name,
    c.convalidated as validated, c.conislocal as is_local,
    c.connoinherit as no_inherit, pg_get_constraintdef(c.oid) as definition
  from constraints c
), index_definitions as (
  select i.indexrelid::regclass::text as name, i.indrelid::regclass::text as relation_name,
    i.indisvalid as valid, i.indisready as ready, i.indisreplident as replica_identity,
    pg_get_indexdef(i.indexrelid) as definition
  from pg_index i where i.indrelid in (select oid from relations)
), type_definitions as (
  select t.oid, t.schema_name, t.typname as name, t.typtype as kind,
    pg_get_userbyid(t.typowner) as owner, t.typnotnull as not_null,
    case when t.typbasetype <> 0 then format_type(t.typbasetype,t.typtypmod) end as base_type,
    pg_get_expr(t.typdefaultbin,0) as default_expression, t.typacl::text as explicit_acl,
    coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder)
      from pg_enum e where e.enumtypid = t.oid),'[]'::jsonb) as enum_labels,
    (select jsonb_build_object('subtype',r.rngsubtype::regtype::text,
      'collation',case when r.rngcollation <> 0 then r.rngcollation::regcollation::text end,
      'canonical',r.rngcanonical::regprocedure::text,
      'subtype_diff',r.rngsubdiff::regprocedure::text)
      from pg_range r where r.rngtypid = t.oid) as range_definition
  from app_types t
), sequence_definitions as (
  select s.seqrelid::regclass::text as name, s.seqtypid::regtype::text as data_type,
    s.seqstart as start_value, s.seqincrement as increment_by, s.seqmax as max_value,
    s.seqmin as min_value, s.seqcache as cache_size, s.seqcycle as cycle
  from pg_sequence s where s.seqrelid in (select oid from relations)
), view_definitions as (
  select c.schema_name, c.relname as name, c.relkind as kind,
    pg_get_userbyid(c.relowner) as owner, c.reloptions as options,
    pg_get_viewdef(c.oid) as definition
  from relations c where c.relkind in ('v','m')
), trigger_definitions as (
  select t.schema_name, t.table_name, t.tgname as name,
    t.tgenabled as enabled, t.tgfoid::regprocedure::text as function_name,
    pg_get_triggerdef(t.oid) as definition
  from triggers t
), event_trigger_definitions as (
  select t.evtname as name, t.evtevent as event, t.evtenabled as enabled,
    t.evttags as tags, t.evtfoid::regprocedure::text as function_name,
    pg_get_userbyid(t.evtowner) as owner
  from pg_event_trigger t
), rule_definitions as (
  select r.rulename as name, r.ev_class::regclass::text as relation_name,
    r.ev_enabled as enabled, pg_get_ruledef(r.oid) as definition
  from rules r where r.rulename <> '_RETURN'
), policy_definitions as (
  select schemaname as schema_name, tablename as table_name, policyname as name,
    permissive, roles, cmd as command, qual as using_expression, with_check as check_expression
  from pg_policies where schemaname in ('public','auth','storage')
), relation_grants as (
  select n.nspname as schema_name, c.relname as relation_name,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    pg_get_userbyid(a.grantor) as grantor, a.privilege_type, a.is_grantable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl,
    acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
  where c.oid in (select oid from relations)
    or (n.nspname = 'storage' and c.relname in ('objects','buckets'))
    or (n.nspname = 'auth' and c.relname = 'users')
), column_grants as (
  select c.schema_name, c.relname as relation_name, col.attname as column_name,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    pg_get_userbyid(a.grantor) as grantor, a.privilege_type, a.is_grantable
  from relations c join pg_attribute col on col.attrelid = c.oid
  cross join lateral aclexplode(col.attacl) a
  where col.attnum > 0 and not col.attisdropped
), function_grants as (
  select p.oid::regprocedure::text as signature,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    pg_get_userbyid(a.grantor) as grantor, a.privilege_type, a.is_grantable
  from routines p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
), default_grants as (
  select pg_get_userbyid(d.defaclrole) as owner,
    case when d.defaclnamespace = 0 then 'ALL SCHEMAS' else n.nspname end as schema_name,
    d.defaclobjtype as object_kind,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    pg_get_userbyid(a.grantor) as grantor, a.privilege_type, a.is_grantable
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 0 or n.nspname in ('public','auth','storage')
), namespace_definitions as (
  select n.nspname as name, pg_get_userbyid(n.nspowner) as owner, n.nspacl::text as explicit_acl
  from pg_namespace n where n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
), role_definitions as (
  select rolname as name, rolsuper as superuser, rolinherit as inherit,
    rolcreaterole as create_role, rolcreatedb as create_database, rolcanlogin as can_login,
    rolreplication as replication, rolbypassrls as bypass_rls from pg_roles
), role_memberships as (
  select pg_get_userbyid(m.roleid) as granted_role, pg_get_userbyid(m.member) as member,
    pg_get_userbyid(m.grantor) as grantor, m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m
), extension_definitions as (
  select e.extname as name, e.extversion as version, n.nspname as schema_name,
    pg_get_userbyid(e.extowner) as owner
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
), publication_definitions as (
  select p.pubname as name, pg_get_userbyid(p.pubowner) as owner,
    p.puballtables as all_tables, p.pubinsert as inserts, p.pubupdate as updates,
    p.pubdelete as deletes, p.pubtruncate as truncates, p.pubviaroot as via_root,
    coalesce((select jsonb_agg(jsonb_build_object('relation_name',r.prrelid::regclass::text,
      'columns',r.prattrs,'row_filter',pg_get_expr(r.prqual,r.prrelid)) order by r.prrelid)
      from pg_publication_rel r where r.prpubid = p.oid),'[]'::jsonb) as relations,
    coalesce((select jsonb_agg(n.nspname order by n.nspname)
      from pg_publication_namespace pn join pg_namespace n on n.oid = pn.pnnspid
      where pn.pnpubid = p.oid),'[]'::jsonb) as schemas
  from pg_publication p
), dependencies as (
  select d.classid::regclass::text as object_catalog, d.objid as object_id,
    d.objsubid as sub_id, pg_describe_object(d.classid,d.objid,d.objsubid) as object_description,
    d.refclassid::regclass::text as reference_catalog, d.refobjid as reference_id,
    d.refobjsubid as reference_sub_id,
    pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as reference_description,
    d.deptype as kind
  from pg_depend d join owned_objects o on o.class_id = d.classid and o.object_id = d.objid
), exposure_settings as (
  select coalesce(r.rolname,'ALL') as role_name, setting
  from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole
  cross join lateral unnest(s.setconfig) setting
  where setting like 'pgrst.db_schemas=%' or setting like 'pgrst.db_extra_search_path=%'
), sections as (
  select 'relations' as section, coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb) as payload from table_definitions t
  union all select 'columns',coalesce(jsonb_agg(to_jsonb(t) order by schema_name,relation_name,position),'[]'::jsonb) from column_definitions t
  union all select 'functions',coalesce(jsonb_agg(to_jsonb(t) order by signature),'[]'::jsonb) from function_definitions t
  union all select 'constraints',coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb) from constraint_definitions t
  union all select 'indexes',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from index_definitions t
  union all select 'types',coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb) from type_definitions t
  union all select 'sequences',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from sequence_definitions t
  union all select 'views',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from view_definitions t
  union all select 'triggers',coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from trigger_definitions t
  union all select 'event_triggers',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from event_trigger_definitions t
  union all select 'rules',coalesce(jsonb_agg(to_jsonb(t) order by relation_name,name),'[]'::jsonb) from rule_definitions t
  union all select 'policies',coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from policy_definitions t
  union all select 'relation_grants',coalesce(jsonb_agg(to_jsonb(t) order by schema_name,relation_name,grantee,privilege_type),'[]'::jsonb) from relation_grants t
  union all select 'column_grants',coalesce(jsonb_agg(to_jsonb(t) order by schema_name,relation_name,column_name,grantee,privilege_type),'[]'::jsonb) from column_grants t
  union all select 'function_grants',coalesce(jsonb_agg(to_jsonb(t) order by signature,grantee,privilege_type),'[]'::jsonb) from function_grants t
  union all select 'default_grants',coalesce(jsonb_agg(to_jsonb(t) order by owner,schema_name,object_kind,grantee,privilege_type),'[]'::jsonb) from default_grants t
  union all select 'namespaces',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from namespace_definitions t
  union all select 'roles',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from role_definitions t
  union all select 'role_memberships',coalesce(jsonb_agg(to_jsonb(t) order by granted_role,member),'[]'::jsonb) from role_memberships t
  union all select 'extensions',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from extension_definitions t
  union all select 'publications',coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from publication_definitions t
  union all select 'dependencies',coalesce(jsonb_agg(to_jsonb(t) order by object_catalog,object_id,sub_id,reference_catalog,reference_id,reference_sub_id,kind),'[]'::jsonb) from dependencies t
  union all select 'exposure_settings',coalesce(jsonb_agg(to_jsonb(t) order by role_name,setting),'[]'::jsonb) from exposure_settings t
), snapshot as materialized (
select jsonb_build_object(
  'format_version',1,
  'purpose','schema_review_not_restore',
  'scope','public_objects_and_managed_schema_access_metadata',
  'server_version',current_setting('server_version'),
  'transaction_read_only',current_setting('transaction_read_only'),
  'transaction_isolation',current_setting('transaction_isolation'),
  'sections',(select jsonb_object_agg(section,payload order by section) from sections),
  'counts',(select jsonb_object_agg(section,jsonb_array_length(payload) order by section) from sections)
)::text as json_text
), encoded as materialized (
  select replace(encode(convert_to(json_text,'UTF8'),'base64'),chr(10),'') as payload,
    octet_length(convert_to(json_text,'UTF8')) as json_bytes, md5(json_text) as json_md5
  from snapshot
)
select part_no, ceil(length(e.payload)::numeric / 32768)::integer as part_count,
  e.json_bytes, e.json_md5,
  substring(e.payload from ((part_no - 1) * 32768 + 1) for 32768) as payload_base64
from encoded e
cross join lateral generate_series(1,ceil(length(e.payload)::numeric / 32768)::integer) as part_no
order by part_no;
rollback;
