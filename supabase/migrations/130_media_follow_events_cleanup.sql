-- 130 — What's new (media_follow_events): remove films that were never new.
-- Run AFTER redeploying trakt-api (the new follow rules). Safe to re-run.
--
-- Root cause: the follow check called a film "new" when TMDB listed it for
-- the first time, not when it came out — a late cameo credit, a keyword or
-- studio tagged onto an old film, or a studio's "newest 100" window shifting
-- reported long-released films (Avengers: Endgame) as new titles.
-- src/features/media/trakt/followRules.ts now decides by the film's own date.
--
-- 1. Delete the events that rule rejects and SQL can decide exactly: a film
--    whose release date was more than 30 days before the day the event was
--    written (isShowableFollowEvent). The app already hides these rows, so
--    nothing visible changes; an event with no release date is kept.
DELETE FROM public.media_follow_events
WHERE release_date IS NOT NULL
  AND release_date < (created_at AT TIME ZONE 'UTC')::date - 30;

-- 2. Documentaries, TV movies, shorts, cameos and archive-footage credits
--    can't be told apart in SQL (the events don't store genres or the credit).
--    Make every follow due now, so the next sync run (within 30 minutes while
--    Trakt is connected, 15 follows per run) or "Check now" re-checks it and
--    clears what the rule rejects. last_checked_at stays non-null, so no follow
--    is treated as a first check (baseline).
UPDATE public.media_follows
SET last_checked_at = last_checked_at - interval '1 day'
WHERE last_checked_at IS NOT NULL
  AND last_checked_at > now() - interval '20 hours';
