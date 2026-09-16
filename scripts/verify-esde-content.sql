-- Synthetic rollback-only test. No existing game or user metadata is changed.
BEGIN;
DO $$
DECLARE u uuid; gid uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); r jsonb;
  doc jsonb := '{"game":"<game id=\"1\"><favorite>true</favorite><unknown/><name>Raw</name></game>","context":{"system":"nes"}}';
  a jsonb; b jsonb;
BEGIN
  SELECT user_id INTO STRICT u FROM public.game_platforms WHERE external_source='esde' LIMIT 1;
  INSERT INTO public.games(id,user_id,title,external_source,play_notes,media,provider_data)
    VALUES(gid,u,'Curated title','screenscraper','Keep notes','{"fanart":"provider-url"}','{"provider":"preserve"}');
  INSERT INTO public.game_platforms(id,user_id,game_id,system,external_source,esde_system,esde_path)
    VALUES(vid,u,gid,'NES','esde','nes','./content-test.nes');
  r:=public.esde_save_content(u,vid,'source',jsonb_build_object('sha256',repeat('a',64),'document',doc));
  IF (SELECT esde_source FROM public.game_platforms WHERE id=vid) <> doc THEN RAISE EXCEPTION 'Source changed'; END IF;
  a:=jsonb_build_object('key','nes/fanart/content-test.png','asset',jsonb_build_object('sha256',repeat('b',64),'category','fanart','size',42));
  b:=jsonb_build_object('key','nes/screenshots/content-test.png','asset',jsonb_build_object('sha256',repeat('c',64),'category','screenshots','size',43));
  PERFORM public.esde_save_content(u,vid,'asset',a);
  PERFORM public.esde_save_content(u,vid,'asset',b);
  PERFORM public.esde_save_content(u,vid,'asset',a); -- retry does not drop the other category
  IF (SELECT count(*) FROM public.game_platforms p CROSS JOIN LATERAL jsonb_object_keys(p.esde_assets) k WHERE p.id=vid) <> 2 THEN
    RAISE EXCEPTION 'Asset merge/retry lost data';
  END IF;
  BEGIN
    PERFORM public.esde_save_content(gen_random_uuid(),vid,'source',jsonb_build_object('sha256',repeat('a',64),'document',doc));
    RAISE EXCEPTION 'Cross-owner write accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'ES-DE variant not found' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.esde_save_content(u,vid,'prune',jsonb_build_object('entries',jsonb_build_array(
      jsonb_build_object('key',a->>'key','sha256',repeat('b',64)),
      jsonb_build_object('key',b->>'key','sha256',repeat('d',64)))));
    RAISE EXCEPTION 'Stale asset deletion accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'Asset changed since inventory' THEN RAISE; END IF; END;
  IF NOT (SELECT esde_assets ? (a->>'key') FROM public.game_platforms WHERE id=vid) THEN RAISE EXCEPTION 'Prune not atomic'; END IF;
  r:=public.esde_save_content(u,vid,'prune',jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('key',a->>'key','sha256',repeat('b',64)))));
  IF (r->>'removed')::int <> 1 THEN RAISE EXCEPTION 'Prune failed'; END IF;
  r:=public.esde_save_content(u,vid,'prune',jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('key',a->>'key','sha256',repeat('b',64)))));
  IF (r->>'removed')::int <> 0 THEN RAISE EXCEPTION 'Prune retry not idempotent'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.games WHERE id=gid AND title='Curated title' AND play_notes='Keep notes'
    AND media='{"fanart":"provider-url"}'::jsonb AND provider_data='{"provider":"preserve"}'::jsonb) THEN RAISE EXCEPTION 'Curated/provider data changed'; END IF;
  IF has_function_privilege('anon','public.esde_save_content(uuid,uuid,text,jsonb)','execute')
    OR has_function_privilege('authenticated','public.esde_save_content(uuid,uuid,text,jsonb)','execute') THEN RAISE EXCEPTION 'RPC exposed'; END IF;
END $$;
SELECT 'content source, merge, owner scope, atomic prune, retry and preservation checks passed' AS result;
ROLLBACK;
