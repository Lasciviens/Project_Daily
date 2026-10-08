# Trakt integration — plan

Status: **phases 1–6 built** (the last piece: notes, migration `136_trakt_notes.sql`, 07.10.2026) —
migrations `116`–`124`, `132`, `136`, edge function `trakt-api`, `src/features/media/trakt/`,
Settings → Subscriptions → Trakt.
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
- **Notes are one thing.** `personal_note` on a movie or show IS the Trakt note on that movie or show
  (`trakt_note_id` links them; `trakt_note_text` keeps the text both sides had at the last sync — migration 136).
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
| Notes (≤ 500 characters, always private) on a movie or show itself — notes on an episode, a season, a person, a play, a rating or a collection item are left alone | `GET /users/me/notes/{movies,shows}` · `POST /notes`, `PUT/DELETE /notes/{id}` | `personal_note` (+ `trakt_note_id`, `trakt_note_text`) | **Trakt** |
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

**Added by `136_trakt_notes.sql`** (additive, no row updated): `trakt_note_text` on `user_movie_entries` and
`user_tv_entries`, `trakt_sync_state.notes_synced_at`, `media_follows.pending_list_ids` / `list_error` /
`list_error_at`, and the notes outbox trigger (`trakt_outbox_note`, its own function — 132's are untouched).

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
- **Notes (migration 136, built 07.10.2026)** — `src/features/media/trakt/traktNotes.ts`
  (`scripts/verify-trakt-notes.cjs`):
  - Only the note on a movie or show itself; episode notes stay app-only. A Trakt note on a
    title that is not in the library stays on Trakt (a note alone never adds a title).
  - **Three-way:** `trakt_note_text` is the text both sides had at the last sync. The side
    that changed wins; changed on both sides → Trakt wins (the import rule); a note edited
    on one side is never lost to a delete on the other (the edit is kept). No history yet
    (first comparison after 136, or after reconnecting) = both sides differ → Trakt wins; the
    Trakt card says how many notes typed here were replaced, and the replaced text stays in the
    audit log (Developer → Activity, 30 days).
  - **App → Trakt:** a `personal_note` change queues `note_set` / `note_remove` (key
    `note:<type>:<tmdb>`, like favorites, so a waiting note never holds back the title's
    mirror; a removed entry takes its linked Trakt note along). The drain sends notes in
    their own pass, one title at a time, as the entry is NOW (several queued edits = one
    write): update by `trakt_note_id`, a 404 there = add it again; delete, a 404 = done.
  - **Trakt → app:** the full comparison runs when `last_activities.notes.updated_at`
    moved, on Sync now, when titles came in from Trakt, at the import, and once after 136
    (`notes_synced_at` is NULL). Titles with a note change still waiting are left alone; a
    pull is written only if the entry did not change since it was read.
  - **Length:** over 500 characters, Trakt gets the first 499 + "…" (never splitting an
    emoji); the app keeps the whole note and counts both as the same note.
  - **Refusals:** 420 (the account's note limit), 404 (Trakt doesn't know the title),
    409, 422 → the note stays as it is, the Trakt card says why, the next full comparison
    tries again; after one 420 no further note is added in that run. Other failures wait
    (backoff) without blocking any other change. At most 15 notes per run each way.
  - **Outage guard:** Trakt answering no notes of a type while ≥ 3 here are linked changes
    nothing (compared again next sync); a row the app can't read stops the comparison.
  - Disconnect clears every note link and `notes_synced_at`: a new connection — maybe
    another Trakt account — compares every note again.

## 7. Rotten Tomatoes

No free official API (licensed access starts around $60,000 a year). **MDBList**
looks up by TMDB id and returns Tomatometer, audience score and Metacritic. Fetched only
for titles in your library, refreshed at most weekly. Needs a free MDBList API key
(`MDBLIST_API_KEY`); its daily limit is confirmed when the key is created.

## 8. Pieces

| Piece | What |
|---|---|
| `116_trakt.sql` | everything in §4 ✅ |
| `trakt-api` | ✅ `authorize_url`, `connect`, `status`, `disconnect`, `snapshot`, `import`, `sync` (outbox drain → mirror → notes comparison), cron secret |
| Ratings step | MDBList by TMDB id, inside `trakt-api` |
| Pure modules + verify scripts | ✅ `traktPreview.ts`, `traktImportPlan.ts`, `traktSyncPlan.ts`, `traktNotes.ts`, `followRules.ts` — `scripts/verify-trakt-{preview,import-plan,sync-plan,notes}.cjs`, `verify-media-follows.cjs` |
| UI | Settings → Subscriptions card; Media: import preview, sync status, unmatched list, Continue watching, favorites, RT chips |

## 9. Phases

| Phase | Result | Gate |
|---|---|---|
| 1 ✅ | Connect Trakt + **dry-run preview** | the counts look right to you |
| 2 ✅ | First import (+ push of app-only watches), id backfill | no duplicate titles; paused/priority untouched |
| 3 ✅ | Incremental sync + reconcile (cron + Sync button) | a play scrobbled elsewhere appears within 30 min; a play removed on Trakt disappears here |
| 4 ✅ | Two-way through the outbox (watched, plays, ratings, watchlist, dropped; notes come with phase 5) | a rating, watch or note made here shows on trakt.tv |
| 5 ✅ | ✅ Favorites (two-way, migration 118), ✅ Continue watching (`/sync/playback`, live), ✅ my calendar (`/calendars/my/shows`, in Coming soon), ✅ personal lists (live, Media → Lists), ✅ notes (two-way, migration 136) | each visible on the Media page |
| 6 ✅ | Rotten Tomatoes (critics + audience), Metacritic, IMDb, Letterboxd via MDBList — title page chips, Library 🍅 + sort | scores on posters and in details |

## 10. Owner steps

- Done: Trakt app created; `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` / `MDBLIST_API_KEY` in secrets.
- Phase 1: apply `116_trakt.sql`, deploy `trakt-api` (JWT verification **ON**).
- Phase 2: redeploy `trakt-api`, then Preview import → Import now. Watched/watching beats wishlist on both sides (owner, 30.09.2026).
- Phases 3–4: apply `117_trakt_sync.sql`; redeploy `trakt-api` with JWT verification **OFF**; `TRAKT_SYNC_SECRET` in Edge secrets + Vault; `TMDB_API_KEY` in Edge secrets.
- Notes + follow lists that keep a refused film: apply `136_trakt_notes.sql`, redeploy `trakt-api` (JWT verification **OFF**). Either order is safe.
- Redirect URIs on the Trakt app: `https://lasciviens.github.io/Project_Daily/` (and
  `http://localhost:5173/Project_Daily/` for local testing).
- Per phase: apply the named migration and deploy the named function.

## 11. Lists (built 30.09.2026) and what is still proposed

- ✅ **Lists = Trakt personal lists, read live** (no local table: Trakt holds them): Media → Lists
  (pick, see, remove, new, delete), "Add to list" on every title page, and **Save as list** on a
  film's franchise strip (TMDB `belongs_to_collection` → `/collection/{id}`, release order).
  Private by default. Free accounts have a small list/item allowance (Trakt 420).
- ✅ **Follows (migration `119`, 30.09.2026):** follow a franchise (TMDB collection), studio
  (company), director or actor from a movie's page (**Follow** menu). `media_follows` keeps each
  follow's known movie ids and trailer keys; `trakt-api`'s `checkFollows` (inside the sync cron,
  at most once per ~20 h per follow, ≤ 15 per run, or **Check now** / the `follows_check` action)
  records new titles and new trailers (TMDB `/movie/{id}/videos`, Trailer on YouTube) as
  `media_follow_events`. The first check only stores a baseline, so following something never
  floods the feed. A follow can be linked to a Trakt list: its new titles are added there.
  Shown under Media → Lists → Following (Mark seen, trailer link).
- ✅ **A film the linked list did not take is never lost (migration 136, 07.10.2026):** the check
  used to count a film as known even when Trakt refused the add (its 420 account limit, an error,
  no token at hand), so it never reached the list. Now such a film waits in
  `media_follows.pending_list_ids` with the reason in `list_error`, is sent again at the next check
  (daily, or Check now) and leaves the queue only when Trakt took it; a film Trakt answers
  `not_found` for waits only while it is still new by its own date. A waiting film TMDB no longer
  lists for the follow is dropped. The Lists page shows it (What's new and the ✦ list's own page).
  Rules: `followRules.ts` (`followListToSend`, `followListPending`), `scripts/verify-media-follows.cjs`.
- Still proposed (not built): a **Web Push** for a new title/trailer. Web Push delivery is still
  unverified on the phone and `push-send` only knows the morning trigger, so events stay in the
  app for now. Daily checks run only while Trakt is connected (they ride the Trakt cron).

## 12. API facts used by phases 5–6 (checked 30.09.2026; notes 07.10.2026)

- MDBList: `POST https://api.mdblist.com/tmdb/{movie|show}?apikey=…` with `{"ids":["578",…]}` (≤ 200)
  returns items with `ratings[] {source, value, score, votes, url}`; sources `tomatoes`, `metacritic`,
  `imdb` (/10), `letterboxd` (/5); RT `url` is site-relative (`/m/jaws`). Audience score: `popcorn`
  or `tomatoesaudience` (not in the blueprint — both read). Free daily limit unpublished; 429 when over.
- Trakt: `/sync/favorites/{movies|shows}` (paginated, `rank`, `id`), `POST /sync/favorites[/remove]`
  `{movies:[{ids}],shows:[{ids}]}`; `/sync/playback` (not paginated, `progress` 0–100, last 6 months);
  `/calendars/my/shows/{date}/{days}` (≤ 33 days, UTC); `/users/me/lists` (+ `/items`, paginated;
  `/items/remove`); `last_activities.favorites.updated_at` drives the favorites mirror.
- **Notes — verified 07.10.2026 against Trakt's own sources** (built on them, migration 136):
  - Sources: the API blueprint, group "Notes" and Users → "Get notes" (https://trakt.docs.apiary.io,
    raw: https://jsapi.apiary.io/apis/trakt.apib — marked deprecated since 11.06.2026 but still the
    detailed reference with request/response examples), and the current contract behind
    https://docs.trakt.tv (now developer.trakt.tv) in https://github.com/trakt/trakt-api:
    `projects/api/src/contracts/notes/index.ts`, `users/index.ts` (`notes`) and
    `sync/schema/response/lastActivitiesResponseSchema.ts` (announcement:
    https://github.com/trakt/trakt-api/discussions/808; the notes routes were ported there from the
    blueprint on 26.06.2026 with loose, passthrough schemas).
  - `POST /notes` (OAuth; "VIP Enhanced") body `{"movie"|"show": {ids}, "notes": "…"}` → **201**
    `{id, notes, privacy, spoiler, created_at, updated_at, user}`. A note on a movie, show, season,
    episode or person is always `private` and can't be a spoiler; `privacy` (private/friends/public)
    and `spoiler` only apply to a note on a `history` play, a `collection` item or a `rating`, sent
    with `attached_to` — the app never writes those.
  - `PUT /notes/{id}` `{notes, spoiler?, privacy?}` → **200** with the note (only its author; else
    401). `DELETE /notes/{id}` → **204**. `GET /notes/{id}`; `GET /notes/{id}/item` (what it is
    attached to).
  - `GET /users/{id}/notes/{type}` (`me` with OAuth; type `all|movies|shows|seasons|episodes|people|
    history|collection|ratings`; paginated) → rows `{attached_to: {type, id?}, type, movie|show|
    episode…: {ids}, note: {id, notes, privacy, spoiler, created_at, updated_at, user}}`. The app
    reads `/users/me/notes/movies` and `/shows` and keeps only rows with `attached_to.type` = the
    row's own `type` (the title itself); the new contract describes the rows only loosely, so a row
    without the blueprint's shape stops the comparison and no note is changed.
  - Limits and errors: **500 characters**; a free account has a note limit (`GET /users/settings`
    → `limits.notes.item_count`, 100 in the example), exceeding it → **420** (the body may be empty;
    `X-Account-Limit` may name the limit); Trakt VIP allows unlimited notes. 401 invalid user / not
    the author, 404 item not found or doesn't allow notes, 409 note can't be deleted, 422 validation
    errors.
  - `GET /sync/last_activities` has `notes.updated_at` (both sources) — the trigger for the full
    comparison.
  - Not documented, so not relied on: whether one title can hold two notes (the app keeps the
    newest per title), and how the 500 characters are counted (the app cuts at 500 UTF-16 units
    without splitting an emoji — within either way of counting).
- Personal list items: `POST /users/me/lists/{id}/items` → 201 `{added, existing, not_found:
  {movies: [{ids}]}, list}`; over the account's limit → 420 with `X-Account-Limit` (blueprint
  example). The follow check reads `not_found` to keep a film Trakt doesn't know yet.
