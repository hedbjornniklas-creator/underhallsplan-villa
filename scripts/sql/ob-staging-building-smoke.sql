-- STAGING ONLY. Synthetic, transactional checks; every fixture is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = public, extensions, pg_catalog;
DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton
    AND project_ref='lodbgdbmfdtdzfaezblx' AND ready
    AND source_sha256='7d53203bab004265bbc69f5b22e498e71dfa07490af736b0b66775c6d325827e') THEN
    RAISE EXCEPTION 'VERIFIED_STAGING_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ob_building_rollout WHERE enabled) THEN
    RAISE EXCEPTION 'EXPECTED_ROLLOUT_OFF_BEFORE_TEST';
  END IF;
END $guard$;
CREATE TEMP TABLE ob_smoke_results (test text, passed boolean) ON COMMIT DROP;
DO $test$
#variable_conflict use_variable
DECLARE
  actor uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); org uuid := gen_random_uuid();
  prop uuid := gen_random_uuid(); insp uuid := gen_random_uuid(); room uuid := gen_random_uuid();
  note uuid := gen_random_uuid(); photo uuid := gen_random_uuid(); extra_room uuid := gen_random_uuid();
  main uuid; garage uuid; overview jsonb; changed jsonb; request jsonb; name text; blocked boolean;
  original_photo jsonb; original_note jsonb; original_room jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,'ob-staging-owner@example.invalid'),(stranger,'ob-staging-stranger@example.invalid');
  INSERT INTO profiles(id) VALUES(actor),(stranger);
  INSERT INTO organizations(id,name) VALUES(org,'Synthetic OB staging organization');
  INSERT INTO org_members(org_id,profile_id,role,is_active) VALUES(org,actor,'inspector',true),(org,stranger,'inspector',true);
  INSERT INTO properties(id,name,owner) VALUES(prop,'Synthetic OB staging property',actor);
  INSERT INTO inspections(id,property_id,type,inspection_family,cover_path) VALUES(insp,prop,'OB','OB','staging-only/original-cover.jpg');
  INSERT INTO inspection_interior_rooms(id,inspection_id,floor_label,room_type_key,room_label)
    VALUES(room,insp,'plan1','hall','Original room');
  INSERT INTO inspection_control_items(id,inspection_id,interior_room_id,title,note)
    VALUES(note,insp,room,'Synthetic note','Keep this original text');
  INSERT INTO inspection_images(id,inspection_id,interior_room_id,origin_interior_room_id,control_item_id,file_path)
    VALUES(photo,insp,room,room,note,'staging-only/original-image.jpg');
  SELECT to_jsonb(t) INTO original_photo FROM inspection_images t WHERE id=photo;
  SELECT to_jsonb(t) INTO original_note FROM inspection_control_items t WHERE id=note;
  SELECT to_jsonb(t) INTO original_room FROM inspection_interior_rooms t WHERE id=room;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  overview := ob_building_get(insp,org,actor);
  IF (overview->>'available')::boolean OR overview->'structure' <> 'null'::jsonb THEN RAISE EXCEPTION 'LEGACY_ENROLLED_WITH_ROLLOUT_OFF'; END IF;
  UPDATE ob_building_rollout SET enabled=true;
  overview := ob_building_get(insp,org,actor);
  request := jsonb_build_object('requestId',gen_random_uuid(),'name','Main building','buildingId',null,
    'confirmed',true,'activationToken',overview->>'activationToken');
  overview := ob_building_command(insp,org,actor,'activate',request);
  main := (overview->'parts'->0->>'id')::uuid;
  IF main IS NULL THEN RAISE EXCEPTION 'PRIMARY_PART_MISSING'; END IF;
  IF (SELECT (to_jsonb(t)-ARRAY['building_part_id','origin_building_part_id','ob_revision','updated_at'])
    IS DISTINCT FROM (original_photo-ARRAY['building_part_id','origin_building_part_id','ob_revision','updated_at']) FROM inspection_images t WHERE id=photo)
    OR (SELECT (to_jsonb(t)-ARRAY['building_part_id','ob_revision','updated_at']) IS DISTINCT FROM
      (original_note-ARRAY['building_part_id','ob_revision','updated_at']) FROM inspection_control_items t WHERE id=note)
    OR (SELECT (to_jsonb(t)-ARRAY['building_part_id','ob_revision','updated_at']) IS DISTINCT FROM
      (original_room-ARRAY['building_part_id','ob_revision','updated_at']) FROM inspection_interior_rooms t WHERE id=room) THEN
    RAISE EXCEPTION 'LEGACY_CONTENT_CHANGED';
  END IF;
  INSERT INTO ob_smoke_results VALUES('legacy IDs, content, floors and image references preserved',true);
  FOREACH name IN ARRAY ARRAY['Garage','Guesthouse','Workshop'] LOOP
    overview := ob_building_command(insp,org,actor,'add',jsonb_build_object('requestId',gen_random_uuid(),
      'name',name,'categoryKey','garage','buildingId',null));
  END LOOP;
  IF jsonb_array_length(overview->'parts') <> 4 THEN RAISE EXCEPTION 'EXPECTED_FOUR_BUILDINGS'; END IF;
  SELECT (part->>'id')::uuid INTO garage FROM jsonb_array_elements(overview->'parts') part WHERE part->>'name'='Garage';
  changed := ob_building_write_row(insp,org,actor,jsonb_build_object('requestId',gen_random_uuid(),
    'table','inspection_interior_rooms','partId',garage,'id',extra_room,'operation','insert',
    'row',jsonb_build_object('floor_label','plan0','room_type_key','hall','room_label','Garage room')));
  INSERT INTO ob_smoke_results VALUES('four buildings with a separate Plan 0 room',true);
  blocked := false;
  BEGIN
    PERFORM ob_building_write_row(insp,org,actor,jsonb_build_object('requestId',gen_random_uuid(),
      'table','inspection_control_items','partId',main,'id',gen_random_uuid(),'operation','insert',
      'row',jsonb_build_object('interior_room_id',extra_room,'title','Wrong building')));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%OB_ROUND_FOREIGN%' THEN RAISE; END IF; blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CROSS_BUILDING_WRITE_ALLOWED'; END IF;
  blocked := false;
  BEGIN PERFORM ob_building_get(insp,org,stranger);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%OB_ROUND_FORBIDDEN%' THEN RAISE; END IF; blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FOREIGN_ACTOR_ALLOWED'; END IF;
  INSERT INTO ob_smoke_results VALUES('foreign actor and wrong-building writes rejected',true);
  request := jsonb_build_object('requestId',gen_random_uuid(),'kind','room','id',room,
    'from',jsonb_build_object('floor','plan1'),'floor','plan0','targetBuildingPartId',garage);
  changed := ob_building_round_mutate(insp,org,actor,'move',request,main);
  IF ob_building_round_mutate(insp,org,actor,'move',request,main) IS DISTINCT FROM changed THEN RAISE EXCEPTION 'RETRY_CHANGED_RESULT'; END IF;
  IF (SELECT building_part_id FROM inspection_control_items WHERE id=note) IS DISTINCT FROM garage
    OR (SELECT building_part_id FROM inspection_images WHERE id=photo) IS DISTINCT FROM garage
    OR (SELECT origin_building_part_id FROM inspection_images WHERE id=photo) IS DISTINCT FROM main
    OR (SELECT file_path FROM inspection_images WHERE id=photo) IS DISTINCT FROM 'staging-only/original-image.jpg' THEN
    RAISE EXCEPTION 'ROOM_MOVE_LOST_LINKS_OR_ORIGIN';
  END IF;
  INSERT INTO ob_smoke_results VALUES('room move keeps notes, photos, capture origin and retry result',true);
  UPDATE inspections SET locked_at=now() WHERE id=insp;
  blocked := false;
  BEGIN
    PERFORM ob_building_command(insp,org,actor,'add',jsonb_build_object('requestId',gen_random_uuid(),
      'name','Blocked building','categoryKey','garage','buildingId',null));
  EXCEPTION WHEN OTHERS THEN
    IF upper(SQLERRM) NOT LIKE '%LOCKED%' THEN RAISE; END IF; blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'LOCKED_INSPECTION_CHANGED'; END IF;
  INSERT INTO ob_smoke_results VALUES('locked inspection rejects new building',true);
END $test$;
SELECT test, passed FROM ob_smoke_results ORDER BY test;
ROLLBACK;
