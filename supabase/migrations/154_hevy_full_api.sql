-- ═══════════════════════════════════════════════════════════════════════════
-- 154 — Hevy's whole public API (owner, 14.10.2026: "make the app support
-- Hevy's whole public API"; docs/integrations/hevy.md).
--
-- 1. hevy_exercise_templates.thumbnail_url — Hevy's own picture of an
--    exercise (ExerciseTemplate.thumbnail_url in Hevy's OpenAPI: "URL of the
--    exercise's thumbnail image, or null if the exercise has none"). Both
--    syncs fill it; the exercise thumbnails show it first and the
--    ExerciseGymGifsDB GIF stays the fallback and the animated demo.
--    NULL = Hevy has no picture (or the row was synced before 154).
--    Only an http(s) URL is stored: it ends up in an <img src>.
--
-- 2. hevy_account — one row per account: what GET /v1/user/info says about
--    the Hevy account (username, weight and distance unit, Hevy Pro) and
--    GET /v1/workouts/count's total, refreshed on every sync. The Hevy card on
--    Settings → Subscriptions shows them and compares the count with the
--    workouts stored here (only those Hevy created before count_checked_at,
--    so a workout the webhook brought in after the check is no mismatch).
--    Units are Hevy's own enums; anything else is stored as NULL by the
--    functions, and the CHECKs refuse it here too.
--
-- Written by the Hevy edge functions with the service role only; the browser
-- reads its own row (a select-own policy, no insert/update/delete policy or
-- grant). No trg_audit: bulk-synced Hevy data (like every hevy_* table), so
-- it is neither user-authored nor undoable from Developer → Activity.
-- ai-proxy's DB_CATALOG lists both as read-only.
-- Re-runnable: IF NOT EXISTS, the pg_constraint / pg_policies guards and
-- DROP TRIGGER IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Exercise pictures ────────────────────────────────────────────────────
ALTER TABLE public.hevy_exercise_templates
  ADD COLUMN IF NOT EXISTS thumbnail_url text NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.hevy_exercise_templates'::regclass
       AND conname = 'hevy_exercise_templates_thumbnail_url_check'
  ) THEN
    ALTER TABLE public.hevy_exercise_templates
      ADD CONSTRAINT hevy_exercise_templates_thumbnail_url_check
      CHECK (thumbnail_url IS NULL OR (thumbnail_url ~* '^https?://\S+$' AND char_length(thumbnail_url) <= 2048));
  END IF;
END $$;

COMMENT ON COLUMN public.hevy_exercise_templates.thumbnail_url IS
  'Hevy''s own picture of the exercise (ExerciseTemplate.thumbnail_url); NULL when Hevy has none. Written by the Hevy syncs.';

-- ── 2. The Hevy account ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hevy_account (
  user_id            uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  username           text CHECK (username IS NULL OR char_length(username) BETWEEN 1 AND 200),
  weight_unit        text CHECK (weight_unit IS NULL OR weight_unit IN ('kg', 'lbs')),
  distance_unit      text CHECK (distance_unit IS NULL OR distance_unit IN ('kilometers', 'miles')),
  is_pro             boolean,
  -- GET /v1/workouts/count at count_checked_at.
  hevy_workout_count integer CHECK (hevy_workout_count IS NULL OR hevy_workout_count >= 0),
  count_checked_at   timestamptz,
  -- When user info was last read.
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hevy_account ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'hevy_account' AND policyname = 'Users read own hevy account'
  ) THEN
    CREATE POLICY "Users read own hevy account" ON public.hevy_account
      FOR SELECT USING ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Read-only for the browser: only the service role (the Hevy functions) writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.hevy_account FROM anon, authenticated;
REVOKE SELECT ON public.hevy_account FROM anon;
GRANT SELECT ON public.hevy_account TO authenticated;

DROP TRIGGER IF EXISTS trg_hevy_account_updated_at ON public.hevy_account;
CREATE TRIGGER trg_hevy_account_updated_at
  BEFORE UPDATE ON public.hevy_account
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.hevy_account IS
  'The Hevy account behind HEVY_API_KEY (GET /v1/user/info) and its workout count (GET /v1/workouts/count), refreshed by the Hevy syncs. Read-only for the browser.';

select public.owner_lock_apply('public.hevy_account');
