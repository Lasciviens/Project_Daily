# Trakt

Checked: 14.10.2026 against Trakt's own API blueprint (https://trakt.docs.apiary.io, raw
https://jsapi.apiary.io/apis/trakt.apib — marked deprecated since 11.06.2026 but still the detailed reference
with request/response examples) and the current contract behind https://docs.trakt.tv in
https://github.com/trakt/trakt-api (`projects/api/src/contracts/sync/index.ts` — the `history` router —,
`sync/schema/request/historyRemoveRequestSchema.ts`, `historyIdsRequestSchema.ts`,
`sync/schema/response/historyResponseSchema.ts`, `historyRemoveResponseSchema.ts`,
`_internal/request/pageQuerySchema.ts`). **No live sample was read**: there is no Trakt token in a development
session, so every field below is as the provider's example and contract show it, and the code checks each
field's shape where it enters (`parseHistory`, `parseTraktNotes`).

This page covers the per-play history added with migration 149 (every watch with its own date) and lists the
older endpoints for completeness. How the feature works: `docs/features/media.md`; the owner's rules and the
`trakt-api` action contract: `docs/trakt/REFERENCE.md` (§1, §6, §12).

## How we authenticate

- OAuth 2 (authorization code). `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` are Edge Function secrets of
  `trakt-api` (see `docs/backend/environment.md`); the secret never reaches the browser. Tokens live in
  `trakt_tokens` (service role only), last 7 days and are refreshed when less than 10 minutes remain; a
  refresh token works once, so each refresh stores the new one.
- Every sign-in request — `/oauth/authorize`, `/oauth/token` (code and refresh), `/oauth/revoke` — goes to
  `https://auth.trakt.tv`, never `api.trakt.tv` (Trakt's OpenAPI: "Use the https://auth.trakt.tv hostname for
  all OAuth requests ... Do not use the API hostname for these requests."). The data calls stay on
  `api.trakt.tv`.
- Every request sends `trakt-api-version: 2`, `trakt-api-key: <client id>` and `Authorization: Bearer <token>`.
- The cron calls `trakt-api` with `x-sync-secret` = `TRAKT_SYNC_SECRET` (Vault for the job, the function's env)
  and acts as `HEVY_USER_ID`; the app calls it with the user's JWT (`isAppUser`).

## Endpoints we call

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /sync/history/movies` (paged) | `trakt-api` `syncWatches` | a whole-history read: first sync after 149, after a reconnect, Sync now, a progress reset, more than 25 differing titles | page size clamped by Trakt ("often 250"); more than 200 pages is an error, never partial data |
| `GET /sync/history/shows/{trakt id}` (paged) | `syncWatches`, `playIdsToRemove`, `tickAddsOnTrakt` | a show whose plays differ from the summary; a whole-history read, title by title (resumable: `trakt_sync_state.history_cursor`); a single-play remove without a play id; before a done episode plan's watch is sent (216): does Trakt already have a play of it that day? | GET: 500 calls / 5 min |
| `GET /sync/history/movies/{trakt id}` (paged) | `syncWatches`, `playIdsToRemove`, `tickAddsOnTrakt` | the same, for a movie; and before a done movie plan's watch is sent (216): does Trakt already have a play of it that day? | |
| `POST /sync/history` `{movies, shows: [{ids, seasons: [{number, episodes: [{number, watched_at}]}]}]}` | outbox drain (`history_add`), import push | a watch added here — on the Media page, or by a done movie or episode plan (216: the database writes the watch, 149's trigger queues it; the drain sends it like any other) | POST: one per second; Trakt does not check duplicates |
| `POST /sync/history/remove` `{ids: [history id, …]}` | outbox drain (`history_remove_play`) | a watch removed or re-dated here — that one play | |
| `POST /sync/history/remove` `{movies \| shows: [{ids, seasons…}]}` | outbox drain (`history_remove`) | an item unmarked entirely ("Not watched", Wishlist, removed from the library) — every play of it | |
| `GET /search/tmdb/{tmdb id}?type=movie\|show` | `traktIdOf` | a title the catalogue has no Trakt id for, before a lookup in its history | |
| `GET /sync/watched/movies`, `/sync/watched/shows?extended=progress` | `snapshot` | every pull (the watched summary: plays and last date per item) | paginated since 03.07.2026 |
| `GET /sync/last_activities` | `runSync` | every sync | |
| ratings, watchlist, favorites, hidden/dropped, playback, calendar, lists, notes | `trakt-api` | see `docs/trakt/REFERENCE.md` §2 and §12 | |
| `GET /users/me/lists`; `GET /users/me/lists/{id}/items/movie` (paged; items `{rank, id, listed_at, type, movie: {ids}}`); `POST /users/me/lists/{id}/items/remove` `{movies: [{ids: {tmdb}}]}` → `{deleted, not_found}` | `sweepQueue` (207) | every sync: every film Completed in the library leaves the Queue (reads `movie.ids.tmdb`; `listed_at`, `notes` and `rank` unused here) | checked against the API blueprint ("List Items", "Remove List Items") on 24.11.2026 |
| `POST /users/me/lists/{id}/items/reorder` `{rank: [list item id, …]}` → `{updated, skipped_ids, list}` | `list_reorder` | the Queue's new order — the whole order every time, one call at a time: a move made while one is on its way waits, and only the newest order is sent next (reads `skipped_ids`, said as "Trakt skipped N titles"; `updated` passed on unused; `list` unused). A refused call puts back the last order Trakt took on screen | blueprint ("Reorder List Items") checked 25.11.2026 |
| `DELETE /users/me/lists/{id}` → 204 | `list_delete` | never for the Queue or any marked id (207: 403 `queue_protected`). Trakt itself has no way to lock a list: deleting it on trakt.tv can't be stopped from here — the app then makes a new Queue on the next "+ Queue" and marks it too | blueprint, 24.11.2026 |

Not called: `POST /shows/{id}/progress/watched/reset` (and its `DELETE`) — **VIP only** (426 for other
accounts) and it only changes Trakt's progress view (`reset_at`); rewatch rounds stay in the app
(`rewatch_round`, `rewatch_started_at`).

## Fields we read and write

| Field | Shape (Trakt's example / contract) | Where it goes |
|---|---|---|
| history row `id` | 64-bit integer, one play ("can be used to remove individual events") | `media_watches.trakt_history_id` (unique per user; only the sync writes it) |
| history row `watched_at` | ISO datetime with `.000Z` (to the second); the epoch = "unknown date" | `media_watches.watched_at` (an unknown movie date = NULL, an unknown episode date = the epoch) |
| history row `type` | `movie` \| `episode` | which item the play belongs to |
| history row `movie.ids.tmdb` / `show.ids.tmdb` + `episode.season` + `episode.number` | integers | the item key (`movie:<tmdb>`, `ep:<show tmdb>:<season>:<episode>`); a row without a TMDB id, a valid id or date is counted and skipped, never guessed |
| `POST /sync/history` item `watched_at` | UTC datetime, `unknown` or the epoch for no date | each watch's own date (truncated to the second) |
| `POST /sync/history/remove` `ids` | array of 64-bit integers | the removed watches' plays |
| remove/add answer `deleted` / `added` / `not_found` (incl. `not_found.ids`) | counts and arrays | counted in the sync result (`notFound`) |
| `/search/tmdb` row `{type, movie \| show: {ids: {trakt}}}` | | `movies.trakt_id` / `tv_series.trakt_id` (kept for next time) |
| watched summary `plays`, `last_watched_at` per movie / episode | integer, ISO datetime | which titles to read (`historyTargets`), and the library's status/counts (`traktSyncPlan.ts`) |

## Titles Trakt has no TMDB id for

`trakt_unmatched` (116) lists them; the owner's pick (migration 200, `trakt_manual_matches`: Trakt id → TMDB id, per kind) is read by `trakt-api` right after the snapshot and fills only a missing `ids.tmdb`. A per-title history read (`GET /sync/history/shows|movies/{trakt id}`) returns the show/movie with the Trakt id only for such a title (the contract's shape — not seen live), so the function fills the TMDB id from the used picks before `parseHistory`. TMDB's side: `docs/integrations/tmdb.md`.

## Fields we deliberately don't use

- History `action` (`scrobble` \| `checkin` \| `watch`): every play counts the same here.
- History rows' extended data (`?extended=full`, images): titles come from TMDB.
- `start_at` / `end_at` on `/sync/history`: they filter on the play's own `watched_at` (the contract documents
  "YYYY-MM-DD"), so a play added later with an older date — like the owner's 14.10.2026 repair of 73 Game of
  Thrones episodes — would be missed. Reads go per title instead.
- `watched_at: "released"` on an add: the app sends its own date (Release date is resolved here first).
- The history add answer's `updated`: not needed (a new play is linked to its watch on the next pull).
- Seasons in add/remove bodies: the app always names single episodes.

## Traps

- **An add returns no play ids.** A watch added here is linked to its Trakt play by the next pull (same item,
  same second). Until then its removal can only be matched by that exact second.
- **Never guess a play to remove.** A remove without a play id removes a play at that exact second only when
  Trakt has more plays there than the watches left here account for; with no play there at all it is gone
  already (nothing sent). Otherwise it waits ("waiting for Trakt's play ids", retried every 30 minutes): the
  next pull still reads that title and links its watches by id and same second (no date moved, nothing added
  or removed), so the remove can then name its play; one that still can't is dropped after 7 days with a
  message on the Trakt card. Before the first whole-history read has finished (`history_synced_at` NULL), no
  unlinked remove is sent at all. The backfilled placeholders (one kept date per play) are locked in the
  database until then — no writer but the sync may re-date or delete them ("This watch waits for Trakt's
  dates — try again after the next Trakt sync"); when the read finishes, the ones it didn't link become
  ordinary watches.
- **Trakt doesn't check duplicates** on add; a watch added and removed (or deleted and put back by Undo)
  before the drain cancels out in the outbox instead of being sent twice.
- **A done movie or episode plan's watch (216).** The database writes it when a movie plan, a plan of one episode, or
  a plan of a whole show (its next episode) is ticked (no new endpoint: the outbox's `history_add`, an episode in the shows / seasons / episodes shape). Two
  duplicates are guarded. (1) The film or episode already has a watch on the tick's day here (marked on the Media page,
  or on Trakt and pulled): no watch is written. (2) Marked on Trakt and not pulled yet: before the
  drain sends an add, `tickAddsOnTrakt` checks whether it is a tick's watch — from the ledger `task_link_effects`
  (`effect` `movie_watched` / `episode_watched`, `after.watch_id`), which only the database's trigger writes, never
  from the payload — and if so reads `GET /sync/history/movies/{trakt id}` (an episode: `/sync/history/shows/{trakt id}`,
  that episode's plays); when Trakt has a play of the item on that Oslo day that no
  other watch here accounts for (`tickPlayOnTrakt`: their linked play ids, one each for the unlinked ones that day),
  the add is not sent (counted as `alreadyOnTrakt`, said on the Trakt card's sync result). The next pull then links
  the tick's watch to that play (same item; Trakt's date wins), so an untick keeps it — it is the owner's Trakt watch.
  The echo of a play we pushed is linked by the same second. An untick removes the play by the id only the sync
  writes (`trakt_history_id`), else the exact second — never a value the browser can write. Ticked first and marked
  on Trakt afterwards is the owner's own second play; nothing here removes it.
  The drain reads each title's history once per run, counts those reads in its call budget, checks nothing after the
  run's deadline (those adds wait in the outbox for the next run), and sends an add as before when its title's read
  fails (only a dead sign-in stops the run).
- **Two same-second edges of a held-back add (216).** (1) The owner's own Trakt play is at the very second of the tick:
  the pull links the tick's watch to it without moving its date, so the ledger still sees "the tick's watch" and an
  untick removes it — and with it the owner's Trakt play (by its id). (2) Unticked before any pull: the held-back add
  was never sent, so the untick's single-play remove has no id; the drain removes a play only at that exact second when
  no watch here accounts for it — the owner's play at another second is "gone already" and stays, one at the same second
  would go. Both need the owner's mark and the tick in the same second; the rest of the time Trakt keeps the owner's play.
- **Page counts.** `getAll` reads `X-Pagination-Page-Count`; a limit above the endpoint's maximum is clamped,
  not refused. More than 200 pages throws (a mirror reading half a list would remove the other half).
- **Unknown dates** come back as the epoch; movies store NULL, episodes keep the epoch (NULL there means not
  watched).
- **Mass removals**: a pull never removes more than max(10, 10 %) of the watches it reads by itself; the rest
  waits for "Review and apply" on the Trakt card (`force`).
- **The deploy order.** Migrations run before functions: 149 queues `history_remove_play` with
  `next_retry_at` 7 days ahead so the trakt-api from before 149 (which deletes an op it doesn't know
  without sending it) can't drop it; the current trakt-api sends a never-tried one at once.
- **429 / 5xx**: one retry (a 5xx after 1.5 s, a 429 after `Retry-After`); writes are paced at one per second.

## Log

- 28.11.2026 — no new endpoint: a done movie or episode plan's watch (216) goes through `POST /sync/history` like any
  watch added here; the drain's same-day check reuses `GET /sync/history/movies|shows/{trakt id}` and the row shape above
  (`id`, `watched_at`, `type`, `movie.ids.tmdb`) as `parseHistory` already reads it. No live sample (no Trakt token
  in a development session).

- 26.10.2026 (later) — `auth.trakt.tv` answers a refresh token it no longer knows with HTTP 400
  `{"error":"invalid_grant","error_description":"session not found"}` (seen live with a made-up token), not 401.
  The refresh now reads that as a dead sign-in: `trakt_sync_state.last_error` gets the "connect again" text
  (also from a cron run), `status` returns `needsReconnect`, and the card shows **Connect again**, which
  re-runs the sign-in and keeps `trakt_outbox` (Disconnect would empty it).
- 26.10.2026 — sign-in host, limits and token life checked against Trakt's developer portal: the OpenAPI
  spec (https://developer.trakt.tv/openapi.json — every `/oauth/*` path has the server
  `https://auth.trakt.tv`), the PKCE guide (authorize at `https://auth.trakt.tv/oauth/authorize`), the
  rate-limit guide (`AUTHED_API_GET_LIMIT`: 500 calls every 5 minutes; POST: 1 call per second) and the
  OAuth guide ("The `access_token` is valid for **7 days**"; refresh tokens are single-use) — the last two
  from https://github.com/trakt/trakt-api `projects/developer/src/lib/guides/`. `trakt-api` now sends
  authorize, token and revoke to `auth.trakt.tv`. Discussion #1031 (the 01.02.2027 date after which the API
  host refuses sign-in requests) could not be opened from the development session; the date is as reported.
- 14.10.2026 — last check against Trakt's API blueprint and contract (see Checked above).
