-- 018_work_renovation.sql
-- Work page renovation: extend tasks, add work_notes, work_pinned_links, work_weekly_goals

-- ─── 1. tasks table ─────────────────────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS waiting_for TEXT;

-- Drop the old status check (inline constraints get the name <table>_<column>_check)
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

-- Add the new status check that includes 'waiting'
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'waiting', 'done', 'cancelled'));

-- ─── 2. work_notes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.work_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.work_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'work_notes' AND policyname = 'Users manage own work_notes'
  ) THEN
    CREATE POLICY "Users manage own work_notes"
      ON public.work_notes FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_notes TO authenticated;

-- One note row per user
ALTER TABLE public.work_notes
  DROP CONSTRAINT IF EXISTS work_notes_user_id_key;
ALTER TABLE public.work_notes
  ADD CONSTRAINT work_notes_user_id_key UNIQUE (user_id);

-- ─── 3. work_pinned_links ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.work_pinned_links (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  url        TEXT        NOT NULL,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.work_pinned_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'work_pinned_links' AND policyname = 'Users manage own work_pinned_links'
  ) THEN
    CREATE POLICY "Users manage own work_pinned_links"
      ON public.work_pinned_links FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_pinned_links TO authenticated;

-- ─── 4. work_weekly_goals ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.work_weekly_goals (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE        NOT NULL,
  title      TEXT        NOT NULL,
  done       BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.work_weekly_goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'work_weekly_goals' AND policyname = 'Users manage own work_weekly_goals'
  ) THEN
    CREATE POLICY "Users manage own work_weekly_goals"
      ON public.work_weekly_goals FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_weekly_goals TO authenticated;
