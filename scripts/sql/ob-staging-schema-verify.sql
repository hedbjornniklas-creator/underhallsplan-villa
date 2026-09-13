BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog;
WITH functions AS MATERIALIZED (
  SELECT p.oid,p.oid::regprocedure::text AS signature,
    md5(replace(pg_get_functiondef(p.oid),chr(13),'')) AS normalized_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
), report AS (
  SELECT jsonb_build_object(
    'project_ref',(SELECT project_ref FROM ob_staging_control.installation),
    'completed_part',(SELECT completed_part FROM ob_staging_control.installation),
    'ready',(SELECT ready FROM ob_staging_control.installation),
    'building_phase',(SELECT building_phase FROM ob_staging_control.installation),
    'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
    'constraints',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype IN ('p','u','f','c')),
    'indexes',(SELECT count(*) FROM pg_indexes WHERE schemaname='public'),
    'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
    'triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
    'functions',(SELECT count(*) FROM functions),
    'functions_normalized_md5',(SELECT md5(string_agg(signature||':'||normalized_md5,chr(10) ORDER BY signature COLLATE "C")) FROM functions),
    'client_table_access',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v')
      AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))),
    'client_function_execute',(SELECT count(*) FROM functions WHERE has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE')),
    'auth_users',(SELECT count(*) FROM auth.users),
    'storage_objects',(SELECT count(*) FROM storage.objects),
    'storage_buckets',(SELECT count(*) FROM storage.buckets)
  ) AS payload
)
SELECT key,value FROM report CROSS JOIN LATERAL jsonb_each_text(payload) ORDER BY key;
ROLLBACK;
