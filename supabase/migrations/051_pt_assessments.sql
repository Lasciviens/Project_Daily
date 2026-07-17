-- ─────────────────────────────────────────────────────────────────────────────
-- 051: pt_assessments — persistent log of AI PT daily assessments.
-- Why a table (not localStorage like the daily briefing): the coach must be
-- able to FOLLOW UP on its own advice ("geçen sefer bench'e +2.5kg demiştim —
-- uygulanmış mı?"), which requires the previous assessment to be readable at
-- the next run, from any device. Multiple rows per day allowed (re-runs are
-- logged, latest wins for display); history is shown in the Coach tab.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pt_assessments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date        date NOT NULL,
  feeling     text NOT NULL,
  note        text,
  snapshot    text NOT NULL,   -- the exact data summary the coach saw (auditability)
  assessment  text NOT NULL,   -- the coach's reply
  model       text,            -- which Gemini model actually served it
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pt_assessments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pt_assessments' AND policyname = 'pt_assessments_owner'
  ) THEN
    CREATE POLICY pt_assessments_owner ON pt_assessments
      FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON pt_assessments TO authenticated;

CREATE INDEX IF NOT EXISTS pt_assessments_user_date
  ON pt_assessments (user_id, date DESC, created_at DESC);
