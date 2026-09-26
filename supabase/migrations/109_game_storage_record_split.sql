-- 109 · game_storage_usage (108) reports ScreenScraper's saved record
-- (game_scrape_records) as its own 'scrape_record' row instead of folding it
-- into 'database', so the scrape review can say how much a new save replaces.
-- Same signature and access rule; read-only, changes no row.

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
              + (SELECT count(*) FROM public.scrape_decisions d JOIN g ON d.game_id = g.id))::bigint AS files,
           (coalesce((SELECT sum(pg_column_size(gm.*)) FROM public.games gm JOIN g ON gm.id = g.id), 0)
            + coalesce((SELECT sum(pg_column_size(p.*)) FROM public.game_platforms p JOIN g ON p.game_id = g.id), 0)
            + coalesce((SELECT sum(pg_column_size(d.*)) FROM public.scrape_decisions d JOIN g ON d.game_id = g.id), 0))::bigint AS bytes
    FROM g
  ),
  record AS (
    SELECT 'scrape_record'::text AS category, count(*)::bigint AS files,
           coalesce(sum(pg_column_size(r.*)), 0)::bigint AS bytes
    FROM public.game_scrape_records r JOIN g ON r.game_id = g.id
    HAVING count(*) > 0
  )
  SELECT * FROM files
  UNION ALL
  SELECT * FROM record
  UNION ALL
  SELECT * FROM db
$$;

REVOKE ALL ON FUNCTION public.game_storage_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_storage_usage(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.game_storage_usage(uuid) IS
  'Files (by category), ScreenScraper record and other database bytes one game keeps; answers only for the caller''s own game.';
