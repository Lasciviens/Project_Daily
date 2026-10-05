-- ─────────────────────────────────────────────────────────────────────────────
-- 127 — Control the Kobo from the app (docs/kobo/PLAN.md §11, round 2).
--
--   books.kind              'book' | 'news'. News Downloader issues are
--                           readable but are not books: they stay out of the
--                           library, "Reading now" and the queue.
--   books.cover_source      where cover_url came from: 'device' (the EPUB's own
--                           cover, sent by the plugin), 'upload' (added in the
--                           app), 'lookup' (book-meta), 'url' (typed).
--   books.device_cover_at   when the plugin last tried to send this book's
--                           cover (so it is not asked again every sync).
--   kobo_device_config      one row per user: the KOReader settings and menu
--                           order chosen in the app, and the sleep image.
--                           `rev` goes up on every change; the plugin applies a
--                           rev once and says so in kobo_device_state.
--   kobo_device_state       one row per user, written by the kobo-sync
--                           function only: which rev the Kobo applied, what it
--                           refused, and its report (current values + menus).
--   kobo_sleep_images       images uploaded for the sleep screen (private
--                           `kobo-sleep` bucket, ≤ 3 MB each, ≤ 10 MB in all).
--   book-covers             public bucket for covers (device or upload),
--                           ≤ 400 KB a file; the function and the app keep it ≤ 20 MB.
--   kobo_captures           notes captured on the Kobo (task / wish / book),
--                           keyed by the device's own id so a retried send
--                           never makes two rows.
--   book_ai_notes           questions asked about a passage on the Kobo and
--                           the AI's answers (the key stays on the server).
--   kobo_feed_state         + battery, charging and KOReader version.
--   storage                 the Kobo inbox cap drops from 150 to 100 MB, so
--                           game-media (850) + inbox (100) + covers (20) +
--                           sleep images (10) = 980 MiB, less than the 1000 MiB
--                           the project allowed before this migration.
--
-- Updates existing rows once: books whose file sits in KOReader's news folder
-- become kind = 'news'. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'book',
  ADD COLUMN IF NOT EXISTS cover_source    text,
  ADD COLUMN IF NOT EXISTS device_cover_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.books ADD CONSTRAINT books_kind_check CHECK (kind IN ('book', 'news'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.books ADD CONSTRAINT books_cover_source_check
    CHECK (cover_source IS NULL OR cover_source IN ('device', 'upload', 'lookup', 'url'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- News Downloader saves to <KOReader data dir>/news/ unless told otherwise.
UPDATE public.books SET kind = 'news'
WHERE kind = 'book' AND file_path ILIKE '%/.adds/koreader/news/%';

-- A cover that book-meta found is a lookup.
UPDATE public.books SET cover_source = 'lookup'
WHERE cover_url IS NOT NULL AND cover_source IS NULL AND meta_source IS NOT NULL;

-- ── What the app wants on the Kobo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kobo_device_config (
  user_id         uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  menu_order      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sleep_image_id  uuid,
  rev             int NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(settings) = 'object'),
  CHECK (jsonb_typeof(menu_order) = 'object')
);

ALTER TABLE public.kobo_device_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kobo_device_config_owner ON public.kobo_device_config;
CREATE POLICY kobo_device_config_owner ON public.kobo_device_config FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.kobo_device_config;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.kobo_device_config
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- Every real change is a new revision; the plugin applies each revision once.
-- The sleep-image trigger below raises rev itself, so a higher rev passes through.
CREATE OR REPLACE FUNCTION public.kobo_device_config_bump()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.settings IS DISTINCT FROM OLD.settings
     OR NEW.menu_order IS DISTINCT FROM OLD.menu_order
     OR NEW.sleep_image_id IS DISTINCT FROM OLD.sleep_image_id THEN
    NEW.rev := greatest(NEW.rev, OLD.rev + 1);
  ELSIF NEW.rev < OLD.rev THEN
    NEW.rev := OLD.rev;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kobo_device_config_bump ON public.kobo_device_config;
CREATE TRIGGER trg_kobo_device_config_bump BEFORE UPDATE ON public.kobo_device_config
  FOR EACH ROW EXECUTE FUNCTION public.kobo_device_config_bump();

-- ── What the Kobo did (the function writes it) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.kobo_device_state (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  applied_rev   int,
  applied_at    timestamptz,
  apply_result  jsonb,
  report        jsonb,
  reported_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kobo_device_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kobo_device_state_select ON public.kobo_device_state;
CREATE POLICY kobo_device_state_select ON public.kobo_device_state FOR SELECT USING (auth.uid() = user_id);

-- ── Sleep screen images ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kobo_sleep_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  filename      text NOT NULL,
  mime          text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  size_bytes    int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 3145728),
  width         int,
  height        int,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kobo_sleep_images_user_idx ON public.kobo_sleep_images (user_id, created_at);

ALTER TABLE public.kobo_sleep_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kobo_sleep_images_owner ON public.kobo_sleep_images;
CREATE POLICY kobo_sleep_images_owner ON public.kobo_sleep_images FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.kobo_sleep_images;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.kobo_sleep_images
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- ≤ 10 MB and ≤ 40 images, counted from the declared sizes (the row is written
-- before the upload, so an over-cap image never costs storage).
CREATE OR REPLACE FUNCTION public.kobo_sleep_images_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bytes bigint;
  v_count int;
BEGIN
  SELECT coalesce(sum(size_bytes), 0), count(*) INTO v_bytes, v_count
  FROM public.kobo_sleep_images WHERE user_id = NEW.user_id;
  IF v_bytes + NEW.size_bytes > 10485760 OR v_count >= 40 THEN
    RAISE EXCEPTION 'Sleep images are full (10 MB or 40 images). Delete one first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kobo_sleep_images_cap ON public.kobo_sleep_images;
CREATE TRIGGER trg_kobo_sleep_images_cap BEFORE INSERT ON public.kobo_sleep_images
  FOR EACH ROW EXECUTE FUNCTION public.kobo_sleep_images_cap();

-- Adding or removing an image is a new revision for the Kobo too.
CREATE OR REPLACE FUNCTION public.kobo_sleep_images_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := coalesce(NEW.user_id, OLD.user_id);
BEGIN
  INSERT INTO public.kobo_device_config (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.kobo_device_config SET rev = rev + 1, updated_at = now() WHERE user_id = v_user;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.kobo_device_config SET sleep_image_id = NULL WHERE user_id = v_user AND sleep_image_id = OLD.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_kobo_sleep_images_bump ON public.kobo_sleep_images;
CREATE TRIGGER trg_kobo_sleep_images_bump AFTER INSERT OR DELETE ON public.kobo_sleep_images
  FOR EACH ROW EXECUTE FUNCTION public.kobo_sleep_images_bump();

-- ── Buckets ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('kobo-sleep', 'kobo-sleep', false, 3145728, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 3145728, allowed_mime_types = ARRAY['image/jpeg', 'image/png'];

DROP POLICY IF EXISTS kobo_sleep_insert ON storage.objects;
CREATE POLICY kobo_sleep_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kobo-sleep' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS kobo_sleep_select ON storage.objects;
CREATE POLICY kobo_sleep_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kobo-sleep' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS kobo_sleep_delete ON storage.objects;
CREATE POLICY kobo_sleep_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kobo-sleep' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Covers are public (an <img> sends no header); the names carry the book id
-- plus a random part, so they cannot be listed or guessed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('book-covers', 'book-covers', true, 409600, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 409600, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

DROP POLICY IF EXISTS book_covers_insert ON storage.objects;
CREATE POLICY book_covers_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'book-covers' AND (storage.foldername(name))[1] = auth.uid()::text);
-- Storage's remove() reads the row first, so the owner needs SELECT on their folder too.
DROP POLICY IF EXISTS book_covers_select ON storage.objects;
CREATE POLICY book_covers_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'book-covers' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS book_covers_delete ON storage.objects;
CREATE POLICY book_covers_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'book-covers' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Bytes in a bucket (no names), for the 20 MB cover budget the function and the app both check.
CREATE OR REPLACE FUNCTION public.kobo_bucket_usage(p_bucket text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  FROM storage.objects o WHERE o.bucket_id = p_bucket AND p_bucket IN ('book-covers', 'kobo-sleep')
$$;
REVOKE ALL ON FUNCTION public.kobo_bucket_usage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kobo_bucket_usage(text) TO authenticated, service_role;

-- ── The inbox gives back 50 MB ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_deliveries_inbox_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_waiting bigint;
BEGIN
  SELECT coalesce(sum(size_bytes), 0) INTO v_waiting
  FROM public.book_deliveries
  WHERE user_id = NEW.user_id AND status IN ('queued', 'downloaded');
  IF v_waiting + NEW.size_bytes > 104857600 THEN
    RAISE EXCEPTION 'Kobo inbox is full (100 MB waiting). Let the Kobo download what is there first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── Captured on the Kobo ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kobo_captures (
  id           text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9-]{8,64}$'),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('task', 'wish', 'book')),
  target_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kobo_captures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kobo_captures_select ON public.kobo_captures;
CREATE POLICY kobo_captures_select ON public.kobo_captures FOR SELECT USING (auth.uid() = user_id);

-- ── Questions about a passage ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_ai_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id      uuid REFERENCES public.books(id) ON DELETE SET NULL,
  book_title   text,
  ask          text NOT NULL CHECK (ask IN ('explain', 'translate', 'word', 'character', 'free')),
  question     text,
  selection    text NOT NULL,
  answer       text NOT NULL,
  model        text,
  percent      numeric(5,2),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS book_ai_notes_user_idx ON public.book_ai_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS book_ai_notes_book_idx ON public.book_ai_notes (book_id, created_at DESC);
ALTER TABLE public.book_ai_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS book_ai_notes_select ON public.book_ai_notes;
CREATE POLICY book_ai_notes_select ON public.book_ai_notes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS book_ai_notes_delete ON public.book_ai_notes;
CREATE POLICY book_ai_notes_delete ON public.book_ai_notes FOR DELETE USING (auth.uid() = user_id);

-- ── The device's own facts, from every sync ─────────────────────────────────
ALTER TABLE public.kobo_feed_state
  ADD COLUMN IF NOT EXISTS battery          int CHECK (battery IS NULL OR battery BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS charging         boolean,
  ADD COLUMN IF NOT EXISTS koreader_version text;
