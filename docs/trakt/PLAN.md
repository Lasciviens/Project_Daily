# Trakt integration — plan

Status: **plan only, nothing built.** Written 30.09.2026, decisions confirmed the same
day. Delete this file once the feature ships and CLAUDE.md's Media section carries it.

## 1. The rules (owner's decisions)

- **Trakt is the source of truth for everything Trakt can hold.** If it exists on
  Trakt, Trakt's version wins. Only things Trakt has no place for stay app-only.
- **Two-way.** Every change made in the app that Trakt can hold is written to Trakt.
- **Rewatches count.** Every play is kept, with its own date.
- **One film is one row, one show is one row.** The TMDB id is the identity
  (`movies.tmdb_id` / `tv_series.tmdb_id` are already `UNIQUE NOT NULL`); Trakt, IMDb
  and TVDB ids are extra columns on that same row. Rotten Tomatoes attaches by TMDB id.
- **Preview before the first write.** The first import is a dry run showing counts
  (matched, new, changes, pushes to Trakt, unmatched) before anything is saved.
- **App-only data is never deleted by a sync.** Data that came from Trakt mirrors
  Trakt exactly, including removals.

## 2. What Trakt holds vs what stays in the app

| Data | Trakt endpoint (read / write) | Where it lives here | Owner |
|---|---|---|---|
| Every play (movie or episode), with date and how (`watch`/`scrobble`/`checkin`) | `GET /sync/history` · `POST /sync/history`, `/sync/history/remove` (by play id) | new `media_plays` | **Trakt** |
| Watched summary (plays, last watched) | `GET /sync/watched/{movies,shows}` | derived from `media_plays` | Trakt |
| Ratings 1–10 — movies, shows, seasons, episodes | `GET /sync/ratings` · `POST /sync/ratings`, `/remove` | `user_movie_entries.rating`, `user_tv_entries.rating`, `user_tv_episodes.rating` (+ season ratings, see §4) | **Trakt** |
| Watchlist (with its order and note) | `GET /sync/watchlist` · `POST`, `/remove`, `/reorder` | `status='wishlist'` + `watchlist_rank` | **Trakt** |
| Favorites | `GET /sync/favorites` · `POST`, `/remove` | new `is_favorite` | **Trakt** |
| Dropped shows | `GET /users/hidden/dropped` · `POST /users/hidden/dropped`, `/remove` | `user_tv_entries.status='dropped'` | **Trakt** |
| Notes (VIP, private, ≤ 500 characters) on a movie, show, episode or play | `GET /users/me/notes` · `POST /notes`, `PUT/DELETE /notes/{id}` | `personal_note` (+ `trakt_note_id`) | **Trakt** |
| Paused mid-film/episode (%) | `GET /sync/playback` · `DELETE /sync/playback/{id}` | new `playback_progress` — "Continue watching" | Trakt |
| My upcoming episodes | `GET /calendars/my/shows` | replaces the TMDB-built release list for shows you follow | Trakt |
| Change detection | `GET /sync/last_activities` (one call) | `trakt_sync_state` | — |
| Personal lists | `/users/me/lists…` | **later**, not in this build | — |
| Collection (owned copies) | `/sync/collection` | **not used** — no owned-media feature here | — |
| Paused (on hold) status | *(no Trakt equivalent)* | `user_tv_entries.status='paused'` | **app** |
| Dropped **movie** | *(Trakt drops shows only)* | `user_movie_entries.status='dropped'` | **app** |
| Priority, planned sessions (`time_blocks`) | *(none)* | as today | **app** |
| Posters, overview, genres, runtimes | TMDB (as today) | `movies` / `tv_series` | TMDB |
| Rotten Tomatoes + Metacritic scores | MDBList, by TMDB id | `movies` / `tv_series` rating columns | MDBList |

Checkins and scrobbling are not built: plays scrobbled by Plex, Infuse or your TV
reach Trakt and come back here through the normal history sync.

## 3. Identity — one row per title

Trakt sends every item with `ids: { trakt, slug, tmdb, imdb, tvdb }`.

1. `ids.tmdb` present → upsert the catalogue row on `tmdb_id`, fill the other ids.
2. No TMDB id but an IMDb id → TMDB `/find/{imdb_id}`, then step 1.
3. Neither → `trakt_unmatched` (shown on the Media page for a manual pick). Never a
   guessed row.

Catalogue columns added: `trakt_id`, `trakt_slug`, `imdb_id` (identifier only — no IMDb
data is used) on both; `tvdb_id` on `tv_series`. Each gets a partial unique index
(`WHERE … IS NOT NULL`) so no two rows can claim the same id. Existing rows are
backfilled by `tmdb_id` so today's library and Trakt meet on the same rows.

Episodes match on show + season + episode — the existing unique key of
`user_tv_episodes`.

## 4. Tables

**New — user data**

| Table | Holds | Key facts |
|---|---|---|
| `media_plays` | one row per play: `movie_id` **or** `tv_series_id`+`season`+`episode`, `watched_at`, `action`, `trakt_history_id` (bigint, unique when set), `origin` (`trakt` / `app`) | the rewatch record; counts and "last watched" are derived from it |
| `user_tv_season_ratings` | `tv_series_id`, `season`, `rating` | Trakt rates seasons; nothing here held that before |

**Changed — existing tables** (columns added, nothing removed)

| Table | Added |
|---|---|
| `movies`, `tv_series` | the ids in §3; `rt_critics`, `rt_audience`, `metacritic`, `ratings_fetched_at` |
| `user_movie_entries`, `user_tv_entries` | `is_favorite`, `watchlist_rank`, `trakt_note_id`, `trakt_synced_at` |
| `user_tv_episodes` | `trakt_note_id` (its `watched_at` stays the latest play, kept by a trigger from `media_plays`) |
| `user_movie_entries` | `playback_progress` (%, from `/sync/playback`); `watched_at` = latest play (trigger) |

**New — plumbing** (never in `ai-proxy`'s `DB_CATALOG`; no audit trigger on the secret table)

| Table | Holds |
|---|---|
| `trakt_tokens` | access + refresh token, expiry (the `psn_tokens` rule) |
| `trakt_sync_state` | the last `last_activities` timestamps per category, last full reconcile |
| `trakt_outbox` | pending writes to Trakt, one row per change, retried in order (the Google Tasks outbox pattern: per-item FIFO, checkpointed, never a duplicate send) |
| `trakt_unmatched` | Trakt items with no TMDB/IMDb match, for a manual pick |

Why one plays table and not a count column: two-way sync has to remove single plays
on Trakt, which needs each play's `trakt_history_id` — a count can't carry that.

## 5. How a sync runs

1. `GET /sync/last_activities` — one call; compare with `trakt_sync_state`.
2. Only categories that changed are fetched: history since the last sync (`start_at`),
   ratings, watchlist, favorites, dropped, notes, playback.
3. **Removals:** history paging only shows additions, so when `watched_at` moved,
   `GET /sync/watched` (plays per title) is compared with local counts; any title that
   differs has its history re-read (`/sync/history/{type}/{id}`) and mirrored exactly.
   A weekly full reconcile catches anything else.
4. Each item: match (§3) → upsert → derived fields updated by trigger.
5. Then the outbox drains (app → Trakt).

Limits: reads 1,000 per 5 minutes, writes **1 per second** — the outbox paces itself.
Runs on a cron (every 30 min), a manual Sync button, and after app edits.
Tokens last 24 hours and refresh automatically.

## 6. Two-way rules

- An app edit writes locally at once (the UI stays instant) and adds an outbox row.
- A play logged here gets `origin='app'` and no history id; the next history read
  links it to Trakt's id (same title and time) — so it is never counted twice.
- If Trakt rejects a write (e.g. an item Trakt doesn't know), the row stays app-only
  and the Media page says so.
- **First import:** titles you watched in the app but not on Trakt are listed in the
  preview and pushed to Trakt when you confirm — after that, Trakt holds the complete
  record.

## 7. Rotten Tomatoes

No free official API (licensed access starts around $60,000 a year). **MDBList**
looks up by TMDB id and returns Tomatometer, audience score and Metacritic. Fetched only
for titles in your library, refreshed at most weekly. Needs a free MDBList API key
(`MDBLIST_API_KEY`); its daily limit is confirmed when the key is created.

## 8. Pieces

| Piece | What |
|---|---|
| Migration A | catalogue ids + rating columns, user-table columns, `media_plays`, `user_tv_season_ratings`, triggers keeping `watched_at` = latest play |
| Migration B | `trakt_tokens`, `trakt_sync_state`, `trakt_outbox`, `trakt_unmatched` |
| `trakt-oauth` | connect (code exchange), disconnect (revoke), refresh |
| `trakt-sync` | preview, first import, incremental sync, reconcile, outbox drain; user JWT or cron secret |
| Ratings step | MDBList by TMDB id, inside `trakt-sync` |
| Pure module + verify script | matching, mapping, reconcile diff — `scripts/verify-trakt-mapping.cjs` |
| UI | Settings → Subscriptions card; Media: import preview, sync status, unmatched list, Continue watching, favorites, RT chips |

## 9. Phases

| Phase | Result | Gate |
|---|---|---|
| 1 | Connect Trakt + **dry-run preview** | the counts look right to you |
| 2 | First import (+ push of app-only watches), id backfill | no duplicate titles; paused/priority untouched |
| 3 | Incremental sync + reconcile (cron + Sync button) | a play scrobbled elsewhere appears within 30 min; a play removed on Trakt disappears here |
| 4 | Two-way through the outbox | a rating, watch or note made here shows on trakt.tv |
| 5 | Favorites, notes, Continue watching, my calendar | each visible on the Media page |
| 6 | Rotten Tomatoes / Metacritic | scores on posters and in details |

## 10. Owner steps

- Done: Trakt app created; `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` in Vault.
- Redirect URIs on the Trakt app: `https://lasciviens.github.io/Project_Daily/` (and
  `http://localhost:5173/Project_Daily/` for local testing).
- Per phase: apply the named migration and deploy the named function.
- Phase 6: free MDBList account → `MDBLIST_API_KEY` in Vault.
