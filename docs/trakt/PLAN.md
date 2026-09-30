# Trakt integration — plan

Status: **plan only, nothing built.** Written 30.09.2026. Delete this file once the
feature ships and CLAUDE.md's Media section is the settled record.

## 1. Goal and the rules that shape everything

- **Trakt** (the owner has VIP) becomes the source of truth for *what was watched,
  when, and how it was rated*. The app keeps using **TMDB** for posters and details.
- **One film is one row. One show is one row.** Every source (TMDB, Trakt, Rotten
  Tomatoes ratings) attaches to the same catalogue row; nothing is ever stored twice.
- **The TMDB id is the identity.** `movies.tmdb_id` and `tv_series.tmdb_id` are
  already `UNIQUE NOT NULL` (migration 002), so the database itself refuses a
  duplicate title. Everything else is an extra id on that same row.
- **A sync never deletes your data.** It adds and updates; it never removes a
  local row, a note, a priority, or a paused/dropped status.
- **Preview before the first write.** The first import runs as a dry run and shows
  counts (matched, new, conflicts, unmatched) before anything is saved.

## 2. What already exists

| Table | Role | Keyed by |
|---|---|---|
| `movies` | shared catalogue, one row per film | `tmdb_id` (unique) |
| `tv_series` | shared catalogue, one row per show | `tmdb_id` (unique) |
| `user_movie_entries` | your status, rating (1–10), note, watched date | user + movie |
| `user_tv_entries` | your status, rating, note, started/finished | user + show |
| `user_tv_episodes` | **the one source of TV progress** (migration 050) | user + show + season + episode |

Trakt rates on the same 1–10 scale, and its statuses map cleanly onto ours, so
**no parallel "Trakt" tables for user data are needed.**

## 3. Identity — how every source becomes one row

Trakt returns every movie/show/episode with an `ids` object:
`{ trakt, slug, tmdb, imdb, tvdb }`.

**Catalogue columns added** (migration A):

| Table | New columns | Why |
|---|---|---|
| `movies` | `trakt_id int`, `trakt_slug text`, `imdb_id text` | `imdb_id` is only an identifier (the key the ratings services use) — no IMDb data is fetched or shown |
| `tv_series` | `trakt_id int`, `trakt_slug text`, `imdb_id text`, `tvdb_id int` | shows also carry a TVDB id |

Each new id column gets a **partial unique index** (`WHERE x IS NOT NULL`), so two rows
can never claim the same Trakt/IMDb id either.

**Matching, in order, for every item Trakt sends:**
1. `ids.tmdb` present → upsert the catalogue row on `tmdb_id` and fill the other ids.
   This covers nearly everything (Trakt itself is built on TMDB).
2. No TMDB id but an IMDb id → ask TMDB `/find/{imdb_id}?external_source=imdb_id`,
   then step 1.
3. Neither → the item goes to an **unmatched list** (`trakt_unmatched`, a small
   table) that the Media page shows for a manual pick. It never creates a guessed row.

**Existing rows:** a one-time backfill fills `trakt_id`/`imdb_id` on the rows you
already have, matched by `tmdb_id` — so your current library and Trakt meet on the
same rows from day one.

**Episodes** need no new id: Trakt episodes are matched by show + season + episode
number onto `user_tv_episodes`' existing unique key.

## 4. Mapping your data

| Trakt | Our field | Rule |
|---|---|---|
| Watched movie (history) | `user_movie_entries.status='completed'`, `watched_at` = last play | creates the entry if missing |
| Watched episodes | `user_tv_episodes.watched_at` | one row per episode; the existing cache trigger keeps `current_season/episode` right |
| Show progress | `user_tv_entries.status` | all aired episodes watched and the show ended → `completed`, else `watching` — **never** overwrites your `paused`/`dropped` |
| Watchlist | `status='wishlist'` | only when there is no entry yet (or it is already wishlist) |
| Ratings (1–10) | `rating` | same scale, copied as-is |
| Rewatches (plays) | new `plays int` on `user_movie_entries` and `user_tv_episodes` | count + last watched date; see decision 1 |

**Never touched by a sync:** `personal_note`, `priority`, `paused`/`dropped`,
planned `time_blocks`.

**Conflicts after the first import:** Trakt wins for watched state and rating
(it is the source of truth); your note/priority/paused stay yours.

## 5. Two-way sync (phase 2)

Marking watched, rating, or adding to the watchlist in the app also writes to Trakt
(`/sync/history`, `/sync/ratings`, `/sync/watchlist`). Writes go through a small
**outbox table** (`trakt_outbox`: one row per pending change, retried with backoff) —
the pattern the Google Tasks sync already uses — so a failed network call never loses
a change and never double-sends one.

## 6. Keeping it cheap

- **One call decides what changed:** `GET /sync/last_activities` returns a timestamp
  per category (watched, rated, watchlisted…). Only categories newer than the last
  sync are fetched; history is paged with `start_at` = last sync time.
- Trakt's limit is roughly 1,000 GET calls per 5 minutes; a normal sync is a handful.
- Runs on a **cron** (every 30–60 min), a manual **Sync** button, and right after an
  outbox push.
- Things you watch in Plex, Infuse or on TV that scrobble to Trakt arrive here through
  the same sync — nothing extra to build.

## 7. Tokens and security

- `trakt_tokens` — one row per user, holds access + refresh token. **No audit trigger,
  never in `ai-proxy`'s `DB_CATALOG`** (the `psn_tokens` rule: it holds live secrets).
- Since 20.03.2025 a Trakt access token lasts **24 hours**; the function refreshes it
  automatically from `expires_in` before every call.
- Client id/secret live in Vault (`TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`).
- Connect/disconnect and status live on **Settings → Subscriptions** (the one place
  for connections), with the Trakt VIP subscription listed on the same card.

## 8. Rotten Tomatoes

- **There is no free official API** — licensed access starts at about $60,000 a year.
- **MDBList** (recommended) looks ratings up **by TMDB id** and returns the Tomatometer
  and audience score (plus Metacritic, Letterboxd). It needs a free API key; the exact
  free-tier limit must be confirmed when the key is created.
- The alternative, **OMDb**, only looks up by IMDb id (which we will store anyway) and
  returns just the Tomatometer, 1,000 requests a day free.
- Stored on the catalogue row: `rt_critics int`, `rt_audience int`,
  `ratings_fetched_at` (plus `metacritic` if you want it). Fetched only for titles in
  your library, refreshed at most weekly — a few calls a day.
- Shown as a small score chip on posters and in the detail popup.

## 9. Pieces to build

| Piece | What |
|---|---|
| Migration A | catalogue id columns + partial unique indexes, `plays`, rating columns |
| Migration B | `trakt_tokens`, `trakt_sync_state` (last activities per category), `trakt_unmatched`, `trakt_outbox` |
| `trakt-oauth` edge function | connect (code exchange), disconnect, token refresh |
| `trakt-sync` edge function | dry-run preview, first import, incremental sync, outbox push; user JWT or cron secret |
| Ratings step | inside `trakt-sync` (or its own `media-ratings` function): MDBList by TMDB id |
| UI | Settings → Subscriptions card; Media: sync status, "last synced", unmatched review list, RT chip, import preview dialog |
| Verify script | `scripts/verify-trakt-mapping.cjs` over the pure matching/mapping module |

## 10. Phases

| Phase | Result | Gate |
|---|---|---|
| 1 | Connect Trakt, **dry-run preview** of the first import | the counts look right to you |
| 2 | First import + backfill of ids on existing rows | no duplicate titles; your notes/paused untouched |
| 3 | Incremental sync (cron + Sync button) | a movie watched in another app appears within the hour |
| 4 | Two-way: app → Trakt through the outbox | marking watched here shows on trakt.tv |
| 5 | Rotten Tomatoes (+ Metacritic) scores | scores on posters and in details |

## 11. What you'll do

1. On trakt.tv → Settings → Your API Apps → **New application** (VIP only). Redirect
   URI: the one I give you with phase 1.
2. Put `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET` in Supabase Vault.
3. Per phase: apply the migration and deploy the function I name.
4. For phase 5: create a free MDBList account and put `MDBLIST_API_KEY` in Vault.

## 12. Decisions for you

1. **Rewatches:** a `plays` count plus the last date (recommended — lean), or a full
   per-play history table (every rewatch with its own date)?
2. **Two-way sync:** wanted (recommended), or Trakt → app only?
3. **Ratings service:** MDBList (by TMDB id, recommended) or OMDb (by IMDb id)?
4. **Movies you watched but never added here:** create them as Completed (recommended),
   or import only titles already in your library?
