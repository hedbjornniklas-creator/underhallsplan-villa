-- STAGING ONLY. Run after the guarded 09/10 rehearsal, not in production.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton
    AND project_ref='lodbgdbmfdtdzfaezblx' AND ready AND building_phase=4) THEN
    RAISE EXCEPTION 'VERIFIED_STAGING_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.inspection_images'::regclass
    AND polname='inspection_access_boundary' AND NOT polpermissive) THEN
    RAISE EXCEPTION 'ACCESS_REHEARSAL_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
    AND polname='inspection_media_owner_boundary' AND NOT polpermissive) THEN
    RAISE EXCEPTION 'STORAGE_REHEARSAL_REQUIRED';
  END IF;
END $$;

GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.properties,public.inspections,
  public.ob_property_snapshot,public.inspection_round_quick_notes,
  public.inspection_documents,public.inspection_disclosures TO authenticated;
GRANT SELECT ON public.inspection_floor_models, public.ob_inspection_structure,
  public.ob_inspection_buildings,public.ob_building_floor_models,
  public.ob_building_conditions TO authenticated;
GRANT SELECT ON public.assignments TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid),public.is_org_admin(uuid) TO authenticated;
-- Both are invoker functions: parent RLS still applies to their reads/updates.
GRANT EXECUTE ON FUNCTION public.set_inspection_ongoing_if_started(uuid),
  public.inspection_has_meaningful_content(uuid) TO authenticated;

-- Only configuration used by OB. No grants to maintenance-plan views or tables.
GRANT SELECT ON public.settings_interior_room_types,public.settings_interior_groups,
  public.settings_interior_options,public.settings_exterior_items,public.settings_exterior_groups,
  public.settings_exterior_options,public.settings_overview_items,public.settings_overview_groups,
  public.settings_overview_options,public.settings_control_points,public.settings_control_point_outcomes,
  public.settings_ob_building_categories,public.document_types TO authenticated;

-- Authenticated uploads still have to satisfy 10's restrictive owner/path policy.
CREATE POLICY ob_staging_storage_access ON storage.objects FOR ALL TO authenticated
  USING (bucket_id IN ('inspection-images','property-media'))
  WITH CHECK (bucket_id IN ('inspection-images','property-media'));

NOTIFY pgrst,'reload schema';
COMMIT;
