-- ============================================================
-- 113 — day_targets: the whole goal in one row
--       (phase start + body goals move next to the phase and targets)
-- ============================================================
-- The owner's report: "Goal is in 2 different places and saves in different
-- cells, one in Food and one in Health. It should be saved in one place per
-- user and the user should know it is a goal."
--
-- Before this migration the goal was split across two tables and four
-- editors:
--   day_targets (086)      — the phase (cut / maintain / gain) + daily
--                            calories, protein and water (Food's Goals editor)
--   athlete_profile (111)  — goal weight, goal body fat %, goal muscle mass and
--                            the phase start date (Health's Goals form only)
-- Changing the phase never touched its start date, Health saved the phase
-- instantly while Food waited for Save, and neither page could edit the
-- other's half.
--
-- The four body-goal fields now live on the day_targets singleton next to the
-- phase they belong to, so ONE editor ("Your goal": phase with its start date,
-- daily targets, body targets — one Save) writes one row. One set of body
-- targets serves every phase (owner decision); the per-phase daily targets in
-- day_target_profiles (088) are unchanged.
--
-- The athlete_profile columns from 111 are KEPT (no drop, nothing reads them
-- once this is applied): dropping them would break a client that hasn't
-- reloaded yet, and ai-proxy's catalog text is what tells the AI which table
-- to use. Same CHECK ranges as 111 (plausibility guards against typos, not
-- medical limits).
--
-- Data: every existing goal value is COPIED from athlete_profile into the
-- user's day_targets row (a row is created with the table defaults for a user
-- who set body goals but never saved nutrition targets). A value already in
-- day_targets is never overwritten, so re-running is a no-op.
--
-- Also: athlete_profile.goal becomes the training focus only, so a stored
-- 'fat_loss' is rewritten to 'general' (see the block near the end).
--
-- The client is pre-migration safe: without these columns it reads the body
-- goals from athlete_profile (then the old device-local copy) and a Save
-- stores the daily targets here and the body goals there, with a warning
-- naming this migration.

ALTER TABLE public.day_targets
  ADD COLUMN IF NOT EXISTS phase_start_date    date,
  ADD COLUMN IF NOT EXISTS goal_weight_kg      numeric(5,1),
  ADD COLUMN IF NOT EXISTS goal_body_fat_pct   numeric(4,1),
  ADD COLUMN IF NOT EXISTS goal_muscle_mass_kg numeric(5,1);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_goal_weight_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_goal_weight_range CHECK (goal_weight_kg BETWEEN 25 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_goal_body_fat_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_goal_body_fat_range CHECK (goal_body_fat_pct BETWEEN 3 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_goal_muscle_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_goal_muscle_range CHECK (goal_muscle_mass_kg BETWEEN 10 AND 150);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'day_targets_phase_start_range') THEN
    ALTER TABLE public.day_targets
      ADD CONSTRAINT day_targets_phase_start_range CHECK (phase_start_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31');
  END IF;
END $$;

-- Copy the 111 values across (only where 111 exists and day_targets is empty).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'athlete_profile' AND column_name = 'goal_weight_kg'
  ) THEN
    -- A user with body goals but no day_targets row gets one (table defaults
    -- for the daily targets, exactly what the app shows without a row).
    INSERT INTO public.day_targets (user_id)
    SELECT a.user_id
    FROM public.athlete_profile a
    WHERE (a.goal_weight_kg IS NOT NULL OR a.goal_body_fat_pct IS NOT NULL
           OR a.goal_muscle_mass_kg IS NOT NULL OR a.phase_start_date IS NOT NULL)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.day_targets d
    SET phase_start_date    = COALESCE(d.phase_start_date,    a.phase_start_date),
        goal_weight_kg      = COALESCE(d.goal_weight_kg,      a.goal_weight_kg),
        goal_body_fat_pct   = COALESCE(d.goal_body_fat_pct,   a.goal_body_fat_pct),
        goal_muscle_mass_kg = COALESCE(d.goal_muscle_mass_kg, a.goal_muscle_mass_kg)
    FROM public.athlete_profile a
    WHERE a.user_id = d.user_id
      AND ((d.phase_start_date    IS NULL AND a.phase_start_date    IS NOT NULL)
        OR (d.goal_weight_kg      IS NULL AND a.goal_weight_kg      IS NOT NULL)
        OR (d.goal_body_fat_pct   IS NULL AND a.goal_body_fat_pct   IS NOT NULL)
        OR (d.goal_muscle_mass_kg IS NULL AND a.goal_muscle_mass_kg IS NOT NULL));

    COMMENT ON COLUMN public.athlete_profile.goal_weight_kg IS
      'Superseded by day_targets.goal_weight_kg (migration 113); kept, no longer read.';
    COMMENT ON COLUMN public.athlete_profile.goal_body_fat_pct IS
      'Superseded by day_targets.goal_body_fat_pct (migration 113); kept, no longer read.';
    COMMENT ON COLUMN public.athlete_profile.goal_muscle_mass_kg IS
      'Superseded by day_targets.goal_muscle_mass_kg (migration 113); kept, no longer read.';
    COMMENT ON COLUMN public.athlete_profile.phase_start_date IS
      'Superseded by day_targets.phase_start_date (migration 113); kept, no longer read.';
  END IF;
END $$;

-- Training focus: athlete_profile.goal is now only the TRAINING focus
-- (strength / hypertrophy / general). 'fat_loss' is retired — losing fat is
-- the Cut phase above — and the app already reads it as 'general'; store it
-- that way too so every reader (get_athlete_profile, run_read_query, the
-- coach) agrees with the app. The CHECK still accepts 'fat_loss' so a tab
-- that hasn't reloaded can't fail a save; nothing offers it any more.
-- Idempotent (a second run matches no row).
DO $$ BEGIN
  IF to_regclass('public.athlete_profile') IS NOT NULL THEN
    UPDATE public.athlete_profile SET goal = 'general' WHERE goal = 'fat_loss';
  END IF;
END $$;

COMMENT ON COLUMN public.day_targets.phase_start_date IS
  'Day the current phase (goal: cut / maintain / gain) began — the baseline for goal progress. Nullable.';
COMMENT ON COLUMN public.day_targets.goal_weight_kg IS
  'Goal bodyweight in kg; one value for every phase. Nullable.';
COMMENT ON COLUMN public.day_targets.goal_body_fat_pct IS
  'Goal body fat % as the smart scale reports it; one value for every phase. Nullable.';
COMMENT ON COLUMN public.day_targets.goal_muscle_mass_kg IS
  'Goal muscle mass in kg — the scale report''s muscle % × weight, not lean mass. Nullable.';
