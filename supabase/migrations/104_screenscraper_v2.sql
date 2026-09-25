-- ============================================================
-- 104 — ScreenScraper rewrite: saved choices + a reversible journal
-- ============================================================
-- The rewritten `screenscraper-sync` (and the new `screenscraper-media`
-- proxy) need two things the old version never had:
--
-- 1. A place to keep "what do I want saved" — per field (fill / replace /
--    skip), per media type (save to storage / link on demand / skip), image
--    size, region and language order. It is a per-user setting read by the
--    browser and sent with every apply, so it lives in the database rather
--    than localStorage: a second device must not quietly scrape with a
--    different policy. A jsonb document rather than twenty columns because it
--    is a settings bag nobody filters or joins on, and a new media type or a
--    new option must not need a migration (the `health_workouts.raw`
--    reasoning).
--
-- 2. `scrape_decisions.prior_values`. The old apply could only FILL empty
--    fields, so an undo that set a field back to NULL was a true inverse. The
--    rewrite lets the user choose "replace" for a field, and undoing a replace
--    by writing NULL would destroy the value that was there before. So the
--    journal records what each written field held beforehand, and undo puts
--    exactly that back (still only where the live value is unchanged since
--    the write).
--
-- Updates no existing row. Pre-migration safe on both sides: the browser
-- falls back to built-in defaults when the prefs table is missing, and the
-- function retries the journal insert without `prior_values`.

CREATE TABLE IF NOT EXISTS public.screenscraper_prefs (
  user_id    uuid PRIMARY KEY NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.screenscraper_prefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'screenscraper_prefs'
      AND policyname = 'Users manage own screenscraper prefs'
  ) THEN
    CREATE POLICY "Users manage own screenscraper prefs"
      ON public.screenscraper_prefs
      FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- User-authored settings (AGENTS.md rule 9): audited like day_targets.
DROP TRIGGER IF EXISTS trg_audit ON public.screenscraper_prefs;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.screenscraper_prefs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_screenscraper_prefs_updated_at') THEN
    CREATE TRIGGER trg_screenscraper_prefs_updated_at
      BEFORE UPDATE ON public.screenscraper_prefs
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.screenscraper_prefs IS
  'What the ScreenScraper scraper saves by default: per-field policy, per-media-type save/link/skip, image width, region and language order. One row per user.';

ALTER TABLE public.scrape_decisions
  ADD COLUMN IF NOT EXISTS prior_values jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.scrape_decisions.prior_values IS
  'What each field in fields_written held before the write (NULL when it was empty). Undo restores this, and only where the live value still equals written_values.';
