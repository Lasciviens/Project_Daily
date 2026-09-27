-- ============================================================
-- 112 — training_skips
-- ============================================================
-- Training → Program / Next flag a current-program routine that hasn't been
-- logged for more than 7 days and has no session planned for it (pure rule:
-- src/features/training/plan/skippedRoutines.ts). The athlete answers the
-- flag in one of two ways: plan it on a day that works (an ordinary one-off
-- time block — nothing new), or skip it with a reason. This table stores the
-- skips, so the flag goes quiet for that one missed session and the reason is
-- on record (the owner's rule: a skip must always say why).
--
-- WHY week_start IS THE WEEK THE MISSED SESSION WAS DUE, NOT THE WEEK THE
-- SKIP WAS RECORDED:
--   A routine trained on Friday is due again the next Friday; if that Friday
--   passes without it, the flag appears on Saturday. Skipping it on Sunday
--   must cover THAT Friday's session — keyed by the week the skip was
--   recorded, the flag came straight back on Monday (a new calendar week)
--   for a session already skipped. The client computes the due day of the
--   missed session (last session + 7 days, stepped in 7-day slots) and stores
--   that day's Monday. Two due days are always 7 days apart, so they never
--   share a week: one row per missed session, and a second missed session in
--   a row is flagged (and skipped) on its own.
--
-- WHY A SEPARATE TABLE (not a column on current_program_routines):
--   A skip is an event with its own reason and date; a routine can collect
--   many over time, and removing a routine from the program must not erase
--   why sessions were skipped. routine_id has no FK for the same reason as
--   current_program_routines.routine_id (migration 084): hevy_routines is a
--   synced mirror of Hevy, not a table this app owns end to end.
--
-- reason is required (length after trimming ≥ 3 — "Sick" passes, "x" does
-- not) and capped at 500 characters. Rows are inserted or deleted (undo),
-- never edited in place, so there is no updated_at. Owner-only RLS,
-- user_id DEFAULT auth.uid(), trg_audit like every user-authored table.
-- Updates no existing row. Not in ai-proxy's DB_CATALOG; the AI coach sees
-- recent skips through the client-built coach context instead.

CREATE TABLE IF NOT EXISTS public.training_skips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id   text NOT NULL,
  week_start   date NOT NULL,
  reason       text NOT NULL CHECK (length(trim(reason)) >= 3 AND char_length(reason) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, routine_id, week_start)
);

ALTER TABLE public.training_skips ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_skips'
      AND policyname = 'Users manage own training skips'
  ) THEN
    CREATE POLICY "Users manage own training skips"
      ON public.training_skips
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- The client reads the last few weeks: (user_id, week_start) serves that range.
CREATE INDEX IF NOT EXISTS training_skips_user_week_idx
  ON public.training_skips (user_id, week_start DESC);

DROP TRIGGER IF EXISTS trg_audit ON public.training_skips;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.training_skips
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
