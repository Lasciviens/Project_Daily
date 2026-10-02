-- 122 — Media: release reminders. Additive; updates no existing row. Safe to re-run.
--
-- One row per title you asked to be reminded about: which days before its
-- release to push (30 = a month, 7 = a week, 1 = a day, 0 = the release day)
-- and which of those were already sent, so a reminder goes out once. The
-- push-send morning run reads it (service role) and sends one Web Push per
-- due reminder. release_date is the date the title page showed when the
-- reminder was saved; opening the page again refreshes it if TMDB moved it.

CREATE TABLE IF NOT EXISTS public.media_release_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type    text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id       integer NOT NULL,
  title         text NOT NULL,
  poster_path   text,
  release_date  date NOT NULL,
  offsets       integer[] NOT NULL DEFAULT '{7,0}',
  sent_offsets  integer[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, media_type, tmdb_id),
  CHECK (offsets <@ ARRAY[30, 7, 1, 0])
);
CREATE INDEX IF NOT EXISTS media_release_reminders_due_idx ON public.media_release_reminders (user_id, release_date);

ALTER TABLE public.media_release_reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_release_reminders' AND policyname = 'Users manage own release reminders') THEN
    CREATE POLICY "Users manage own release reminders" ON public.media_release_reminders FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_media_release_reminders_updated_at ON public.media_release_reminders;
CREATE TRIGGER trg_media_release_reminders_updated_at BEFORE UPDATE ON public.media_release_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_audit ON public.media_release_reminders;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.media_release_reminders
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
