-- 119 — Follow a franchise, studio, director or actor (Media → Lists).
-- Additive; updates no existing row. Safe to re-run.
--
-- media_follows: what you follow. A daily check (trakt-api, inside the
-- 30-minute sync cron, and the "Check now" button) reads TMDB for the
-- follow's titles; titles not in known_ids become a 'new_title' event (and
-- are added to the linked Trakt list, if any), and a trailer not in
-- trailer_keys on a recent or upcoming title becomes a 'trailer' event. The
-- first check only records the baseline, so following never floods events.
-- media_follow_events: what happened; seen_at marks it read.

CREATE TABLE IF NOT EXISTS public.media_follows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('collection', 'company', 'director', 'actor')),
  tmdb_id         integer NOT NULL,
  name            text NOT NULL,
  trakt_list_id   bigint,
  known_ids       integer[] NOT NULL DEFAULT '{}',
  trailer_keys    text[] NOT NULL DEFAULT '{}',
  last_checked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, tmdb_id)
);

CREATE TABLE IF NOT EXISTS public.media_follow_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  follow_id   uuid NOT NULL REFERENCES public.media_follows(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('new_title', 'trailer')),
  tmdb_id     integer NOT NULL,
  title       text NOT NULL,
  poster_path text,
  release_date date,
  video_key   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  seen_at     timestamptz
);
CREATE INDEX IF NOT EXISTS media_follow_events_user_idx ON public.media_follow_events (user_id, created_at DESC);

ALTER TABLE public.media_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_follow_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_follows' AND policyname = 'Users manage own media follows') THEN
    CREATE POLICY "Users manage own media follows" ON public.media_follows FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_follow_events' AND policyname = 'Users manage own media follow events') THEN
    CREATE POLICY "Users manage own media follow events" ON public.media_follow_events FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- No trg_audit: the daily check rewrites known_ids / last_checked_at on every
-- follow (the bulk-sync exemption, like the Trakt and Hevy mirrors).
