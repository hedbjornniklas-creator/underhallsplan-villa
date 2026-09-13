-- STAGING ONLY: incremental repair for installations with app access already applied.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton
    AND project_ref='lodbgdbmfdtdzfaezblx' AND ready AND building_phase=4) THEN
    RAISE EXCEPTION 'VERIFIED_STAGING_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.ob_building_conditions'::regclass
    AND relrowsecurity) OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid='public.ob_building_conditions'::regclass
      AND polname='ob_building_owner_read' AND polcmd='r'
  ) THEN RAISE EXCEPTION 'CONDITIONS_RLS_REQUIRED'; END IF;
END $$;
-- Writes remain server-managed building commands; do not grant browser mutation.
GRANT SELECT ON public.ob_building_conditions TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
