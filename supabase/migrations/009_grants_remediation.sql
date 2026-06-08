-- ─── Remediation: apply missing GRANTs, DEFAULT auth.uid(), updated_at triggers,
-- and policy fixes across all tables in migrations 001–006.
-- These were omitted in earlier migrations; 007/008 established the correct pattern.

-- ─── Extensions ───────────────────────────────────────────────────────────────
-- Needed for trigram-based exercise name search (migration 012)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── GRANTs ───────────────────────────────────────────────────────────────────
-- 001 tasks
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO authenticated;

-- 002 media
GRANT SELECT, INSERT, UPDATE, DELETE ON movies            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tv_series         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_movie_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tv_entries   TO authenticated;

-- 003 calendar
GRANT SELECT, INSERT, UPDATE, DELETE ON user_calendar_tokens TO authenticated;

-- 004 schedule
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_blocks     TO authenticated;

-- 005 training
GRANT SELECT, INSERT, UPDATE, DELETE ON training_sessions   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON strava_tokens       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON training_programs   TO authenticated;

-- 006 health
GRANT SELECT, INSERT, UPDATE, DELETE ON health_daily_stats TO authenticated;

-- ─── DEFAULT auth.uid() on user_id columns ────────────────────────────────────
ALTER TABLE tasks                ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE user_movie_entries   ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE user_tv_entries      ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE user_calendar_tokens ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE schedule_blocks      ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE time_blocks          ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE training_sessions    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE strava_tokens        ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE training_programs    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE health_daily_stats   ALTER COLUMN user_id SET DEFAULT auth.uid();

-- ─── updated_at trigger function (created in 002, reused here) ────────────────
-- The function update_updated_at() already exists from 002_media.sql.
-- Apply triggers to all tables with updated_at that are currently missing them.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_updated_at') THEN
    CREATE TRIGGER trg_tasks_updated_at
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_time_blocks_updated_at') THEN
    CREATE TRIGGER trg_time_blocks_updated_at
      BEFORE UPDATE ON time_blocks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_training_sessions_updated_at') THEN
    CREATE TRIGGER trg_training_sessions_updated_at
      BEFORE UPDATE ON training_sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_strava_tokens_updated_at') THEN
    CREATE TRIGGER trg_strava_tokens_updated_at
      BEFORE UPDATE ON strava_tokens
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_training_programs_updated_at') THEN
    CREATE TRIGGER trg_training_programs_updated_at
      BEFORE UPDATE ON training_programs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_health_daily_stats_updated_at') THEN
    CREATE TRIGGER trg_health_daily_stats_updated_at
      BEFORE UPDATE ON health_daily_stats
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_calendar_tokens_updated_at') THEN
    CREATE TRIGGER trg_user_calendar_tokens_updated_at
      BEFORE UPDATE ON user_calendar_tokens
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_updated_at') THEN
    CREATE TRIGGER trg_projects_updated_at
      BEFORE UPDATE ON projects
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_phases_updated_at') THEN
    CREATE TRIGGER trg_project_phases_updated_at
      BEFORE UPDATE ON project_phases
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_items_updated_at') THEN
    CREATE TRIGGER trg_project_items_updated_at
      BEFORE UPDATE ON project_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─── Fix tasks.source_type CHECK ──────────────────────────────────────────────
-- 001 defined 'media' as a source_type but the actual values used are 'movie'
-- and 'tv_series'. Add them; keep 'media' for backwards compatibility with any
-- existing rows.
DO $$ BEGIN
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_type_check;
  ALTER TABLE tasks ADD CONSTRAINT tasks_source_type_check
    CHECK (source_type IN ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ─── Add WITH CHECK to incomplete RLS policies ────────────────────────────────
-- training_sessions, strava_tokens, training_programs had USING-only policies.
-- Drop and recreate with WITH CHECK for consistency.
DO $$ BEGIN
  DROP POLICY IF EXISTS "user owns training sessions" ON training_sessions;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'training_sessions' AND policyname = 'training_sessions_owner'
  ) THEN
    CREATE POLICY training_sessions_owner ON training_sessions
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "user owns strava tokens" ON strava_tokens;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'strava_tokens' AND policyname = 'strava_tokens_owner'
  ) THEN
    CREATE POLICY strava_tokens_owner ON strava_tokens
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "user owns training programs" ON training_programs;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'training_programs' AND policyname = 'training_programs_owner'
  ) THEN
    CREATE POLICY training_programs_owner ON training_programs
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── Add missing index ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS training_sessions_user_date
  ON training_sessions (user_id, planned_date);

-- ─── schedule_blocks.days_of_week CHECK ──────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE schedule_blocks ADD CONSTRAINT schedule_blocks_days_check
    CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
