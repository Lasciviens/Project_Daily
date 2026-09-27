-- ============================================================
-- 110 — athlete_profile: birth_year, sex, height_cm
-- ============================================================
-- The Health page compares numbers (VO2 max, resting heart rate, body fat,
-- steps, walking speed…) against published reference ranges, and almost every
-- one of those ranges depends on age and sex. BMI and waist-to-height need
-- height. None of the three was stored anywhere, so the page could only say
-- "higher is fitter". They go on the existing singleton athlete_profile row
-- (user_id is its primary key — migration 070) because each is 1:1 with the
-- person, exactly like goal / experience_level / training_days_per_week.
--
-- WHY birth_year AND NOT a full date of birth:
--   Every reference table used (FRIEND, NHANES, Voss, Gallagher, Paluch,
--   Studenski) is binned by age decade or wider, so a year is enough and is
--   less personal to store. The client estimates age as (current year −
--   birth_year), which can be one year high before the birthday — harmless at
--   decade granularity.
--
-- WHY sex IS ONLY 'male' | 'female':
--   It selects which published reference table applies, and the sources only
--   publish those two. It is nullable: with no value the page falls back to
--   sex-independent references (absolute VO2 thresholds, the resting-HR
--   mortality categories) or shows no band at all.
--
-- The CHECK ranges are plausibility guards against typos (a height of 1.8 or
-- 18 instead of 180), not medical limits.
--
-- ai-proxy's DB_CATALOG lists athlete_profile as rw; its columns text should
-- gain these three columns in the next ai-proxy redeploy so the AI can read
-- them. Nothing breaks before that — the AI simply doesn't know them.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW. Every new column is nullable
-- with no default, so the ADD COLUMN is metadata-only.

ALTER TABLE public.athlete_profile
  ADD COLUMN IF NOT EXISTS birth_year smallint,
  ADD COLUMN IF NOT EXISTS sex        text,
  ADD COLUMN IF NOT EXISTS height_cm  numeric(5,1);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_birth_year_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_birth_year_range CHECK (birth_year BETWEEN 1900 AND 2100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_sex_check') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_sex_check CHECK (sex IN ('male', 'female'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_profile_height_cm_range') THEN
    ALTER TABLE public.athlete_profile
      ADD CONSTRAINT athlete_profile_height_cm_range CHECK (height_cm BETWEEN 100 AND 250);
  END IF;
END $$;

COMMENT ON COLUMN public.athlete_profile.birth_year IS
  'Year of birth. Picks the age band of health reference ranges (Health page). Nullable.';
COMMENT ON COLUMN public.athlete_profile.sex IS
  'male | female — selects which published reference table applies. Nullable.';
COMMENT ON COLUMN public.athlete_profile.height_cm IS
  'Height in cm, for BMI and waist-to-height. Nullable.';
