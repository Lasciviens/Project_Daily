-- Health daily stats: aggregated data pushed from iPhone via Shortcuts + Health Auto Export
CREATE TABLE IF NOT EXISTS health_daily_stats (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date                date        NOT NULL,
  steps               integer,
  active_calories     integer,
  exercise_minutes    integer,
  stand_hours         integer,
  heart_rate_avg      integer,
  heart_rate_resting  integer,
  heart_rate_max      integer,
  vo2_max             numeric(5,2),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE health_daily_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_daily_stats' AND policyname = 'health_stats_owner'
  ) THEN
    CREATE POLICY health_stats_owner ON health_daily_stats
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
