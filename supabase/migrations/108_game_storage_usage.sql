-- 108 · What one game keeps, for its detail panel and the scrape review.
--
-- Files in the game-media bucket, split the same way game_media_usage() (104)
-- splits the whole bucket:
--   screenscraper  ScreenScraper copies, stored under '<game id>/…'
--   esde_cover     the handheld's optimized cover a variant's cover_url shows
--   esde_original  the handheld's original images, '<user>/esde/<variant id>/…'
-- plus one 'database' row: the on-disk size of the game's own rows (games,
-- game_platforms, game_scrape_records, scrape_decisions).
--
-- SECURITY DEFINER because storage.objects is not readable by the browser; the
-- function answers only for a game the caller owns (auth.uid()), so it reveals
-- nothing about anyone else. Read-only; changes no row.

CREATE OR REPLACE FUNCTION public.game_storage_usage(p_game_id uuid)
RETURNS TABLE (category text, files bigint, bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH g AS (
    SELECT gm.id, gm.user_id FROM public.games gm
    WHERE gm.id = p_game_id AND gm.user_id = auth.uid()
  ),
  variants AS (
    SELECT p.id, substring(p.cover_url FROM '/object/public/game-media/(.*)$') AS cover_name
    FROM public.game_platforms p JOIN g ON p.game_id = g.id
  ),
  objs AS (
    SELECT o.name, coalesce((o.metadata->>'size')::bigint, 0) AS size,
           CASE
             WHEN o.name LIKE g.id::text || '/%' THEN 'screenscraper'
             WHEN EXISTS (SELECT 1 FROM variants v WHERE v.cover_name = o.name) THEN 'esde_cover'
             ELSE 'esde_original'
           END AS category
    FROM storage.objects o CROSS JOIN g
    WHERE o.bucket_id = 'game-media'
      AND (o.name LIKE g.id::text || '/%'
           OR EXISTS (SELECT 1 FROM variants v WHERE o.name LIKE g.user_id::text || '/esde/' || v.id::text || '/%'))
  ),
  files AS (
    SELECT objs.category, count(*)::bigint AS files, sum(objs.size)::bigint AS bytes
    FROM objs GROUP BY objs.category
  ),
  db AS (
    SELECT 'database'::text AS category,
           (1 + (SELECT count(*) FROM public.game_platforms p JOIN g ON p.game_id = g.id)
              + (SELECT count(*) FROM public.game_scrape_records r JOIN g ON r.game_id = g.id)
              + (SELECT count(*) FROM public.scrape_decisions d JOIN g ON d.game_id = g.id))::bigint AS files,
           (coalesce((SELECT sum(pg_column_size(gm.*)) FROM public.games gm JOIN g ON gm.id = g.id), 0)
            + coalesce((SELECT sum(pg_column_size(p.*)) FROM public.game_platforms p JOIN g ON p.game_id = g.id), 0)
            + coalesce((SELECT sum(pg_column_size(r.*)) FROM public.game_scrape_records r JOIN g ON r.game_id = g.id), 0)
            + coalesce((SELECT sum(pg_column_size(d.*)) FROM public.scrape_decisions d JOIN g ON d.game_id = g.id), 0))::bigint AS bytes
    FROM g
  )
  SELECT * FROM files
  UNION ALL
  SELECT * FROM db
$$;

REVOKE ALL ON FUNCTION public.game_storage_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_storage_usage(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.game_storage_usage(uuid) IS
  'Files (by category) and database bytes one game keeps; answers only for the caller''s own game.';
