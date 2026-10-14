---
paths:
  - "src/features/media/**"
  - "supabase/functions/trakt-api/**"
---
# Media and Trakt rules

Trakt is the online service that keeps the owner's film and series history; the app syncs with it both ways. Background: `docs/features/media.md`, API facts: `docs/trakt/REFERENCE.md`.

- TV progress has one source: `user_tv_episodes`. The `current_season`/`current_episode` cache columns are written only by their trigger (050).
- Marking an episode watched has one write path (`useMarkEpisodeWatched`, `again` = one more watch) and never overwrites an existing watch date.
- Every watch is a `media_watches` row with its own date (149). `watched_at`/`repeat_count` on episodes and movies are a cache the database keeps — new code writes watches, never the cache; a date change names the one watch it moves (`WatchPickSheet` when there are several); only the sync sets `trakt_history_id`/`source`.
- Trakt gets one play per watch change (`history_add` / `history_remove_play`); a whole item's `history_remove` only when it is unmarked entirely — never "remove all + re-add" for a date.
- A rewatch is `rewatch_round` (Watching); its next episode is the first aired regular one below the round (`watches.ts`), the database ends it, and the sync never flips it to Completed.
- "When watched?" is one sheet (`WatchedWhenSheet`), asked only through `useWatchedWhenPrompt`; for more than one episode use `askMany`, whose 5th option opens `SpreadWatchedSheet` — never a copy of either (`verify-watched-when`).
- Trakt is the source of truth for what it holds (watched + plays, ratings, watchlist, favorites, dropped shows, notes). App-only facts (Paused, priority, plans) stay local. When unsure whether something is only on screen or also stored: the data is one, and Trakt sees what the app shows.
- Changes reach Trakt through the outbox triggers; the sync's own writes carry `x-trakt-sync: 1` so nothing loops.
- Lists are Trakt lists; an automatic list keeps only its rule in `media_follows`.
- "Coming soon" is derived from the release date, never a stored status.
- An unknown watch date is NULL for movies and the epoch for episodes; screens show "date unknown". Without TMDB data, never guess a show's status.
- The import and sync plans are GENERATED into `trakt-api` by `scripts/sync-trakt-shared.mjs`.
- Notes sync is a three-way comparison through `trakt_note_text`; an edit is never lost to a delete.
