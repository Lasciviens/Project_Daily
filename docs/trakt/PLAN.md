# Trakt integration — plan

Status: **phase 1 built (connect + dry-run preview)** — migration `116_trakt.sql`, edge
function `trakt-api`, `src/features/media/trakt/`, Settings → Subscriptions → Trakt.
Written 30.09.2026; the owner's second pass the same day cut per-play history and
season/episode ratings (below). Delete this file once the feature ships and CLAUDE.md's Media section carries it.

## 1. The rules (owner's decisions)

- **Trakt is the source of truth for everything Trakt can hold.** If it exists on
  Trakt, Trakt's version wins. Only things Trakt has no place for stay app-only.
- **Two-way.** Every change made in the app that Trakt can hold is written to Trakt.
- **Rewatches count, as a number.** No per-play history (too much data): a title or
  episode stores its play count as `repeat_count` = plays − 1 (the column Media's stats
  already read), plus the latest watch date.
- **No season or episode ratings** — only movie and show ratings.
- **Notes are one thing.** `personal_note` IS the Trakt note (`trakt_note_id` links them).
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
| Watched + play counts + last watched (movies, episodes) | `GET /sync/watched/{movies,shows}` · `POST /sync/history`, `/sync/history/remove` | `status='completed'` / `user_tv_episodes` row + `repeat_count` + `watched_at` | **Trakt** |
| Ratings 1–10 — movies and shows only | `GET /sync/ratings/{movies,shows}` · `POST /sync/ratings`, `/remove` | `user_movie_entries.rating`, `user_tv_entries.rating` | **Trakt** |
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

## 4. Tables (migration `116_trakt.sql`, additive only)

**Changed — existing tables** (columns added, nothing removed, no row updated)

| Table | Added |
|---|---|
| `movies`, `tv_series` | the ids in §3; `rt_critics`, `rt_audience`, `metacritic`, `ratings_fetched_at` |
| `user_movie_entries` | `is_favorite`, `watchlist_rank`, `trakt_note_id`, `playback_progress`, `playback_paused_at`, `trakt_synced_at` (`repeat_count` already existed) |
| `user_tv_entries` | `is_favorite`, `watchlist_rank`, `trakt_note_id`, `trakt_synced_at` |
| `user_tv_episodes` | `repeat_count`, `trakt_note_id`, `playback_progress`, `playback_paused_at` |

**New — plumbing** (never in `ai-proxy`'s `DB_CATALOG`; no audit trigger on the secret table)

| Table | Holds |
|---|---|
| `trakt_tokens` | access + refresh token, expiry, username — RLS on with no policy (service role only; the `psn_tokens` rule) |
| `trakt_sync_state` | the last `last_activities`, last sync / full reconcile, last error (owner can read) |
| `trakt_outbox` | pending writes to Trakt, one row per change, drained oldest-first per item (the Google Tasks outbox pattern) — service role only |
| `trakt_unmatched` | Trakt items with no TMDB match, for a manual pick |

## 5. How a sync runs

1. `GET /sync/last_activities` — one call; compare with `trakt_sync_state`.
2. Only categories that changed are fetched: history since the last sync (`start_at`),
   ratings, watchlist, favorites, dropped, notes, playback.
3. **Removals:** when `watched_at` moved, `GET /sync/watched` (plays per title, per
   episode) is compared with local counts and mirrored exactly (Trakt's `reset_at`
   marks a show restarted). A weekly full reconcile catches anything else.
4. Each item: match (§3) → upsert.
5. The outbox drains FIRST (app → Trakt), so the mirror in steps 2–4 never undoes a change made here; items still waiting (or just sent) are skipped by the mirror.

Watched endpoints (since 03.07.2026): paginated, seasons only with `extended=progress` (100 per page).
Limits: reads 1,000 per 5 minutes, writes **1 per second** — the outbox paces itself.
Runs on a cron (every 30 min), a manual Sync button, and after app edits.
Tokens last 24 hours and refresh automatically.

## 6. Two-way rules

- An app edit writes locally at once (the UI stays instant) and adds an outbox row.
- A watch logged here is sent as one play; the next watched read returns the new
  count, so nothing is counted twice.
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
| `116_trakt.sql` | everything in §4 ✅ |
| `trakt-api` | ✅ `authorize_url`, `connect`, `status`, `disconnect`, `snapshot`, `import`, `sync` (outbox drain → mirror), cron secret |
| Ratings step | MDBList by TMDB id, inside `trakt-api` |
| Pure module + verify script | ✅ `traktPreview.ts` — `scripts/verify-trakt-preview.cjs`; later the mapping/reconcile diff |
| UI | Settings → Subscriptions card; Media: import preview, sync status, unmatched list, Continue watching, favorites, RT chips |

## 9. Phases

| Phase | Result | Gate |
|---|---|---|
| 1 ✅ | Connect Trakt + **dry-run preview** | the counts look right to you |
| 2 ✅ | First import (+ push of app-only watches), id backfill | no duplicate titles; paused/priority untouched |
| 3 ✅ | Incremental sync + reconcile (cron + Sync button) | a play scrobbled elsewhere appears within 30 min; a play removed on Trakt disappears here |
| 4 ✅ | Two-way through the outbox (watched, plays, ratings, watchlist, dropped; notes come with phase 5) | a rating, watch or note made here shows on trakt.tv |
| 5 ◐ | ✅ Favorites (two-way, migration 118), ✅ Continue watching (`/sync/playback`, live), ✅ my calendar (`/calendars/my/shows`, in Coming soon), ✅ personal lists (live, Media → Lists); **notes not yet** | each visible on the Media page |
| 6 ✅ | Rotten Tomatoes (critics + audience), Metacritic, IMDb, Letterboxd via MDBList — title page chips, Library 🍅 + sort | scores on posters and in details |

## 10. Owner steps

- Done: Trakt app created; `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` / `MDBLIST_API_KEY` in secrets.
- Phase 1: apply `116_trakt.sql`, deploy `trakt-api` (JWT verification **ON**).
- Phase 2: redeploy `trakt-api`, then Preview import → Import now. Watched/watching beats wishlist on both sides (owner, 30.09.2026).
- Phases 3–4: apply `117_trakt_sync.sql`; redeploy `trakt-api` with JWT verification **OFF**; `TRAKT_SYNC_SECRET` in Edge secrets + Vault; `TMDB_API_KEY` in Edge secrets.
- Redirect URIs on the Trakt app: `https://lasciviens.github.io/Project_Daily/` (and
  `http://localhost:5173/Project_Daily/` for local testing).
- Per phase: apply the named migration and deploy the named function.

## 11. Lists (built 30.09.2026) and what is still proposed

- ✅ **Lists = Trakt personal lists, read live** (no local table: Trakt holds them): Media → Lists
  (pick, see, remove, new, delete), "Add to list" on every title page, and **Save as list** on a
  film's franchise strip (TMDB `belongs_to_collection` → `/collection/{id}`, release order).
  Private by default. Free accounts have a small list/item allowance (Trakt 420).
- Still proposed (not built):
- **Auto-match new titles:** a list can follow a source — a **TMDB collection** (e.g. Harry Potter;
  a film's `belongs_to_collection`) or a **TMDB company/keyword** (e.g. Marvel Studios, whose films
  span many collections). A daily job checks the source; a new title is added to the list (and to
  the Trakt list).
- **Alerts:** a new title or a new **trailer** (TMDB `/movie/{id}/videos`, type Trailer, by
  `published_at`) for a followed list sends a Web Push. Web Push delivery is still unverified on
  the phone (see CLAUDE.md), so that is checked first.

## 12. API facts used by phases 5–6 (checked 30.09.2026)

- MDBList: `POST https://api.mdblist.com/tmdb/{movie|show}?apikey=…` with `{"ids":["578",…]}` (≤ 200)
  returns items with `ratings[] {source, value, score, votes, url}`; sources `tomatoes`, `metacritic`,
  `imdb` (/10), `letterboxd` (/5); RT `url` is site-relative (`/m/jaws`). Audience score: `popcorn`
  or `tomatoesaudience` (not in the blueprint — both read). Free daily limit unpublished; 429 when over.
- Trakt: `/sync/favorites/{movies|shows}` (paginated, `rank`, `id`), `POST /sync/favorites[/remove]`
  `{movies:[{ids}],shows:[{ids}]}`; `/sync/playback` (not paginated, `progress` 0–100, last 6 months);
  `/calendars/my/shows/{date}/{days}` (≤ 33 days, UTC); `/users/me/lists` (+ `/items`, paginated;
  `/items/remove`); `last_activities.favorites.updated_at` drives the favorites mirror.
- Notes: `POST /notes`, `GET /users/me/notes/{type}` (paginated) — not VIP-only, but a free account
  has a notes limit. Not synced yet (`personal_note` stays app-only for now).
