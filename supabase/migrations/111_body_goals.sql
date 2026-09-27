-- ============================================================
-- 111 — athlete_profile: body goals (weight, body fat %, muscle mass)
--       and the start date of the current phase
-- ============================================================
-- The Health page's goal report (was "Cut report") follows the phase the
-- person picked in their nutrition goals (day_targets.goal: cut / maintain /
-- gain) and shows progress toward a goal weight, a goal body-fat % and a goal
-- muscle mass, with a projected date at the current rate. The goal weight and
-- the cut start date used to live in localStorage only (one browser, lost on a
-- cleared site storage), and there was no body-fat or muscle goal at all.
--
-- They go on the existing singleton athlete_profile row (user_id is its
-- primary key — migration 070) because each is 1:1 with the person, like
-- goal / birth_year / height_cm (migration 110). The PHASE itself is NOT
-- stored here: day_targets.goal (migration 086) already is the phase, and the
-- report reads and writes it there — one source for "am I cutting?".
--
--   goal_weight_kg      — target bodyweight
--   goal_body_fat_pct   — target body fat % (as the smart scale reports it)
--   goal_muscle_mass_kg — target muscle mass (the scale report's muscle %
--                         × weight — not lean mass, which also counts water,
--                         organs and bone)
--   phase_start_date    — the day the current cut / maintain / gain phase
--                         began: the baseline for goal progress, and the
--                         water-heavy first weeks of a cut or gain get flagged
--
-- The CHECK ranges are plausibility guards against typos (a goal weight of
-- 8 instead of 80, a body fat of 150), not medical limits.
--
-- The client is pre-migration safe: reads treat the missing columns as null
-- and fall back to the old device-local values; a save before this migration
-- keeps the goals on the device and says so. The first successful save after
-- this migration copies the device-local values into the row once.
--
-- ai-proxy's DB_CATALOG lists athlete_profile as rw; its columns text names
-- these four columns from the redeploy that ships with this migration.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW. Every new column is nullable
-- with no default, so the ADD COLUMN is metadata-only.

ALTER TABLE public.athlete_profile
  ADD COLUMN IF NOT EXISTS goal_weight_kg      numeric(5,1),
  ADD COLUMN IF NOT EXISTS goal_body_fat_pct   numeric(4,1),
  ADD COLUMN IF NOT EXISTS goal_muscle_mass_kg numeric(5,1),
  ADD COLUMN IF NOT EXISTS phase_start_date    date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_goal_weight_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_goal_weight_range CHECK (goal_weight_kg BETWEEN 25 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_goal_body_fat_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_goal_body_fat_range CHECK (goal_body_fat_pct BETWEEN 3 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_goal_muscle_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_goal_muscle_range CHECK (goal_muscle_mass_kg BETWEEN 10 AND 150);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_phase_start_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_phase_start_range CHECK (phase_start_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31');
  END IF;
END $$;

COMMENT ON COLUMN public.athlete_profile.goal_weight_kg IS
  'Goal bodyweight in kg (Health → Goal progress). Nullable.';
COMMENT ON COLUMN public.athlete_profile.goal_body_fat_pct IS
  'Goal body fat % as the smart scale reports it (Health → Goal progress). Nullable.';
COMMENT ON COLUMN public.athlete_profile.goal_muscle_mass_kg IS
  'Goal muscle mass in kg — the scale report''s muscle % × weight, not lean mass (Health → Goal progress). Nullable.';
COMMENT ON COLUMN public.athlete_profile.phase_start_date IS
  'Day the current cut / maintain / gain phase began (the phase itself is day_targets.goal). Baseline for goal progress. Nullable.';
