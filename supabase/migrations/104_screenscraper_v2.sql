-- ============================================================
-- 104 — ScreenScraper rewrite: settings, a safe journal, a heavy-record
--        table, a scrape marker that leaves ES-DE alone, storage accounting
-- ============================================================
-- Everything the rewritten `screenscraper-sync` / `screenscraper-media` need.
-- Pre-migration behaviour is documented per part; the function degrades
-- (settings fall back to defaults, nothing is copied into Storage) rather
-- than failing.

-- ── 1. What to save: one settings document per user ─────────────────────────
-- Per field (fill / replace / skip), per media type (copy / online / skip),
-- image size, region and language order, the full-record switch and the
-- storage budget. Read by the browser and — authoritatively — by the function
-- (a request cannot raise the budget). jsonb because it is a settings bag
-- nobody filters on, and a new media type must not need a migration.

CREATE TABLE IF NOT EXISTS public.screenscraper_prefs (
  user_id    uuid PRIMARY KEY NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.screenscraper_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'screenscraper_prefs'
      AND policyname = 'Users manage own screenscraper prefs'
  ) THEN
    CREATE POLICY "Users manage own screenscraper prefs" ON public.screenscraper_prefs
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
-- User-authored settings (AGENTS.md rule 9): audited like day_targets.
DROP TRIGGER IF EXISTS trg_audit ON public.screenscraper_prefs;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.screenscraper_prefs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_screenscraper_prefs_updated_at') THEN
    CREATE TRIGGER trg_screenscraper_prefs_updated_at BEFORE UPDATE ON public.screenscraper_prefs
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;
COMMENT ON TABLE public.screenscraper_prefs IS
  'What the ScreenScraper scraper saves by default: per-field policy, per-media-type copy/online/skip, image size, region and language order, full-record switch, storage budget. One row per user.';

-- ── 2. The journal: reversible, and written only by the server ──────────────
-- `prior_values`: the rewrite can REPLACE a field, and undoing a replace by
-- writing NULL would destroy what was there — so each write records what it
-- replaced. `replaced_paths`: stored copies an apply stopped pointing at; kept
-- until the next apply of the same game so undo can point back at them.
ALTER TABLE public.scrape_decisions
  ADD COLUMN IF NOT EXISTS prior_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS replaced_paths text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.scrape_decisions.prior_values IS
  'What each field in fields_written held before the write (NULL when empty). Undo restores it, only where the live value still equals written_values.';
COMMENT ON COLUMN public.scrape_decisions.replaced_paths IS
  'Storage objects this apply stopped referencing. Undo points back at them; the next apply of the same game deletes them.';

-- Undo runs these rows with the service role, so a row the browser could
-- write would let a browser session delete any object in the bucket or write
-- any column. Only the function writes the journal: the browser may read.
DROP POLICY IF EXISTS "scrape_decisions owner" ON public.scrape_decisions;
DROP POLICY IF EXISTS "scrape_decisions owner read" ON public.scrape_decisions;
CREATE POLICY "scrape_decisions owner read" ON public.scrape_decisions
  FOR SELECT USING (user_id = auth.uid());

-- It is a journal already; auditing it copied every row (and its values) a
-- second time into audit_logs.
DROP TRIGGER IF EXISTS trg_audit ON public.scrape_decisions;

-- ── 3. "Scraped" gets its own marker; ES-DE keeps its identity ──────────────
-- The first scraper wrote external_source='screenscraper' onto the game AND
-- its ES-DE variant. Every handheld path finds its rows by
-- external_source='esde' (cover upload, original-image sync, deletion
-- reconcile), so each scraped game silently dropped out of the RP6 sync.
-- The ScreenScraper identity now lives in games.ss_jeu_id.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS ss_jeu_id text,
  ADD COLUMN IF NOT EXISTS ss_scraped_at timestamptz;
CREATE INDEX IF NOT EXISTS games_user_ss_jeu_idx ON public.games (user_id, ss_jeu_id);
COMMENT ON COLUMN public.games.ss_jeu_id IS
  'The ScreenScraper game id this row was matched to. Never overload external_source/external_ref for this — ES-DE finds its rows by external_source = ''esde''.';

-- Repair the rows the first scraper re-labelled (44 measured on 2026-09-25).
-- ES-DE rows carry no external_ref, so clearing it restores them exactly.
UPDATE public.games g
   SET ss_jeu_id = COALESCE(g.ss_jeu_id, g.external_ref),
       external_source = CASE WHEN EXISTS (
         SELECT 1 FROM public.game_platforms p WHERE p.game_id = g.id AND p.esde_path IS NOT NULL
       ) THEN 'esde' ELSE 'manual' END,
       external_ref = NULL
 WHERE g.external_source = 'screenscraper';
UPDATE public.game_platforms
   SET external_source = 'esde', external_ref = NULL
 WHERE external_source = 'screenscraper' AND esde_path IS NOT NULL;

-- ── 4. The heavy record, out of the games row ───────────────────────────────
-- Their full answer (every title, synopsis, date, rating board, dump, hack,
-- control mapping, the media inventory) is tens of KB per game. On the games
-- row it was copied into audit_logs on every scrape and into the journal
-- twice. Here it is one row per game, never audited (bulk provider payload,
-- the health_* exemption) and never journaled; games.provider_data keeps only
-- a small pointer (ids, saved/online media, when).
CREATE TABLE IF NOT EXISTS public.game_scrape_records (
  game_id    uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text NOT NULL DEFAULT 'screenscraper',
  jeu_id     text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw        jsonb
);
ALTER TABLE public.game_scrape_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_scrape_records owner read" ON public.game_scrape_records;
CREATE POLICY "game_scrape_records owner read" ON public.game_scrape_records
  FOR SELECT USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS game_scrape_records_user_idx ON public.game_scrape_records (user_id);
COMMENT ON TABLE public.game_scrape_records IS
  'The full ScreenScraper record per game (normalized summary + their answer minus every URL). Written only by screenscraper-sync; not audited (bulk provider payload).';

-- ── 5. Storage accounting, server-side only ─────────────────────────────────
-- The Free plan's 1 GB is a hard wall: over quota the project is eventually
-- locked with 402 on EVERY request. Walking the bucket through the Storage
-- API is one call per folder; storage.objects already records sizes.
-- SECURITY DEFINER because `storage` is not exposed to PostgREST. Callable by
-- the service role only (Supabase grants new functions to anon/authenticated
-- explicitly, so those grants are revoked by name).
--
-- Categories follow the bucket's layout: under `<user>/esde/<variant>/` the
-- object a variant's cover_url points at is the optimized ES-DE cover (both
-- ES-DE uploads share the `<hash>.<ext>` naming and originals can be WebP
-- too, so the extension says nothing), anything else there an ES-DE
-- original; `pending/` is the old scraper's review quarantine, the rest
-- (`<game>/<type>….<ext>`) ScreenScraper copies.
CREATE OR REPLACE FUNCTION public.game_media_usage()
RETURNS TABLE (category text, files bigint, bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH covers AS (
    SELECT DISTINCT substring(p.cover_url FROM '/object/public/game-media/(.*)$') AS name
    FROM public.game_platforms p
    WHERE p.cover_url LIKE '%/object/public/game-media/%/esde/%'
  )
  SELECT c.category, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  FROM storage.objects o
  LEFT JOIN covers cv ON cv.name = o.name
  CROSS JOIN LATERAL (SELECT CASE
    WHEN o.name LIKE 'pending/%' THEN 'pending'
    WHEN o.name LIKE '%/esde/%' AND cv.name IS NOT NULL THEN 'esde_cover'
    WHEN o.name LIKE '%/esde/%' THEN 'esde_original'
    ELSE 'screenscraper' END AS category) c
  WHERE o.bucket_id = 'game-media'
  GROUP BY c.category
$$;
REVOKE ALL ON FUNCTION public.game_media_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_media_usage() TO service_role;

-- Every ScreenScraper-category object with its size and age, for the cleanup
-- that deletes copies no game points at any more. Ordered, so the caller can
-- page past PostgREST's row cap; the age lets it leave alone a copy a save
-- still in flight has uploaded but not yet written to its game. Same access
-- rule.
DROP FUNCTION IF EXISTS public.game_media_scrape_objects();
CREATE OR REPLACE FUNCTION public.game_media_scrape_objects()
RETURNS TABLE (name text, bytes bigint, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT o.name, coalesce((o.metadata->>'size')::bigint, 0)::bigint, o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'game-media' AND o.name NOT LIKE '%/esde/%'
  ORDER BY o.name
$$;
REVOKE ALL ON FUNCTION public.game_media_scrape_objects() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_media_scrape_objects() TO service_role;

COMMENT ON FUNCTION public.game_media_usage() IS
  'Per-category file count and bytes of the game-media bucket. The scraper and the ES-DE upload refuse to store past the budget.';
