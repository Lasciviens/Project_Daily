-- ============================================================
-- 082 — exercise_gif_overrides
-- ============================================================
-- ExerciseThumb (src/features/training/exerciseMedia.tsx) matches a Hevy
-- exercise title to a GIF from the public JahelCuadrado/ExerciseGymGifsDB
-- dataset via fuzzy token matching (Jaccard + an equipment bonus). That
-- matcher has no ground truth to correct itself against, so a wrong match
-- (or a real exercise the 1323-entry dataset simply doesn't have) had no
-- fix short of a code change. This table is the manual override: one row
-- per (user, exercise_template_id) pins a specific GIF URL, checked BEFORE
-- the fuzzy matcher runs.
--
-- Deliberately keyed on `exercise_template_id`, not the exercise title —
-- Hevy exercise titles are occasionally edited/renamed by the user inside
-- the Hevy app itself, and a title-keyed override would silently detach
-- from the exercise it was meant to fix the moment that happens. The
-- template id is the same stable identity `hevy_exercise_templates` and
-- every progress/analysis feature already keys on.
--
-- `gif_url` is stored as a full URL, not a dataset-relative path — this is
-- what lets a user paste ANY public GIF URL (not just one already inside
-- ExerciseGymGifsDB) for an exercise that dataset has no entry for at all,
-- which was explicitly requested alongside "let me fix wrong matches".
-- `source` records where the URL came from (`'exercisegymgifsdb'` when
-- picked from the existing in-app search over that dataset, `'manual'` when
-- pasted directly) — informational only, nothing reads it yet.
--
-- User-authored settings-like data (AGENTS.md rule 9), so RLS + trg_audit
-- attach in this same migration, matching 070_athlete_profile.sql's own
-- reasoning for why that must happen at creation time, not retrofitted.

CREATE TABLE IF NOT EXISTS public.exercise_gif_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_template_id  uuid NOT NULL REFERENCES public.hevy_exercise_templates(id) ON DELETE CASCADE,
  gif_url               text NOT NULL,
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'exercisegymgifsdb')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_template_id)
);

ALTER TABLE public.exercise_gif_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'exercise_gif_overrides'
      AND policyname = 'Users manage own exercise gif overrides'
  ) THEN
    CREATE POLICY "Users manage own exercise gif overrides"
      ON public.exercise_gif_overrides
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS exercise_gif_overrides_user_idx
  ON public.exercise_gif_overrides (user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.exercise_gif_overrides;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exercise_gif_overrides
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exercise_gif_overrides_updated_at') THEN
    CREATE TRIGGER trg_exercise_gif_overrides_updated_at
      BEFORE UPDATE ON public.exercise_gif_overrides
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
