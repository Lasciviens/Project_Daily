-- 131 · merge_games(keep_id, drop_id): two copies of one retro game become one.
--
-- The owner presses Merge in Games → Advanced → Duplicates after a preview;
-- nothing here runs on its own. One transaction: the kept row is updated, the
-- other copy's platform variants move over, the other copy is deleted.
--
-- ⚠ The rules are the SAME as src/features/games/test-game/tgMergeModel.ts,
-- which computes the preview the popup shows (verified by
-- scripts/verify-tg-merge.cjs). Change a rule in one → change it in the other.
--
--  - Only retro games (library 'retro'): a Steam/PlayStation row would be
--    re-created by its provider sync, so those are refused (hide them instead).
--  - The kept title never changes.
--  - Every game_platforms row of the removed copy is re-pointed to the kept
--    game. The ES-DE sync key (user_id, esde_system, esde_path, migration 093)
--    lives on that row, so the handheld's next push updates the moved variant
--    instead of creating the removed game again; its handheld pictures
--    ('<user>/esde/<variant id>/…') move with it. The kept primary stays
--    primary; moved variants become secondary — unless the kept game has no
--    primary, then the moved primary stays primary (one per game, 089's index).
--  - Empty text/picture fields of the kept game are filled from the other
--    (blank = NULL or only spaces). Genres and modes: case-insensitive union,
--    the kept game's spelling and order first.
--  - The ScreenScraper match (ss_jeu_id, ss_scraped_at, its game_scrape_records
--    row) and the IGDB match (igdb_*, ttb_*) move as a group, only when the
--    kept game has none. Everything else that points at the removed copy
--    (scrape_decisions, a record that did not move) goes with it (ON DELETE
--    CASCADE). Its ScreenScraper copies in Storage stay; any the kept game
--    does not show are found by "Find unused ScreenScraper copies".
--  - Status and rating: the kept game's. Its status is replaced only when it
--    is 'backlog' and the other has playing/completed/dropped/wishlist.
--  - play_notes and game_log: the other copy's text is appended below
--    E'\n\n— From the merged copy —\n'.
--  - is_coop / is_iconic: either. Play counts and seconds: summed. Latest last
--    played, finish and sync; earliest start, first play and created_at.
--    play_order: the lower of the two.
--
-- SECURITY DEFINER because game_scrape_records is read-only to the browser
-- (written by screenscraper-sync); every statement is scoped to auth.uid(),
-- and the function refuses rows the caller does not own.

CREATE OR REPLACE FUNCTION public.merge_games(keep_id uuid, drop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid := auth.uid();
  k            public.games%ROWTYPE;
  d            public.games%ROWTYPE;
  sep          constant text := E'\n\n— From the merged copy —\n';
  keep_primary boolean;
  moved        integer;
  take_ss      boolean;
  take_igdb    boolean;
  record_moved boolean := false;
  g_union      text[];
  m_union      text[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'merge_games: not signed in' USING ERRCODE = '42501';
  END IF;
  IF keep_id IS NULL OR drop_id IS NULL OR keep_id = drop_id THEN
    RAISE EXCEPTION 'merge_games: pick two different games' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in a fixed order so two merges can never deadlock.
  PERFORM 1 FROM public.games WHERE id IN (keep_id, drop_id) AND user_id = uid ORDER BY id FOR UPDATE;
  SELECT * INTO k FROM public.games WHERE id = keep_id AND user_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_games: the kept game was not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO d FROM public.games WHERE id = drop_id AND user_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_games: the other game was not found' USING ERRCODE = 'P0002'; END IF;
  IF k.library <> 'retro' OR d.library <> 'retro' THEN
    RAISE EXCEPTION 'merge_games: only retro games can be merged (a Steam or PlayStation sync would add the removed copy back)'
      USING ERRCODE = '22023';
  END IF;

  -- ── Platform variants ────────────────────────────────────────────────────
  keep_primary := EXISTS (SELECT 1 FROM public.game_platforms WHERE game_id = keep_id AND user_id = uid AND is_primary_variant);
  IF keep_primary THEN
    -- Before the move, or 089's one-primary-per-game index refuses it.
    UPDATE public.game_platforms SET is_primary_variant = false
     WHERE game_id = drop_id AND user_id = uid AND is_primary_variant;
  END IF;
  UPDATE public.game_platforms SET game_id = keep_id WHERE game_id = drop_id AND user_id = uid;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- ── Matches ──────────────────────────────────────────────────────────────
  take_ss := NULLIF(btrim(k.ss_jeu_id), '') IS NULL AND NULLIF(btrim(d.ss_jeu_id), '') IS NOT NULL;
  take_igdb := k.igdb_id IS NULL AND d.igdb_id IS NOT NULL;
  IF take_ss AND NOT EXISTS (SELECT 1 FROM public.game_scrape_records WHERE game_id = keep_id) THEN
    UPDATE public.game_scrape_records SET game_id = keep_id WHERE game_id = drop_id AND user_id = uid;
    record_moved := FOUND;
  END IF;

  -- ── Lists: case-insensitive union, kept spelling/order first ─────────────
  SELECT array_agg(v ORDER BY ord) INTO g_union FROM (
    SELECT DISTINCT ON (lower(btrim(x))) btrim(x) AS v, ord
      FROM unnest(coalesce(k.genres, '{}') || coalesce(d.genres, '{}')) WITH ORDINALITY AS u(x, ord)
     WHERE x IS NOT NULL AND btrim(x) <> ''
     ORDER BY lower(btrim(x)), ord
  ) s;
  SELECT array_agg(v ORDER BY ord) INTO m_union FROM (
    SELECT DISTINCT ON (lower(btrim(x))) btrim(x) AS v, ord
      FROM unnest(coalesce(k.modes, '{}') || coalesce(d.modes, '{}')) WITH ORDINALITY AS u(x, ord)
     WHERE x IS NOT NULL AND btrim(x) <> ''
     ORDER BY lower(btrim(x)), ord
  ) s;

  -- ── The kept row ─────────────────────────────────────────────────────────
  UPDATE public.games SET
    description       = CASE WHEN NULLIF(btrim(k.description), '') IS NULL AND NULLIF(btrim(d.description), '') IS NOT NULL THEN d.description ELSE k.description END,
    storyline         = CASE WHEN NULLIF(btrim(k.storyline), '') IS NULL AND NULLIF(btrim(d.storyline), '') IS NOT NULL THEN d.storyline ELSE k.storyline END,
    developer         = CASE WHEN NULLIF(btrim(k.developer), '') IS NULL AND NULLIF(btrim(d.developer), '') IS NOT NULL THEN d.developer ELSE k.developer END,
    publisher         = CASE WHEN NULLIF(btrim(k.publisher), '') IS NULL AND NULLIF(btrim(d.publisher), '') IS NOT NULL THEN d.publisher ELSE k.publisher END,
    series_name       = CASE WHEN NULLIF(btrim(k.series_name), '') IS NULL AND NULLIF(btrim(d.series_name), '') IS NOT NULL THEN d.series_name ELSE k.series_name END,
    players           = CASE WHEN NULLIF(btrim(k.players), '') IS NULL AND NULLIF(btrim(d.players), '') IS NOT NULL THEN d.players ELSE k.players END,
    age_rating        = CASE WHEN NULLIF(btrim(k.age_rating), '') IS NULL AND NULLIF(btrim(d.age_rating), '') IS NOT NULL THEN d.age_rating ELSE k.age_rating END,
    primary_cover_url = CASE WHEN NULLIF(btrim(k.primary_cover_url), '') IS NULL AND NULLIF(btrim(d.primary_cover_url), '') IS NOT NULL THEN d.primary_cover_url ELSE k.primary_cover_url END,
    screenshot_url    = CASE WHEN NULLIF(btrim(k.screenshot_url), '') IS NULL AND NULLIF(btrim(d.screenshot_url), '') IS NOT NULL THEN d.screenshot_url ELSE k.screenshot_url END,
    fanart_url        = CASE WHEN NULLIF(btrim(k.fanart_url), '') IS NULL AND NULLIF(btrim(d.fanart_url), '') IS NOT NULL THEN d.fanart_url ELSE k.fanart_url END,
    coop_notes        = CASE WHEN NULLIF(btrim(k.coop_notes), '') IS NULL AND NULLIF(btrim(d.coop_notes), '') IS NOT NULL THEN d.coop_notes ELSE k.coop_notes END,
    tier              = CASE WHEN NULLIF(btrim(k.tier), '') IS NULL AND NULLIF(btrim(d.tier), '') IS NOT NULL THEN d.tier ELSE k.tier END,
    provider_kind     = CASE WHEN NULLIF(btrim(k.provider_kind), '') IS NULL AND NULLIF(btrim(d.provider_kind), '') IS NOT NULL THEN d.provider_kind ELSE k.provider_kind END,
    release_year      = coalesce(k.release_year, d.release_year),
    -- The provider reference is a pair: never one half from each copy.
    external_source   = CASE WHEN NULLIF(btrim(k.external_source), '') IS NULL AND NULLIF(btrim(d.external_source), '') IS NOT NULL THEN d.external_source ELSE k.external_source END,
    external_ref      = CASE WHEN NULLIF(btrim(k.external_source), '') IS NULL AND NULLIF(btrim(d.external_source), '') IS NOT NULL THEN d.external_ref ELSE k.external_ref END,
    genres            = coalesce(g_union, k.genres),
    modes             = coalesce(m_union, k.modes),
    media             = CASE WHEN (k.media IS NULL OR k.media = '{}'::jsonb) AND d.media IS NOT NULL AND d.media <> '{}'::jsonb THEN d.media ELSE k.media END,

    ss_jeu_id         = CASE WHEN take_ss THEN d.ss_jeu_id ELSE k.ss_jeu_id END,
    ss_scraped_at     = CASE WHEN take_ss THEN d.ss_scraped_at ELSE k.ss_scraped_at END,
    -- The small ScreenScraper pointer (104) belongs to the match it describes.
    provider_data     = CASE WHEN take_ss THEN d.provider_data ELSE k.provider_data END,
    igdb_id            = CASE WHEN take_igdb THEN d.igdb_id ELSE k.igdb_id END,
    igdb_slug          = CASE WHEN take_igdb THEN d.igdb_slug ELSE k.igdb_slug END,
    igdb_url           = CASE WHEN take_igdb THEN d.igdb_url ELSE k.igdb_url END,
    igdb_match         = CASE WHEN take_igdb THEN d.igdb_match ELSE k.igdb_match END,
    igdb_matched_at    = CASE WHEN take_igdb THEN d.igdb_matched_at ELSE k.igdb_matched_at END,
    igdb_fetched_at    = CASE WHEN take_igdb THEN d.igdb_fetched_at ELSE k.igdb_fetched_at END,
    igdb_rating        = CASE WHEN take_igdb THEN d.igdb_rating ELSE k.igdb_rating END,
    igdb_rating_count  = CASE WHEN take_igdb THEN d.igdb_rating_count ELSE k.igdb_rating_count END,
    igdb_critic_rating = CASE WHEN take_igdb THEN d.igdb_critic_rating ELSE k.igdb_critic_rating END,
    igdb_critic_count  = CASE WHEN take_igdb THEN d.igdb_critic_count ELSE k.igdb_critic_count END,
    igdb_total_rating  = CASE WHEN take_igdb THEN d.igdb_total_rating ELSE k.igdb_total_rating END,
    igdb_total_count   = CASE WHEN take_igdb THEN d.igdb_total_count ELSE k.igdb_total_count END,
    ttb_main_seconds   = CASE WHEN take_igdb THEN d.ttb_main_seconds ELSE k.ttb_main_seconds END,
    ttb_extra_seconds  = CASE WHEN take_igdb THEN d.ttb_extra_seconds ELSE k.ttb_extra_seconds END,
    ttb_full_seconds   = CASE WHEN take_igdb THEN d.ttb_full_seconds ELSE k.ttb_full_seconds END,
    ttb_count          = CASE WHEN take_igdb THEN d.ttb_count ELSE k.ttb_count END,
    igdb_data          = CASE WHEN take_igdb THEN d.igdb_data ELSE k.igdb_data END,

    rating            = coalesce(k.rating, d.rating),
    play_status       = CASE WHEN k.play_status = 'backlog' AND d.play_status IN ('playing', 'completed', 'dropped', 'wishlist') THEN d.play_status ELSE k.play_status END,
    play_notes        = CASE WHEN NULLIF(btrim(d.play_notes), '') IS NULL THEN k.play_notes
                             WHEN NULLIF(btrim(k.play_notes), '') IS NULL THEN d.play_notes
                             ELSE k.play_notes || sep || d.play_notes END,
    game_log          = CASE WHEN NULLIF(btrim(d.game_log), '') IS NULL THEN k.game_log
                             WHEN NULLIF(btrim(k.game_log), '') IS NULL THEN d.game_log
                             ELSE k.game_log || sep || d.game_log END,
    is_coop           = k.is_coop OR d.is_coop,
    is_iconic         = k.is_iconic OR d.is_iconic,

    esde_playcount        = CASE WHEN k.esde_playcount IS NULL AND d.esde_playcount IS NULL THEN NULL ELSE coalesce(k.esde_playcount, 0) + coalesce(d.esde_playcount, 0) END,
    esde_playtime_seconds = CASE WHEN k.esde_playtime_seconds IS NULL AND d.esde_playtime_seconds IS NULL THEN NULL ELSE coalesce(k.esde_playtime_seconds, 0) + coalesce(d.esde_playtime_seconds, 0) END,
    play_count            = CASE WHEN k.play_count IS NULL AND d.play_count IS NULL THEN NULL ELSE coalesce(k.play_count, 0) + coalesce(d.play_count, 0) END,
    play_seconds          = CASE WHEN k.play_seconds IS NULL AND d.play_seconds IS NULL THEN NULL ELSE coalesce(k.play_seconds, 0) + coalesce(d.play_seconds, 0) END,
    -- greatest()/least() skip NULLs, which is the "the other one, if only one" rule.
    esde_last_played  = greatest(k.esde_last_played, d.esde_last_played),
    last_played_at    = greatest(k.last_played_at, d.last_played_at),
    started_at        = least(k.started_at, d.started_at),
    first_played_at   = least(k.first_played_at, d.first_played_at),
    finished_at       = greatest(k.finished_at, d.finished_at),
    synced_at         = greatest(k.synced_at, d.synced_at),
    created_at        = least(k.created_at, d.created_at),
    play_order        = least(k.play_order, d.play_order)
  WHERE id = keep_id AND user_id = uid;

  -- ── The removed copy (cascades scrape_decisions and an unmoved record) ───
  DELETE FROM public.games WHERE id = drop_id AND user_id = uid;

  RETURN jsonb_build_object(
    'kept', keep_id,
    'removed', drop_id,
    'moved_platforms', moved,
    'took_screenscraper', take_ss,
    'moved_scrape_record', record_moved,
    'took_igdb', take_igdb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_games(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_games(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.merge_games(uuid, uuid) IS
  'Merges two retro copies of one game: variants move to keep_id, empty fields are filled, play stats combined, drop_id deleted. Same rules as tgMergeModel.ts.';
