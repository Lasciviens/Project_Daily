-- Rollback-only integration test for migration 094. No real game is modified.
BEGIN;
DO $$
DECLARE
  owner_id uuid; g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v3 uuid := gen_random_uuid();
  stamp timestamptz; r jsonb; entries jsonb;
  prefix text := 'https://test.invalid/esde/';
BEGIN
  SELECT user_id INTO STRICT owner_id FROM public.game_platforms WHERE external_source='esde' LIMIT 1;
  INSERT INTO public.games(id,user_id,title,external_source,play_notes) VALUES
    (g1,owner_id,'ESDE RPC rollback test','esde','keep notes'),
    (g2,owner_id,'ESDE RPC rollback test','esde','keep notes');
  INSERT INTO public.game_platforms(id,user_id,game_id,system,external_source,esde_system,esde_path,esde_playcount) VALUES
    (v1,owner_id,g1,'NES','esde','nes','./rpc-test-a.nes',2),
    (v2,owner_id,g1,'SNES','manual',NULL,NULL,4),
    (v3,owner_id,g2,'NES','esde','nes','./rpc-test-b.nes',3);
  r := public.esde_link_cover(owner_id,v1,prefix||'cover.webp',prefix);
  IF r->>'linked' <> 'true' OR (SELECT primary_cover_url FROM public.games WHERE id=g1) <> prefix||'cover.webp' THEN
    RAISE EXCEPTION 'Cover not linked';
  END IF;
  UPDATE public.game_platforms SET cover_url='https://manual.invalid/cover.jpg' WHERE id=v1 AND user_id=owner_id;
  r := public.esde_link_cover(owner_id,v1,prefix||'new.webp',prefix);
  IF r->>'manual_cover' <> 'true' THEN RAISE EXCEPTION 'Manual cover overwritten'; END IF;
  UPDATE public.game_platforms SET cover_url=prefix||'cover.webp' WHERE id=v1 AND user_id=owner_id;
  SELECT updated_at INTO stamp FROM public.game_platforms WHERE id=v1;
  entries := jsonb_build_array(jsonb_build_object('id',v1,'system','nes','path','./rpc-test-a.nes','updated_at',stamp));
  r := public.esde_delete_variants(gen_random_uuid(),entries);
  IF r->>'deleted_variants' <> '0' THEN RAISE EXCEPTION 'Cross-user deletion'; END IF;
  BEGIN
    PERFORM public.esde_delete_variants(owner_id,jsonb_build_array(
      entries->0,
      jsonb_build_object('id',v3,'system','nes','path','./rpc-test-b.nes','updated_at','2000-01-01T00:00:00Z')));
    RAISE EXCEPTION 'Expected stale rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since inventory%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.game_platforms WHERE id=v1) THEN RAISE EXCEPTION 'Batch not atomic'; END IF;
  r := public.esde_delete_variants(owner_id,entries);
  IF r->>'deleted_variants' <> '1' OR r->>'deleted_games' <> '0' THEN RAISE EXCEPTION 'Wrong deletion counts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.games WHERE id=g1 AND play_notes='keep notes' AND esde_playcount=4 AND primary_cover_url IS NULL) THEN
    RAISE EXCEPTION 'Other platform, notes or rollup lost';
  END IF;
  r := public.esde_delete_variants(owner_id,entries);
  IF r->>'deleted_variants' <> '0' THEN RAISE EXCEPTION 'Retry not idempotent'; END IF;
  SELECT updated_at INTO stamp FROM public.game_platforms WHERE id=v3;
  r := public.esde_delete_variants(owner_id,jsonb_build_array(jsonb_build_object('id',v3,'system','nes','path','./rpc-test-b.nes','updated_at',stamp)));
  IF r->>'deleted_games' <> '1' OR EXISTS (SELECT 1 FROM public.games WHERE id=g2) THEN RAISE EXCEPTION 'Orphan game retained'; END IF;
  IF has_function_privilege('anon','public.esde_delete_variants(uuid,jsonb)','execute')
     OR has_function_privilege('authenticated','public.esde_link_cover(uuid,uuid,text,text)','execute') THEN
    RAISE EXCEPTION 'RPC exposed to client role';
  END IF;
END $$;
SELECT 'ES-DE cover/delete RPC checks passed; changes rolled back' AS result;
ROLLBACK;
