-- 128: Books round 3 — news has no status, categories and subjects, file sizes,
-- the Kobo's storage, and books prepared before they are sent.
--
--   books.read_status   now nullable: a News Downloader issue (kind = 'news')
--                        never has a status, rating, queue place or read dates.
--                        A trigger enforces it for every writer (web, kobo-sync,
--                        AI); a book without a status reads as 'want'.
--   books.categories    the owner's own shelves ("Fantasy", "Work"), text[].
--   books.subjects      topics from the file (EPUB subjects, via the Kobo), text[].
--   books.file_size     bytes of the file on the Kobo (sent by plugin 1.2).
--   kobo_feed_state     storage_total / storage_free / storage_at: the Kobo's
--                        user storage at its last sync (plugin 1.2).
--   book_deliveries.book_id  the library row a sent file was prepared as.
--
-- Updates rows: every news row loses its status/rating/queue place (the owner's
-- rule: "news is only news"). Idempotent.

ALTER TABLE public.books ALTER COLUMN read_status DROP NOT NULL;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS subjects   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS file_size  bigint CHECK (file_size IS NULL OR file_size >= 0);

CREATE OR REPLACE FUNCTION public.books_kind_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'news' THEN
    NEW.read_status := NULL;
    NEW.rating      := NULL;
    NEW.queue_order := NULL;
    NEW.started_at  := NULL;
    NEW.finished_at := NULL;
  ELSIF NEW.read_status IS NULL THEN
    NEW.read_status := 'want';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_books_kind_rules ON public.books;
CREATE TRIGGER trg_books_kind_rules BEFORE INSERT OR UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.books_kind_rules();

UPDATE public.books SET read_status = NULL
WHERE kind = 'news' AND (read_status IS NOT NULL OR rating IS NOT NULL OR queue_order IS NOT NULL
  OR started_at IS NOT NULL OR finished_at IS NOT NULL);

ALTER TABLE public.kobo_feed_state
  ADD COLUMN IF NOT EXISTS storage_total bigint,
  ADD COLUMN IF NOT EXISTS storage_free  bigint,
  ADD COLUMN IF NOT EXISTS storage_at    timestamptz;

ALTER TABLE public.book_deliveries
  ADD COLUMN IF NOT EXISTS book_id uuid REFERENCES public.books(id) ON DELETE SET NULL;
