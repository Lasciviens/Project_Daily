-- 094: atomic cover linking and explicit ES-DE variant deletion.
-- No new tables or client fields. Service-role-only RPCs: the edge function
-- authenticates the handheld secret and supplies HEVY_USER_ID server-side.
-- SECURITY INVOKER; public/anon/authenticated cannot execute these functions.

CREATE OR REPLACE FUNCTION public.esde_link_cover(
  p_user_id uuid, p_variant_id uuid, p_url text, p_managed_prefix text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.game_platforms; g public.games; old_url text;
BEGIN
  IF p_user_id IS NULL OR p_url IS NULL OR p_managed_prefix IS NULL
     OR p_managed_prefix = '' OR left(p_url, length(p_managed_prefix)) <> p_managed_prefix THEN
    RAISE EXCEPTION 'Invalid cover arguments';
  END IF;
  SELECT * INTO v FROM public.game_platforms WHERE id=p_variant_id AND user_id=p_user_id AND external_source='esde';
  IF NOT FOUND THEN RAISE EXCEPTION 'ES-DE variant not found'; END IF;
  SELECT * INTO g FROM public.games WHERE id=v.game_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found'; END IF;
  SELECT * INTO v FROM public.game_platforms WHERE id=p_variant_id AND user_id=p_user_id AND external_source='esde' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ES-DE variant disappeared'; END IF;
  old_url := v.cover_url;
  IF old_url IS NOT NULL AND left(old_url,length(p_managed_prefix)) <> p_managed_prefix THEN
    RETURN jsonb_build_object('linked',false,'manual_cover',true);
  END IF;
  UPDATE public.game_platforms SET cover_url=p_url WHERE id=v.id AND user_id=p_user_id;
  IF g.primary_cover_url IS NULL OR g.primary_cover_url=old_url THEN
    UPDATE public.games SET primary_cover_url=p_url WHERE id=g.id AND user_id=p_user_id;
  END IF;
  RETURN jsonb_build_object('linked',true,'old_url',old_url);
END $$;
REVOKE ALL ON FUNCTION public.esde_link_cover(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esde_link_cover(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.esde_delete_variants(p_user_id uuid, p_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  item jsonb; v public.game_platforms; gid uuid; affected uuid[] := '{}';
  removed_ids uuid[] := '{}'; removed_urls text[] := '{}'; removed_games integer := 0;
  candidate_ids uuid[]; before_count integer; after_count integer;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_entries) < 1 OR jsonb_array_length(p_entries) > 150 THEN
    RAISE EXCEPTION 'Expected 1-150 explicit deletion entries';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF nullif(item->>'id','') IS NULL OR nullif(item->>'system','') IS NULL
       OR nullif(item->>'path','') IS NULL OR nullif(item->>'updated_at','') IS NULL THEN
      RAISE EXCEPTION 'Incomplete deletion identity';
    END IF;
  END LOOP;
  SELECT array_agg((value->>'id')::uuid) INTO candidate_ids FROM jsonb_array_elements(p_entries);
  -- Lock parents before variants, consistently with cover linking. FK key-share
  -- locks prevent a concurrent platform insertion from being cascaded away.
  PERFORM g.id FROM public.games g WHERE g.user_id=p_user_id AND g.id IN (
    SELECT p.game_id FROM public.game_platforms p WHERE p.user_id=p_user_id
      AND p.external_source='esde' AND p.id=ANY(candidate_ids)
  ) ORDER BY g.id FOR UPDATE;
  FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    SELECT * INTO v FROM public.game_platforms
      WHERE id=(item->>'id')::uuid AND user_id=p_user_id AND external_source='esde' FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF; -- idempotent retry after a committed delete
    IF v.esde_system IS DISTINCT FROM item->>'system' OR v.esde_path IS DISTINCT FROM item->>'path'
       OR v.updated_at IS DISTINCT FROM (item->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'ES-DE variant changed since inventory; rescan before deleting';
    END IF;
    affected := array_append(affected,v.game_id);
    removed_ids := array_append(removed_ids,v.id);
    IF v.cover_url IS NOT NULL THEN removed_urls := array_append(removed_urls,v.cover_url); END IF;
    DELETE FROM public.game_platforms WHERE id=v.id AND user_id=p_user_id AND external_source='esde';
  END LOOP;
  FOR gid IN SELECT DISTINCT unnest(affected) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.game_platforms WHERE game_id=gid AND user_id=p_user_id) THEN
      DELETE FROM public.games WHERE id=gid AND user_id=p_user_id AND external_source='esde';
      GET DIAGNOSTICS before_count = ROW_COUNT;
      removed_games := removed_games + before_count;
    END IF;
    -- Preserve games with another platform/source, updating only ES-DE-owned
    -- roll-ups and a primary cover that referenced a removed platform cover.
    UPDATE public.games g SET
      esde_playcount=(SELECT sum(p.esde_playcount) FROM public.game_platforms p WHERE p.game_id=g.id AND p.user_id=p_user_id),
      esde_playtime_seconds=(SELECT sum(p.esde_playtime_seconds) FROM public.game_platforms p WHERE p.game_id=g.id AND p.user_id=p_user_id),
      esde_last_played=(SELECT max(p.esde_last_played) FROM public.game_platforms p WHERE p.game_id=g.id AND p.user_id=p_user_id),
      primary_cover_url=CASE WHEN g.primary_cover_url=ANY(removed_urls) THEN
        (SELECT p.cover_url FROM public.game_platforms p WHERE p.game_id=g.id AND p.user_id=p_user_id AND p.cover_url IS NOT NULL ORDER BY p.is_primary_variant DESC NULLS LAST,p.id LIMIT 1)
        ELSE g.primary_cover_url END
      WHERE g.id=gid AND g.user_id=p_user_id;
  END LOOP;
  RETURN jsonb_build_object('deleted_variants',cardinality(removed_ids),'deleted_games',removed_games,'variant_ids',removed_ids);
END $$;
REVOKE ALL ON FUNCTION public.esde_delete_variants(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esde_delete_variants(uuid,jsonb) TO service_role;
