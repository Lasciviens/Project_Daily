-- 133 — Games settings that follow the owner across devices. New table; updates no row. Safe to re-run.
--
-- prefs.excluded_platforms: platform keys (the Games page's shelf keys, e.g.
-- 'android', 'pico8', 'steam') whose games stay in the Library but are left
-- out of every count, Analytics, Needs review, Duplicates, the ScreenScraper
-- and IGDB batches, the random pick and the Home tile.
CREATE TABLE IF NOT EXISTS public.games_prefs (
  user_id    uuid PRIMARY KEY NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.games_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'games_prefs'
      AND policyname = 'Users manage own games prefs'
  ) THEN
    CREATE POLICY "Users manage own games prefs" ON public.games_prefs
      FOR ALL USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
  END IF;
END $$;
-- User-authored settings (AGENTS.md rule 9): audited like screenscraper_prefs.
DROP TRIGGER IF EXISTS trg_audit ON public.games_prefs;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.games_prefs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DROP TRIGGER IF EXISTS trg_games_prefs_updated_at ON public.games_prefs;
CREATE TRIGGER trg_games_prefs_updated_at BEFORE UPDATE ON public.games_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
COMMENT ON TABLE public.games_prefs IS
  'Games page settings that sync across devices. prefs.excluded_platforms = platform keys left out of every stat, count and batch (the games stay in the Library). One row per user.';
