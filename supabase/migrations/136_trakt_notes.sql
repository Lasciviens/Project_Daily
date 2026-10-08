-- 136 — Trakt notes (personal_note ↔ the Trakt note on a movie or show) and
-- follow lists that keep what Trakt has not taken yet. docs/trakt/PLAN.md §12.
-- Additive; updates no existing row. Safe to re-run.
--
-- 1. Notes, app → Trakt. A change to personal_note on a movie or show entry
--    queues note_set (have this note on Trakt) or note_remove (cleared, or
--    the entry removed — the Trakt note id it was linked to goes along) in
--    trakt_outbox; trakt-api's sync sends it. The key is note:<type>:<tmdb>,
--    so a waiting note never holds back the rest of the title's mirror
--    (118's favorites rule). Writes made by the sync itself are skipped
--    (117's trakt_sync_writing()), and nothing is queued while Trakt is not
--    connected. Episode notes stay app-only. 132's trigger functions are not
--    touched: this is its own trigger.
-- 2. trakt_note_text on both entry tables, beside 116's trakt_note_id: the
--    note as both sides held it at the last sync (NULL = no note on either
--    side then). It lets the sync tell which side changed a note, so a note
--    typed here is never overwritten by Trakt's older text. Written by
--    trakt-api only.
-- 3. trakt_sync_state.notes_synced_at: when the notes were last compared in
--    full. NULL = never — the next sync compares them all and sends the
--    app's notes Trakt doesn't have yet. Disconnecting clears it.
-- 4. media_follows.pending_list_ids / list_error / list_error_at: films a
--    follow's linked Trakt list has not taken yet (Trakt's 420 account limit,
--    an error, Trakt not connected at the check). The follow check sends
--    them again and the Lists page says why they wait; a film is never
--    recorded as done before Trakt took it.

-- ── 2. The last synced note ──────────────────────────────────────────────────
ALTER TABLE public.user_movie_entries ADD COLUMN IF NOT EXISTS trakt_note_text text;
ALTER TABLE public.user_tv_entries    ADD COLUMN IF NOT EXISTS trakt_note_text text;
COMMENT ON COLUMN public.user_movie_entries.trakt_note_text IS
  'The note as this app and Trakt both held it at the last sync (NULL = no note on either side); written by trakt-api only.';
COMMENT ON COLUMN public.user_tv_entries.trakt_note_text IS
  'The note as this app and Trakt both held it at the last sync (NULL = no note on either side); written by trakt-api only.';

-- ── 3. Notes compared in full ────────────────────────────────────────────────
ALTER TABLE public.trakt_sync_state ADD COLUMN IF NOT EXISTS notes_synced_at timestamptz;

-- ── 4. Follow lists: what Trakt has not taken yet ────────────────────────────
ALTER TABLE public.media_follows
  ADD COLUMN IF NOT EXISTS pending_list_ids integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS list_error       text,
  ADD COLUMN IF NOT EXISTS list_error_at    timestamptz;

-- ── 1. The notes outbox trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trakt_outbox_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_type text := CASE WHEN TG_TABLE_NAME = 'user_movie_entries' THEN 'movie' ELSE 'show' END;
  o_note text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE nullif(btrim(OLD.personal_note, E' \t\r\n'), '') END;
  n_note text := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE nullif(btrim(NEW.personal_note, E' \t\r\n'), '') END;
  o_id bigint := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.trakt_note_id END;
  v_tmdb integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A removed entry takes its Trakt note along; one never sent has nothing there.
    IF o_id IS NULL THEN RETURN NULL; END IF;
  ELSIF o_note IS NOT DISTINCT FROM n_note THEN
    RETURN NULL;
  END IF;
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  IF v_type = 'movie' THEN
    SELECT tmdb_id INTO v_tmdb FROM public.movies
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.movie_id ELSE NEW.movie_id END;
  ELSE
    SELECT tmdb_id INTO v_tmdb FROM public.tv_series
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tv_series_id ELSE NEW.tv_series_id END;
  END IF;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  IF n_note IS NOT NULL THEN
    PERFORM public.trakt_enqueue(v_user, 'note_set', 'note:' || v_type || ':' || v_tmdb,
      jsonb_build_object('type', v_type, 'tmdb', v_tmdb));
  ELSE
    PERFORM public.trakt_enqueue(v_user, 'note_remove', 'note:' || v_type || ':' || v_tmdb,
      jsonb_build_object('type', v_type, 'tmdb', v_tmdb, 'note_id', o_id));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trakt_outbox_note ON public.user_movie_entries;
CREATE TRIGGER trg_trakt_outbox_note AFTER INSERT OR UPDATE OF personal_note OR DELETE
  ON public.user_movie_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_note();
DROP TRIGGER IF EXISTS trg_trakt_outbox_note ON public.user_tv_entries;
CREATE TRIGGER trg_trakt_outbox_note AFTER INSERT OR UPDATE OF personal_note OR DELETE
  ON public.user_tv_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_note();
