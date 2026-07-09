-- Replaces the global "To-Do" quick-access drawer with a dev-requests board:
-- a place to jot bugs/feature requests/long-term wishes/integration ideas
-- about the app itself, from wherever in the app you notice them. Structured
-- (category/priority/page/effort) specifically so a future coding session
-- can read the backlog and act on it without back-and-forth clarification.

CREATE TABLE IF NOT EXISTS public.dev_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  page        text, -- auto-captured current route when created (e.g. "/training"), editable
  category    text NOT NULL DEFAULT 'feature'
              CHECK (category IN ('bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other')),
  priority    text NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
  effort      text CHECK (effort IN ('small', 'medium', 'large')),
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dev_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dev_requests' AND policyname = 'Users manage own dev requests'
  ) THEN
    CREATE POLICY "Users manage own dev requests"
      ON public.dev_requests
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS dev_requests_user_id_sort_order_idx
  ON public.dev_requests (user_id, sort_order);
