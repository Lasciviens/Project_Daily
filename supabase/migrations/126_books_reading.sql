-- ─────────────────────────────────────────────────────────────────────────────
-- 126 — Books library and reading tracker (docs/kobo/PLAN.md Phases 3 and 4).
--
--   books                one row per book, keyed by KOReader's partial MD5 when
--                        known (§4.2.1). Filled by the Kobo plugin (Nickel's
--                        own database + KOReader statistics) and by the owner.
--   reading_page_events  KOReader's page_stat_data rows, unchanged in shape
--                        (page, start, duration, total pages). Idempotent on
--                        (user, book, page, started_at), like KOReader itself.
--                        Bulk device data: no audit trigger (hevy_* precedent).
--   reading_settings     singleton: daily goal and streak threshold.
--   kobo_feed_state      gains the sync state: when the device last finished a
--                        complete drain (last_seen_at), its id and plugin version.
--
-- Updates no existing row. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.books (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  koreader_md5      text CHECK (koreader_md5 IS NULL OR koreader_md5 ~ '^[0-9a-f]{32}$'),
  kobo_content_id   text,
  file_path         text,
  title             text NOT NULL,
  author            text,
  series            text,
  series_index      text,
  language          text,
  isbn              text,
  publisher         text,
  published_year    int,
  description       text,
  page_count        int CHECK (page_count IS NULL OR page_count > 0),
  cover_url         text,
  read_status       text NOT NULL DEFAULT 'want' CHECK (read_status IN ('want', 'reading', 'finished', 'paused', 'dropped')),
  rating            int CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
  review            text,
  notes             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  queue_order       int,
  progress_pct      numeric(5,2) CHECK (progress_pct IS NULL OR progress_pct BETWEEN 0 AND 100),
  last_read_at      timestamptz,
  read_seconds      int,          -- KOReader's own lifetime total for the book
  read_pages        int,
  device_status     text,         -- the last status the device reported (applied once per change)
  device_rating     int,
  on_device         boolean NOT NULL DEFAULT true,
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('koreader', 'kobo', 'manual')),
  meta_source       text,
  meta_checked_at   timestamptz,
  needs_review      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS books_user_md5_idx ON public.books (user_id, koreader_md5) WHERE koreader_md5 IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_user_status_idx ON public.books (user_id, read_status);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_owner ON public.books;
CREATE POLICY books_owner ON public.books FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.books;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DROP TRIGGER IF EXISTS trg_books_updated_at ON public.books;
CREATE TRIGGER trg_books_updated_at BEFORE UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.reading_page_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id           uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  page              int NOT NULL CHECK (page >= 0),
  started_at        timestamptz NOT NULL,
  duration_seconds  int NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
  total_pages       int,
  source            text NOT NULL DEFAULT 'koreader' CHECK (source IN ('koreader', 'kobo')),
  device_id         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, page, started_at)
);

CREATE INDEX IF NOT EXISTS reading_page_events_user_started_idx ON public.reading_page_events (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS reading_page_events_book_idx ON public.reading_page_events (book_id, started_at);

ALTER TABLE public.reading_page_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reading_page_events_select ON public.reading_page_events;
CREATE POLICY reading_page_events_select ON public.reading_page_events FOR SELECT USING (auth.uid() = user_id);
-- Merging two book rows repoints events, so the owner may update and delete too.
DROP POLICY IF EXISTS reading_page_events_update ON public.reading_page_events;
CREATE POLICY reading_page_events_update ON public.reading_page_events FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS reading_page_events_delete ON public.reading_page_events;
CREATE POLICY reading_page_events_delete ON public.reading_page_events FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.reading_settings (
  user_id             uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_minutes_goal  int NOT NULL DEFAULT 20 CHECK (daily_minutes_goal BETWEEN 1 AND 600),
  streak_min_minutes  int NOT NULL DEFAULT 1 CHECK (streak_min_minutes BETWEEN 1 AND 600),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reading_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reading_settings_owner ON public.reading_settings;
CREATE POLICY reading_settings_owner ON public.reading_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_audit ON public.reading_settings;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.reading_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

ALTER TABLE public.kobo_feed_state
  ADD COLUMN IF NOT EXISTS last_seen_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_at     timestamptz,
  ADD COLUMN IF NOT EXISTS device_id        text,
  ADD COLUMN IF NOT EXISTS plugin_version   text,
  ADD COLUMN IF NOT EXISTS last_sync_result jsonb;
