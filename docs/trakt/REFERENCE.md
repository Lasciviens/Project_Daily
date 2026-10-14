# Trakt — reference (rules, API facts, the `trakt-api` contract)

> The lasting part of the Trakt plan. Everything in it is built: migrations `116`–`124`,
> `132`, `136` and `149`, the edge function `trakt-api`, `src/features/media/trakt/`, and the Trakt
> card on Settings → Subscriptions. How the feature works is in
> [`docs/features/media.md`](../features/media.md). This file keeps the owner's rules, what
> Trakt holds versus the app, the two-way rules, lists and follows, and the API facts the
> code relies on.
>
> **Section numbers are the original plan's** (§1, §2, §6, §11, §12), so a code comment
> that cites `docs/trakt/PLAN.md §1` or `§12` finds the same text here. The plan's other
> sections — identity details, tables, sync steps, Rotten Tomatoes, pieces, phases and owner
> steps (§3–§5, §7–§10) — were dropped once built; they are in git history
> (`git log --follow -p docs/trakt/REFERENCE.md`), and the facts from them that still matter
> are folded into §1 and §12.

## 1. The rules (owner's decisions)

- **Trakt is the source of truth for everything Trakt can hold.** If it exists on
  Trakt, Trakt's version wins. Only things Trakt has no place for stay app-only.
- **Two-way.** Every change made in the app that Trakt can hold is written to Trakt.
- **Every watch keeps its own date (owner, 14.10.2026; superseded "rewatches count, as a
  number").** Each play is a `media_watches` row with its own date and its Trakt history id
  (migration 149); `repeat_count` (= plays − 1) and the latest watch date stay on the title /
  episode row as a cache. A date change moves exactly the watch meant — Trakt never loses the
  other plays of that item (the old "remove all plays + re-add at the new date" wiped the
  owner's first-watch dates).
- **No season or episode ratings** — only movie and show ratings.
- **Notes are one thing.** `personal_note` on a movie or show IS the Trakt note on that movie or show
  (`trakt_note_id` links them; `trakt_note_text` keeps the text both sides had at the last sync — migration 136).
- **One film is one row, one show is one row.** The TMDB id is the identity
  (`movies.tmdb_id` / `tv_series.tmdb_id` are `UNIQUE NOT NULL`); Trakt, IMDb and TVDB ids
  are extra columns on that same row, each with a partial unique index, and Rotten Tomatoes
  attaches by TMDB id. Trakt sends every item with `ids: { trakt, slug, tmdb, imdb, tvdb }`:
  an item with a TMDB id is upserted on `tmdb_id`; an item with none, or whose TMDB lookup
  failed, goes to `trakt_unmatched` with the reason — never a guessed row. A Trakt/IMDb/TVDB
  id that another row already holds is skipped, never forced. Episodes match on show +
  season + episode, the unique key of `user_tv_episodes`.
- **Preview before the first write.** The first import is a dry run showing counts
  (matched, new, changes, pushes to Trakt, unmatched) before anything is saved.
- **App-only data is never deleted by a sync.** Data that came from Trakt mirrors
  Trakt exactly, including removals.

## 2. What Trakt holds vs what stays in the app

| Data | Trakt endpoint (read / write) | Where it lives here | Owner |
|---|---|---|---|
| Watched + play counts + last watched (movies, episodes) | `GET /sync/watched/{movies,shows}` · `POST /sync/history`, `/sync/history/remove` | `status='completed'` / `user_tv_episodes` row + `repeat_count` + `watched_at` (a cache since 149) | **Trakt** |
| Every play with its own date (movies, episodes) | `GET /sync/history/{movies,episodes}`, `/sync/history/{movies,shows}/{id}` · `POST /sync/history`, `/sync/history/remove {ids}` | `media_watches` (one row per watch, `trakt_history_id`) | **Trakt** |
| Watching it again (a rewatch round) | *(Trakt's progress reset is VIP-only, not used)* | `rewatch_round` on the entry | **app** |
| Ratings 1–10 — movies and shows only | `GET /sync/ratings/{movies,shows}` · `POST /sync/ratings`, `/remove` | `user_movie_entries.rating`, `user_tv_entries.rating` | **Trakt** |
| Watchlist (with its order) | `GET /sync/watchlist/{movies,shows}/rank/asc` · `POST /sync/watchlist`, `/remove` | `status='wishlist'` + `watchlist_rank` (the order is read from Trakt, not written back) | **Trakt** |
| Favorites | `GET /sync/favorites` · `POST`, `/remove` | `is_favorite` | **Trakt** |
| Dropped shows | `GET /users/hidden/dropped` · `POST /users/hidden/dropped`, `/remove` | `user_tv_entries.status='dropped'` | **Trakt** |
| Notes (≤ 500 characters, always private) on a movie or show itself — notes on an episode, a season, a person, a play, a rating or a collection item are left alone | `GET /users/me/notes/{movies,shows}` · `POST /notes`, `PUT/DELETE /notes/{id}` | `personal_note` (+ `trakt_note_id`, `trakt_note_text`) | **Trakt** |
| Paused mid-film/episode (%) | `GET /sync/playback` · `DELETE /sync/playback/{id}` | read live — Media's "Continue watching"; ✕ removes it on Trakt | Trakt |
| My upcoming episodes | `GET /calendars/my/shows` | read live, merged into Coming soon (Watching/Completed shows only) | Trakt |
| Personal lists | `/users/me/lists…` | read live — Media → Lists, the Queue, follows' lists (§11) | Trakt |
| Change detection | `GET /sync/last_activities` (one call) | `trakt_sync_state` | — |
| Collection (owned copies) | `/sync/collection` | **not used** — no owned-media feature here | — |
| Paused (on hold) status | *(no Trakt equivalent)* | `user_tv_entries.status='paused'` | **app** |
| Dropped **movie** | *(Trakt drops shows only)* | `user_movie_entries.status='dropped'` | **app** |
| Priority, planned sessions (`time_blocks`) | *(none)* | as today | **app** |
| Posters, overview, genres, runtimes | TMDB | `movies` / `tv_series` | TMDB |
| Rotten Tomatoes, Metacritic, IMDb and Letterboxd scores | MDBList, by TMDB id (§12) | `movies` / `tv_series` rating columns | MDBList |

Checkins and scrobbling are not built: plays scrobbled by Plex, Infuse or your TV
reach Trakt and come back here through the normal history sync.

## 6. Two-way rules

- An app edit writes locally at once (the UI stays instant) and adds an outbox row — from
  any writer (web, AI, SQL), queued by the triggers of migrations 117, 118, 120, 132 and 136.
  A write carrying the `x-trakt-sync: 1` request header (the sync's own client) is skipped,
  so the sync never queues its own writes. The outbox drains **first** (app → Trakt), so the
  mirror never undoes a change made here; items still waiting (or just sent) are left alone
  by the mirror.
- A watch logged here is sent as one play; the next watched read returns the new
  count, so nothing is counted twice.
- If Trakt rejects a write (e.g. an item Trakt doesn't know), the row stays app-only
  and the Media page says so.
- **First import:** titles you watched in the app but not on Trakt are listed in the
  preview and pushed to Trakt when you confirm — after that, Trakt holds the complete
  record. The sync refuses to run until a complete import has stamped
  `trakt_sync_state.imported_at` (migration 124), because it treats Trakt as the truth and
  would otherwise wipe app-only data.
- **Plays (migration 149, built 14.10.2026)** — `src/features/media/trakt/traktWatchPlan.ts`
  (`scripts/verify-trakt-watch-plan.cjs`), DB scenarios `scripts/db-tests/media-watches/`:
  - **App → Trakt, one play at a time:** a new watch → `history_add` at its own date; a removed
    watch → `history_remove_play` (`POST /sync/history/remove {ids: [history id]}`; an unknown id
    is looked up in the title's history first — the play at the same second, else the nearest
    one no remaining watch accounts for); a new date on one watch = remove that play + add the
    new one. The item-wide `history_remove` only when it is unmarked entirely. An add and a
    remove of one watch still waiting cancel out.
  - **Trakt → app, play by play:** the titles whose plays differ from the watched summary are
    read one by one (`/sync/history/{shows|movies}/{trakt id}`); the whole history on the first
    run after 149, Sync now, a reset, a reconnect, or more than 25 differing titles. Linked plays
    stay; the rest pair by the same second, then in date order (Trakt's date wins);
    placeholders (`source = 'backfill'`, the one date the app had) are replaced. Pending items
    and items the summary dropped are left alone; an empty history while the summary has plays
    is an outage.
  - Not by date: `start_at` filters on the play's own date, so a backdated play would be missed.
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

## 11. Lists and follows

- **Lists = Trakt personal lists, read live** (no local table: Trakt holds them): Media → Lists
  (pick, see, remove, new, delete), "Add to list" on every title page, and **Save as list** on a
  film's franchise strip (TMDB `belongs_to_collection` → `/collection/{id}`, release order).
  Private by default. Free accounts have a small list/item allowance (Trakt 420).
- **The Queue** is a private Trakt list named "Queue"; its order is saved on Trakt with
  `list_reorder` (§12).
- **Follows (migration `119`, 30.09.2026):** follow a franchise (TMDB collection), studio
  (company), director or actor from a movie's page (**Follow** menu), or a keyword through
  New list → "Fill automatically" (migration 120). `media_follows`
  keeps each follow's known movie ids and trailer keys; `trakt-api`'s `checkFollows` (inside
  the sync cron, at most once per ~20 h per follow, ≤ 15 per run, or **Check now** / the
  `follows_check` action) records new titles and new trailers (TMDB `/movie/{id}/videos`,
  Trailer on YouTube) as `media_follow_events`. The first check only stores a baseline, so
  following something never floods the feed. A follow is the rule behind a Trakt list
  (`trakt_list_id`): its new titles are added to that list.
- **A film the linked list did not take is never lost (migration 136, 07.10.2026):** such a
  film (Trakt's 420 account limit, an error, no token at hand) waits in
  `media_follows.pending_list_ids` with the reason in `list_error`, is sent again at the next
  check (daily, or Check now) and leaves the queue only when Trakt took it; a film Trakt
  answers `not_found` for waits only while it is still new by its own date. A waiting film
  TMDB no longer lists for the follow is dropped. The Lists page shows it (What's new and the
  ✦ list's own page). Rules: `followRules.ts` (`followListToSend`, `followListPending`),
  `scripts/verify-media-follows.cjs`.
- Still proposed (not built): a **Web Push** for a new title or trailer. Daily checks run only
  while Trakt is connected (they ride the Trakt cron).

## 12. API facts and the `trakt-api` contract

### The `trakt-api` contract

One edge function, platform JWT verification **off** (listed in `supabase/config.toml`),
auth checked inside: a browser user JWT (`supabase.auth.getUser`, then the owner lock's
`isAppUser`), or the cron's `x-sync-secret: <TRAKT_SYNC_SECRET>`, which acts as
`HEVY_USER_ID` and may only run `sync`. Tokens live in `trakt_tokens` (service role only) and
are refreshed when less than 10 minutes remain. Without the Trakt secrets it answers
`{error: 'not_configured'}`; a 401 from Trakt reads `{error: 'reauth_required'}`. The pure
plans in `src/features/media/trakt/` are GENERATED into the function by
`scripts/sync-trakt-shared.mjs` (`--check`).

| Action | Needs Trakt | What it does |
|---|---|---|
| `ratings` | no | MDBList scores for one title (`mediaType`, `tmdbId`); stored on the catalogue row |
| `follows_check` | no (fills a linked list only with a valid token) | runs the follow check now |
| `authorize_url` | — | the OAuth URL for an allowed `redirectUri` |
| `connect` | — | exchanges the OAuth `code`, stores the tokens |
| `status` | — | connected, username, last sync, last error and result, imported, changes waiting, syncing |
| `disconnect` | — | revokes on Trakt, clears note links, tokens and the outbox; the next connection starts with an import again |
| `snapshot` | yes | a read-only snapshot of everything Trakt holds (the import preview), with notes |
| `import` | yes | the first import: outbox and app-only facts to Trakt **first**, then Trakt → library; stamps `imported_at` only when complete |
| `sync` | yes | outbox drain → mirror (only when `last_activities` moved; `full`/`force` flags) → notes comparison; refuses before the import |
| `playback`, `playback_remove` | yes | Continue watching, and removing one paused item |
| `calendar` | yes | my upcoming episodes |
| `lists`, `list_items`, `list_create`, `list_delete`, `list_add`, `list_remove`, `list_reorder` | yes | personal lists, the Queue and follows' lists |

One sync at a time (`trakt_sync_state.sync_started_at`, stale after 5 minutes). The cron job
`lascis-trakt-sync` runs at :07 and :37; an edit in the app triggers a silent sync 4 s later.

### Trakt — limits, pagination, tokens

- Access tokens last 24 h (since 20.03.2025) and are refreshed from the refresh token.
- GET: 1,000 calls per 5 minutes per user. POST: **one per second** — the outbox paces itself.
  Paginated endpoints report `X-Pagination-Page-Count`.
- Since 03.07.2026 (trakt-api discussion #775) `/sync/watched/*` is paginated (100 items
  without a limit) and leaves out seasons unless `extended=progress` (≤ 100 per page); every
  list is read through `getAll`.
- Trakt's "unknown date" for a play is the epoch: movies store NULL, episodes keep the epoch
  (NULL there means not watched), and every screen shows "date unknown".
- `reset_at` stamps in `last_activities` mark a show whose watched progress was restarted.

### Watch history (checked 14.10.2026 — migration 149)

Sources: the API blueprint (https://trakt.docs.apiary.io, raw https://jsapi.apiary.io/apis/trakt.apib —
deprecated since 11.06.2026 but still the detailed reference) groups Sync → "Get History", "Add to
History", "Remove from History", Search → "ID Lookup", Shows → "Reset Watched Progress"; and
trakt/trakt-api's contract (`projects/api/src/contracts/sync/index.ts`, `history` router;
`schema/request/historyRemoveRequestSchema.ts`, `historyIdsRequestSchema.ts`,
`schema/response/historyResponseSchema.ts`, `historyRemoveResponseSchema.ts`;
`_internal/request/pageQuerySchema.ts`).

- `GET /sync/history/{type}/{id}?start_at&end_at` (OAuth, paginated, extended): `type` movies |
  shows | seasons | episodes, `id` a Trakt id (shows/{id} = every episode of the show). Rows,
  newest first: `{id (64-bit — one play, the id that removes it), watched_at, action: scrobble |
  checkin | watch, type: movie | episode, movie | episode {season, number, ids} + show {ids}}`
  (contract: `id` int, `watched_at` datetime, `action`, `type`, passthrough). A valid id with no
  history = `[]`.
- Pagination: a limit above the endpoint's maximum is clamped, not refused ("often 250");
  `X-Pagination-Page-Count` as everywhere.
- `start_at`/`end_at` filter on the play's own `watched_at` (the contract documents
  "YYYY-MM-DD"), so they can't find a play added later with an older date — the app reads per
  title instead.
- `POST /sync/history` adds plays (`watched_at` per item; `unknown` or the epoch = no date;
  Trakt doesn't check duplicates) → `{added, updated?, not_found}` — no history ids come back,
  so a new play is linked on the next pull.
- `POST /sync/history/remove` with `ids: [history ids]` removes single plays ("raw history ids
  … to delete single plays") → `{deleted: {movies, episodes}, not_found: {…, ids}}`; with movie /
  show / season / episode objects it removes every play of the item.
- `GET /search/tmdb/{id}?type=movie|show` (ID Lookup) → `[{type, score, movie | show: {ids:
  {trakt, …}}}]` — the Trakt id of a title the catalogue has none for.
- `GET /sync/last_activities` has `movies.watched_at` and `episodes.watched_at`; the sync still
  compares `all`.
- `POST /shows/{id}/progress/watched/reset` (and `DELETE` to undo) is **VIP Only** (426 for
  others) and only changes Trakt's progress view (`reset_at`); not used — rewatch rounds are
  app-side.

### Facts used by phases 5–6 (checked 30.09.2026; notes 07.10.2026)

- MDBList: `POST https://api.mdblist.com/tmdb/{movie|show}?apikey=…` with `{"ids":["578",…]}` (≤ 200)
  returns items with `ratings[] {source, value, score, votes, url}`; sources `tomatoes`, `metacritic`,
  `imdb` (/10), `letterboxd` (/5); RT `url` is site-relative (`/m/jaws`). Audience score: `popcorn`
  or `tomatoesaudience` (not in the blueprint — both read). Free daily limit unpublished; 429 when over.
  Rotten Tomatoes has no free official API (licensed access starts around $60,000 a year), so
  MDBList is the only source. The sync refreshes library titles whose scores are older than
  a week (≤ 200 per type); an opened title is fetched on demand (`ratings`).
- Trakt: `/sync/favorites/{movies|shows}` (paginated, `rank`, `id`), `POST /sync/favorites[/remove]`
  `{movies:[{ids}],shows:[{ids}]}`; `/sync/playback` (not paginated, `progress` 0–100, last 6 months);
  `/calendars/my/shows/{date}/{days}` (≤ 33 days, UTC); `/users/me/lists` (+ `/items`, paginated;
  `/items/remove`); `last_activities.favorites.updated_at` drives the favorites mirror.
- `POST /users/me/lists/{id}/items/reorder` with every list item id in the new order (API
  blueprint, "Reorder List Items") — the `list_reorder` action, used by the Queue.
- `DELETE /sync/playback/{id}` → 204; a 404 means it is already gone, which is the same result.
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

### OAuth redirect URIs

The Trakt app's redirect URIs, mirrored by an allow-list in the function:
`https://lasciviens.github.io/Project_Daily/` and `http://localhost:5173/Project_Daily/`. The
OAuth return (`?code=&state=` before the hash) is parked by `captureTraktCallback()` in
`main.tsx` before the router starts; the Trakt card finishes it and checks `state`.
