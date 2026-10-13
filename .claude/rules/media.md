---
paths:
  - "src/features/media/**"
  - "supabase/functions/trakt-api/**"
---
# Media and Trakt rules

Trakt is the online service that keeps the owner's film and series history; the app syncs with it both ways. Background: `docs/features/media.md`, API facts: `docs/trakt/REFERENCE.md`.

- TV progress has one source: `user_tv_episodes`. The `current_season`/`current_episode` cache columns are written only by their trigger (050).
- Marking an episode watched has one write path (`useMarkEpisodeWatched`) and never overwrites an existing watch date.
- Trakt is the source of truth for what it holds (watched + plays, ratings, watchlist, favorites, dropped shows, notes). App-only facts (Paused, priority, plans) stay local. When unsure whether something is only on screen or also stored: the data is one, and Trakt sees what the app shows.
- Changes reach Trakt through the outbox triggers; the sync's own writes carry `x-trakt-sync: 1` so nothing loops.
- Lists are Trakt lists; an automatic list keeps only its rule in `media_follows`.
- "Coming soon" is derived from the release date, never a stored status.
- An unknown watch date is NULL for movies and the epoch for episodes; screens show "date unknown". Without TMDB data, never guess a show's status.
- The import and sync plans are GENERATED into `trakt-api` by `scripts/sync-trakt-shared.mjs`.
- Notes sync is a three-way comparison through `trakt_note_text`; an edit is never lost to a delete.
