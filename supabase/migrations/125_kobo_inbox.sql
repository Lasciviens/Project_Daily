-- ─────────────────────────────────────────────────────────────────────────────
-- 125 — Send to Kobo (docs/kobo/PLAN.md §8.2, roadmap Phase 2).
--
-- A book uploaded in the app waits in a private `kobo-inbox` bucket until the
-- Kobo downloads it through the `kobo-sync` OPDS feed; then it is deleted
-- (24 h after the download, or 7 days after the upload if never fetched).
-- The Kobo is the library — Supabase is only the post office (§4.6).
--
--   book_deliveries   one row per uploaded file (owner-only RLS; the function
--                     writes download/expiry status with the service role)
--   kobo_feed_state   one row per user: when the Kobo last read the feed and
--                     last downloaded a book (Settings → Subscriptions card)
--   kobo-inbox        private bucket, ≤ 50 MB per file; files live under
--                     <user id>/<delivery id>/<file name>
--   storage cap       ≤ 150 MB waiting in the inbox (trigger below). The three
--                     game-media uploaders drop to an 850 MB ceiling in the same
--                     release, so the whole project stays under the 1 GB wall.
--   lascis-kobo-sweep daily pg_cron call to the function's sweep (Vault secret
--                     KOBO_OPDS_TOKEN); the feed also sweeps on every request.
--
-- Updates no existing row. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.book_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  filename      text NOT NULL,
  mime          text NOT NULL DEFAULT 'application/epub+zip',
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  title         text,
  author        text,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloaded', 'expired', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  downloaded_at timestamptz,
  device_id     text
);

CREATE INDEX IF NOT EXISTS book_deliveries_user_created_idx ON public.book_deliveries (user_id, created_at DESC);

ALTER TABLE public.book_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS book_deliveries_select ON public.book_deliveries;
CREATE POLICY book_deliveries_select ON public.book_deliveries FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS book_deliveries_insert ON public.book_deliveries;
CREATE POLICY book_deliveries_insert ON public.book_deliveries FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'queued');
-- The owner may only cancel; download/expiry status comes from the function.
DROP POLICY IF EXISTS book_deliveries_update ON public.book_deliveries;
CREATE POLICY book_deliveries_update ON public.book_deliveries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND status = 'cancelled');
DROP POLICY IF EXISTS book_deliveries_delete ON public.book_deliveries;
CREATE POLICY book_deliveries_delete ON public.book_deliveries FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.book_deliveries;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.book_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- ≤ 150 MB waiting at once, counted from the declared sizes (the row is written
-- before the upload, so an over-cap file is refused before it costs storage).
CREATE OR REPLACE FUNCTION public.book_deliveries_inbox_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_waiting bigint;
BEGIN
  SELECT coalesce(sum(size_bytes), 0) INTO v_waiting
  FROM public.book_deliveries
  WHERE user_id = NEW.user_id AND status IN ('queued', 'downloaded');
  IF v_waiting + NEW.size_bytes > 157286400 THEN
    RAISE EXCEPTION 'Kobo inbox is full (150 MB waiting). Let the Kobo download what is there first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_book_deliveries_inbox_cap ON public.book_deliveries;
CREATE TRIGGER trg_book_deliveries_inbox_cap BEFORE INSERT ON public.book_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.book_deliveries_inbox_cap();

CREATE TABLE IF NOT EXISTS public.kobo_feed_state (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_feed_at     timestamptz,
  last_download_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kobo_feed_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kobo_feed_state_select ON public.kobo_feed_state;
CREATE POLICY kobo_feed_state_select ON public.kobo_feed_state FOR SELECT USING (auth.uid() = user_id);

-- ── Private bucket ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('kobo-inbox', 'kobo-inbox', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS kobo_inbox_insert ON storage.objects;
CREATE POLICY kobo_inbox_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kobo-inbox' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS kobo_inbox_select ON storage.objects;
CREATE POLICY kobo_inbox_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kobo-inbox' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS kobo_inbox_delete ON storage.objects;
CREATE POLICY kobo_inbox_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kobo-inbox' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Daily sweep ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('lascis-kobo-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('lascis-kobo-sweep', '23 3 * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/kobo-sync/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kobo-token', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'KOBO_OPDS_TOKEN'), '')
    ),
    body := '{}'::jsonb
  );
$cron$);
