# TEMP — Trakt + Younify integration research and migration plan

> Research snapshot: 2026-09-23
>
> Status: research / design only. No Supabase DDL, migration, Edge Function deployment, Vault change, or production data mutation has been performed.
>
> Repository snapshot inspected: main at 8edf225f9be047e8f9d6de9b2d05c4bc6c672781.
>
> Supabase project inspected: Supabase Project Daily, ref hsaedwwqpcjizeozjbch, eu-west-1, PostgreSQL 17, ACTIVE_HEALTHY.

## 1. Executive decision

The safest first integration is **Trakt-first, Younify-second**.

Trakt is a good immediate fit for Project_Daily because it has a documented OAuth flow for websites, a read/write API for user media state, and stable cross-service IDs including TMDB/IMDb/Trakt IDs. Project_Daily is already a React web application hosted on GitHub Pages, so Trakt's Authorization Code Flow maps naturally to the current architecture.

Younify is valuable for a different reason: it can aggregate actual streaming-service data from Netflix, Prime Video, Disney+, Max, Apple TV, Hulu, Paramount+, Peacock, Discovery+, Tubi, Pluto TV, Roku Channel, YouTube and Fandango at Home. Its public product documentation exposes watch history, partial-view percentage, timestamps, cross-service watchlists, ratings, recommendations and continue-watching data. However, the currently published SDK list is iOS, Android, React Native and .NET MAUI. A browser/web SDK is not publicly listed. Project_Daily should therefore treat Younify as a Phase 2 integration pending partner approval and confirmation of a supported web-account-linking flow.

The core architecture should remain:

TMDB = canonical metadata/artwork source  
Supabase = Project_Daily's canonical local application state  
Trakt = bidirectional tracking/sync peer  
Younify = optional read-side provider-activity aggregator

Do not replace the existing movie/TV tables with a Trakt-shaped schema. Extend the current model around it.

## 2. Current production database snapshot

### 2.1 Media row counts

| Table | Rows |
|---|---:|
| movies | 6 |
| tv_series | 10 |
| user_movie_entries | 5 |
| user_tv_entries | 8 |
| user_tv_episodes | 233 |

Current status distribution:

| Entity | Status | Rows |
|---|---|---:|
| Movie | completed | 3 |
| Movie | wishlist | 2 |
| TV | completed | 3 |
| TV | paused | 1 |
| TV | watching | 2 |
| TV | wishlist | 2 |

The 233 user_tv_episodes rows cover 5 series. The current production data has watched_at values ranging from 2026-06-30 to 2026-07-25.

### 2.2 Existing catalog model

movies currently contains:

- id uuid PK
- tmdb_id integer UNIQUE NOT NULL
- title / original_title / overview
- release_date / runtime / status
- poster_path / backdrop_path
- genres jsonb
- tmdb_rating / tmdb_vote_count
- metadata_json jsonb
- created_at

tv_series currently contains:

- id uuid PK
- tmdb_id integer UNIQUE NOT NULL
- title / original_title / overview
- first_air_date / last_air_date
- status / episode_run_time
- number_of_seasons / number_of_episodes
- poster_path / backdrop_path
- genres jsonb
- tmdb_rating / tmdb_vote_count
- metadata_json jsonb
- created_at

All 6 movie rows have TMDB IDs and all 6 currently have an IMDb ID inside metadata_json. All 10 TV rows have TMDB IDs, but none currently has metadata_json.imdb_id populated.

This makes TMDB the best current join key for importing Trakt/Younify data. We should add explicit provider IDs for indexed matching, but TMDB should remain the metadata identity rather than making Trakt the new canonical catalog.

### 2.3 Existing user-state model

user_movie_entries:

- one row per user + movie
- UNIQUE(user_id, movie_id)
- status: watching / wishlist / completed / dropped / upcoming
- priority
- personal_note
- rating 1–10
- planned_date / notify_before_days
- repeat_count
- watched_at
- created_at / updated_at

user_tv_entries:

- one row per user + TV series
- UNIQUE(user_id, tv_series_id)
- status: watching / wishlist / completed / dropped / paused
- priority
- personal_note
- rating 1–10
- current_season / current_episode
- planned_date / notify_before_days
- repeat_count
- started_at / finished_at
- created_at / updated_at

user_tv_episodes:

- one row per user + series + season + episode
- UNIQUE(user_id, tv_series_id, season_number, episode_number)
- tv_entry_id + tv_series_id
- optional tmdb_episode_id
- watched_at
- personal_note
- rating
- created_at / updated_at

Migration 050 intentionally made user_tv_episodes the ONE authoritative source of watched TV progress. user_tv_entries.current_season/current_episode are only a fast-read cache and are maintained by trg_sync_tv_entry_progress. Any Trakt import must write episode history through user_tv_episodes and must not directly treat current_season/current_episode as authoritative.

### 2.4 Existing triggers relevant to this integration

user_movie_entries:

- trg_audit
- user_movie_entries_updated_at

user_tv_entries:

- trg_audit
- user_tv_entries_updated_at

user_tv_episodes:

- trg_audit
- trg_cleanup_block_on_episode_watched
- trg_sync_tv_entry_progress
- trg_user_tv_episodes_updated_at

Important consequence: importing Trakt episode history through user_tv_episodes will also run the existing planning cleanup trigger. That may be desirable for a newly watched episode, but a bulk historical import could also remove old planned blocks. Initial sync must therefore be tested against this side effect rather than treating the table as isolated storage.

### 2.5 Current RLS facts

movies and tv_series are shared authenticated catalogs: authenticated users may SELECT, INSERT and UPDATE them.

user_movie_entries and user_tv_entries have owner-scoped SELECT/INSERT/UPDATE/DELETE policies.

The current UPDATE policies on user_movie_entries and user_tv_entries have USING(owner) but no explicit WITH CHECK(owner). Supabase's current security guidance recommends both USING and WITH CHECK for owner-scoped UPDATE policies. This is existing security debt and should be corrected either in the integration migration or in a small prerequisite hardening migration.

user_tv_episodes currently uses one owner policy for ALL with both USING and WITH CHECK. It is assigned to PUBLIC rather than explicitly authenticated; auth.uid() still prevents anonymous ownership matches, but TO authenticated would be clearer and consistent with current policy style.

### 2.6 Current index findings

Useful existing indexes:

- UNIQUE movies(tmdb_id)
- UNIQUE tv_series(tmdb_id)
- UNIQUE user_movie_entries(user_id, movie_id)
- UNIQUE user_tv_entries(user_id, tv_series_id)
- UNIQUE user_tv_episodes(user_id, tv_series_id, season_number, episode_number)
- user_tv_episodes(tv_entry_id, season_number, episode_number)
- user_tv_episodes(user_id, watched_at DESC) WHERE watched_at IS NOT NULL

Performance Advisor currently flags these media foreign keys as lacking dedicated covering indexes:

- user_movie_entries.movie_id
- user_tv_entries.tv_series_id
- user_tv_episodes.tv_series_id

There are also redundant-looking non-unique movies_tmdb_id_idx and tv_series_tmdb_id_idx indexes even though unique indexes on the same columns already exist. Do not mix broad index cleanup into the Trakt feature unless the migration is deliberately split into a separate performance-hardening change.

### 2.7 Existing OAuth/token patterns

Production already has token tables for integrations such as:

- strava_tokens
- psn_tokens
- user_calendar_tokens

The Strava integration is the most useful implementation precedent. Its Edge Function:

1. validates the signed-in Supabase user,
2. exchanges the external authorization code server-side,
3. keeps client_secret server-side in Deno environment secrets,
4. stores external access/refresh tokens server-side using service_role,
5. returns only safe connection/profile information to the browser,
6. never returns OAuth tokens to the frontend.

Trakt should follow this pattern, with stronger token concurrency protection because Trakt refresh tokens are single-use.

### 2.8 Migration-history caveat

The live schema contains effects from many repository migrations well beyond 008, including migration 050 behavior and later features. However, supabase_migrations.schema_migrations currently shows only a subset of old numbered migrations plus recent timestamped migrations.

Therefore:

**Do not use migration-history rows alone to decide whether a historical repository migration is applied.**

For this project, actual production schema introspection is required before writing a migration. A future Trakt migration must be idempotent where practical and should include assertions for critical assumptions.

## 3. Current repository architecture that constrains the design

The current media API directly reads/writes:

- src/features/media/api/moviesApi.ts
- src/features/media/api/tvApi.ts
- src/features/media/api/watchedEpisodesApi.ts

moviesApi and tvApi upsert catalog rows using tmdb_id as the conflict key.

watchedEpisodesApi writes user_tv_episodes and then updates the current-season/current-episode cache app-side. Migration 050 also performs that cache update authoritatively in the database trigger. The two are intentionally idempotent.

Repository rules that matter for this integration:

1. Frontend deployment can happen before a manual database migration. New frontend code must survive missing tables/columns until the migration is applied.
2. Database migrations and Edge Functions are manually deployed; merge does not mean production is updated.
3. Edge Functions are Deno and self-contained.
4. External secrets belong in Edge Function environment/Vault, never browser code.
5. New public tables require an explicit RLS + GRANT decision.
6. New AI-visible tables require an explicit ai-proxy DB_CATALOG decision. Token/secret tables must never be added to DB_CATALOG.
7. Cross-entity consistency that must survive browser/AI/server writes should be implemented in the database rather than only in one React hook.
8. Open-ended PostgREST reads must paginate; server responses can cap at 1000 rows.
9. Current repository guidance says functions and migrations are manual deployment steps. The repo has no active GitHub Actions Edge Function auto-deployment workflow.

## 4. Trakt API research

Official documentation reviewed:

- https://docs.trakt.tv/docs/getting-started
- https://docs.trakt.tv/docs/authentication-oauth
- https://docs.trakt.tv/reference/auth
- https://docs.trakt.tv/reference/postoauthtoken
- https://docs.trakt.tv/reference/getuserssettings
- https://docs.trakt.tv/reference/about-scrobble
- https://docs.trakt.tv/docs/images

### 4.1 What Trakt gives us

Trakt publicly documents API capabilities around:

- history
- watchlist
- ratings
- collection
- favorites
- custom lists
- check-ins
- scrobbling
- playback-related tracking
- public/private user data depending on endpoint/auth

The API explicitly supports write calls. The official getting-started documentation uses adding movies/episodes to history as an example of POST-based user-data mutation.

This makes Trakt suitable for real bidirectional sync rather than just metadata import.

### 4.2 OAuth model

For a website, Trakt recommends the standard Authorization Code Flow.

Important rules:

- redirect_uri is case-sensitive.
- The redirect URI in authorization and token exchange must be identical to the app configuration.
- state must be validated to prevent a forged authorization callback.
- Access tokens are valid for 7 days.
- Token exchange requires the Trakt client secret, so exchange/refresh must be server-side.
- Trakt also supports Device Flow, but it is unnecessary for the Project_Daily web app.

### 4.3 CRITICAL — refresh tokens are single-use

Current Trakt documentation states that refresh tokens are single-use.

Every successful refresh:

1. invalidates the refresh token used in the request,
2. returns a new access_token,
3. returns a new refresh_token,
4. requires the application to replace both stored values.

This creates a race condition if two concurrent Edge Function requests both attempt to refresh the same token. One succeeds and invalidates the token; the second can then receive invalid_grant / session not found.

Therefore a naive implementation such as "if token expired, POST refresh" in every Edge Function call is not acceptable.

The token design needs a short database-backed refresh lease or compare-and-swap strategy. See Section 8.

### 4.4 User identity/settings

GET /users/settings is OAuth-required and returns:

- a globally unique user UUID suitable for identifying the connected Trakt account locally,
- user settings,
- limits,
- permissions.

The UUID cannot be used as the API user lookup identifier, so store it as a local connection identity, not as a replacement for endpoint identifiers.

The returned permissions can temporarily be false when Trakt spam protections are triggered. The UI/sync worker should therefore not assume a connected account always has every write capability.

### 4.5 Pagination is mandatory

Current Trakt references explicitly warn that omitted pagination parameters use low defaults, often 10, and endpoint maximums are often around 250.

Initial import must never rely on a single default request.

Every list/history/ratings import should:

- request an explicit page + limit,
- read pagination headers when available,
- continue until all pages are consumed,
- tolerate endpoint-specific maximums rather than hardcoding one universal assumption.

### 4.6 IDs and artwork

Trakt media objects expose cross-service IDs such as Trakt, TMDB and IMDb; some object types also expose TVDB.

This is a strong fit for the existing TMDB-based catalog.

Trakt can also return images with extended=full, but their documentation requires applications to cache the images and explicitly forbids hotlinking the Trakt CDN.

Project_Daily already has a TMDB poster/backdrop pipeline. Do not switch artwork to Trakt. Use Trakt IDs for sync identity and keep TMDB as artwork/metadata source.

### 4.7 Scrobbling

Trakt defines scrobbling as start/pause/stop events from a media player.

This is useful later if Project_Daily ever controls playback or receives player events. It is not required for the first integration because Project_Daily is currently a tracker/library, not a media player.

Phase 1 should focus on history, watchlist and ratings. Scrobble/playback can be Phase 2.

## 5. Younify API/SDK research

Official public documentation reviewed:

- https://www.younify.tv/product/
- https://www.younify.tv/product/developer-sdk/
- https://www.younify.tv/product/get-connected/
- https://dev.younify.tv/product/

### 5.1 What Younify provides

Younify Connect currently advertises normalized user streaming data across 14 services:

- Netflix
- Hulu
- Prime Video
- Disney+
- HBO Max
- Paramount+
- Peacock
- Apple TV
- Discovery+
- Tubi
- Pluto TV
- Roku Channel
- YouTube
- Fandango at Home

Publicly documented data includes:

- chronological watch history
- partial views
- completion percentage
- timestamps
- watchlists
- continue watching
- ratings / thumbs / likes
- provider recommendations
- provider identity/profile
- normalized content information
- TMDB references

This is complementary to Trakt: Younify can observe what the streaming services themselves know, while Trakt is a tracking account we can read and write.

### 5.2 Partner access is required

Younify Connect is not currently presented as a completely open self-service API. Public documentation says developers request partner access and receive API/SDK credentials and a partner portal account.

Do not build a production dependency on it until partner access is approved and commercial/usage terms are known.

### 5.3 CRITICAL — current public platform list does not include browser/web

The published SDK platforms are:

- iOS
- Android
- React Native
- .NET MAUI

There is no public browser/React-web SDK listed.

The documented service-linking flow occurs through the SDK UI because the SDK handles provider login, MFA, CAPTCHA, session renewal and credential validation.

Project_Daily is a React web app hosted on GitHub Pages. Therefore direct Younify integration is not yet implementation-ready.

Before schema/UX implementation, ask Younify:

1. Is there a supported web/browser service-linking flow?
2. Can the linking UI run in a hosted Younify page or redirect flow?
3. Can a web backend obtain data for a linked user without embedding a native SDK?
4. Are webhooks available for watch-history changes?
5. What are token lifetimes/refresh rules and rate limits?
6. What stable identifiers exist for history events?
7. What are data-retention and deletion requirements?

### 5.4 No documented provider write-back

The public Younify material describes retrieving watch history, watchlists, ratings, recommendations and continue-watching state.

I did not find public documentation for operations such as:

- add this title to the user's Netflix watchlist,
- mark this Disney+ episode watched,
- change a provider rating from Project_Daily.

Until partner documentation explicitly proves otherwise, model Younify as **read-side aggregation**, not bidirectional provider control.

## 6. Supabase platform notes relevant to this migration

Current Supabase documentation/changelog reviewed:

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

Supabase changed Data API exposure defaults in 2026. New public tables increasingly require explicit grants; the change is scheduled to apply to all existing projects on 2026-10-30.

This project uses supabase-js/PostgREST, so every new table in this design must deliberately state:

- whether anon can access it,
- whether authenticated can access it,
- whether service_role can access it,
- whether RLS is enabled,
- which policies apply.

Never assume creating a table automatically makes it reachable from the client.

### Existing Security Advisor findings

Current production Security Advisor also reports existing issues unrelated to Trakt itself, including:

- mutable search_path on several functions, including sync_tv_entry_progress,
- multiple SECURITY DEFINER functions exposed with EXECUTE to broad roles,
- pg_trgm and vector installed in public,
- leaked-password protection disabled.

Relevant remediation references:

- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security

Do not silently bundle all of these into a media integration migration. They should be tracked as a separate hardening task unless a Trakt-specific function would repeat one of the same mistakes.

## 7. Data-model gaps exposed by a real Trakt sync

There are three important mismatches between the current local model and Trakt.

### 7.1 Multiple watch events

Trakt history can represent multiple watches of the same movie/episode at different timestamps.

Project_Daily currently stores:

- movie: one watched_at plus repeat_count
- episode: one row and one watched_at, no repeat-event history

A raw Trakt history import is therefore richer than the local core model.

Do not throw away remote event identity. Add a provider event ledger so repeated watches can be reconciled without changing the existing TV progress source of truth.

### 7.2 Watchlist is not perfectly equivalent to status

Project_Daily encodes wishlist as one mutually exclusive status.

External systems can conceptually represent watchlist membership independently from other history state. A completed title might later be added to a watchlist for a rewatch.

For the first release, keep the existing local status model and use the following conservative rule:

- inbound watchlist creates wishlist only when there is no stronger existing local state,
- do not downgrade completed/watching/paused to wishlist,
- preserve external watchlist membership in sync state for observability,
- revisit independent is_watchlisted semantics only if real data shows the edge case matters.

### 7.3 Local updated_at is not a safe sync clock

updated_at changes for fields Trakt does not know about: personal_note, priority, planning fields, etc.

Using updated_at for conflict resolution would make a note edit look like a newer Trakt status/rating edit.

This repository already solved the same class of problem for Google Tasks by introducing a dedicated google_local_edit_at clock for only Google-synced fields.

The Trakt integration should follow the same principle: maintain provider-specific change state rather than comparing generic updated_at.

## 8. Proposed migration design

This is a design proposal, not migration SQL yet.

### 8.1 Extend movies and tv_series with explicit external IDs

Add nullable catalog fields:

movies:

- trakt_id bigint
- trakt_slug text
- imdb_id text

tv_series:

- trakt_id bigint
- trakt_slug text
- imdb_id text
- tvdb_id bigint

Indexes:

- unique partial index on movies.trakt_id where not null
- unique partial index on movies.imdb_id where not null
- unique partial index on tv_series.trakt_id where not null
- unique partial index on tv_series.imdb_id where not null
- optional unique partial index on tv_series.tvdb_id where not null

Backfill movie imdb_id from metadata_json.imdb_id where available.

Do not make any of these NOT NULL. TMDB remains the mandatory catalog identity.

### 8.2 trakt_connections — browser-safe connection state

Purpose: data that the frontend may safely display.

Suggested columns:

- user_id uuid PK, FK auth.users ON DELETE CASCADE
- trakt_user_uuid text
- trakt_username text
- trakt_slug text
- connected_at timestamptz
- last_sync_at timestamptz
- last_full_sync_at timestamptz
- sync_enabled boolean default true
- connection_status text CHECK connected/error/reauth_required
- last_error text
- created_at / updated_at

Security:

- RLS enabled
- authenticated SELECT only own row
- possibly authenticated UPDATE only safe preference fields such as sync_enabled
- token fields do not exist here
- explicit authenticated grants
- no anon grants

This table can be AI read-only only if useful; default recommendation is to keep integration plumbing out of AI DB_CATALOG unless a concrete user feature needs it.

### 8.3 trakt_tokens — server-only secrets

Purpose: external credentials. Never query this table from browser code.

Suggested columns:

- user_id uuid PK, FK auth.users ON DELETE CASCADE
- access_token text NOT NULL
- refresh_token text NOT NULL
- access_token_expires_at timestamptz NOT NULL
- token_version bigint default 1
- refresh_lease_id uuid
- refresh_lease_until timestamptz
- created_at / updated_at

Security:

- RLS enabled as defense in depth
- REVOKE ALL from anon and authenticated
- explicit service_role privileges only
- never add to ai-proxy DB_CATALOG
- never return token values from an Edge Function response
- never log token/header values

This is stricter than the older token-table patterns already in the database and should be the standard for new external integrations.

### 8.4 trakt_oauth_states — one-time CSRF/OAuth state

Recommended because the app is a static GitHub Pages frontend.

Suggested columns:

- id uuid PK
- user_id uuid FK auth.users ON DELETE CASCADE
- state_hash text UNIQUE
- expires_at timestamptz
- used_at timestamptz
- created_at

Server-only table, same grant policy as trakt_tokens.

The start-auth Edge Function creates a random state value, stores only its hash, and returns the Trakt authorization URL. The callback exchange consumes it exactly once.

Alternative: HMAC-signed stateless state. The DB-backed one-time record is simpler to audit and revoke.

### 8.5 media_external_events — provider history ledger

Purpose: preserve external watch-event identity and timestamps without replacing the existing local watched/progress source of truth.

Suggested columns:

- id uuid PK
- user_id uuid FK auth.users ON DELETE CASCADE
- provider text CHECK provider IN ('trakt','younify')
- provider_service text nullable; e.g. netflix, disney_plus for Younify
- provider_event_id text nullable
- fingerprint text NOT NULL
- event_type text CHECK watched/progress/rating/watchlist
- media_type text CHECK movie/episode
- movie_id uuid nullable FK movies
- tv_series_id uuid nullable FK tv_series
- season_number integer nullable
- episode_number integer nullable
- occurred_at timestamptz
- progress_percent numeric nullable
- provider_payload jsonb
- ingested_at timestamptz
- UNIQUE(user_id, provider, fingerprint)

Checks should enforce a valid movie target OR TV episode target.

Why this table exists:

- Trakt repeated watches are not lost.
- We can deduplicate repeated imports.
- We can calculate movie repeat_count from real remote events.
- We can preserve Younify partial-view events later.
- We can safely inspect source provenance during conflict debugging.

This is externally synced/churny data. It should not receive the user-authored trg_audit trigger.

### 8.6 trakt_sync_state — provider-scoped clocks and snapshots

Purpose: conflict resolution without abusing generic updated_at.

Suggested grain:

(user_id, object_type, local_object_key, sync_scope)

Where:

- object_type: movie / show / episode
- sync_scope: history / watchlist / rating / playback
- local_object_key: stable text key, e.g. movie UUID or series UUID + season + episode

Suggested columns:

- user_id
- object_type
- local_object_key
- sync_scope
- remote_state jsonb
- remote_changed_at timestamptz
- local_changed_at timestamptz
- last_pulled_at timestamptz
- last_pushed_at timestamptz
- last_synced_at timestamptz
- last_direction text CHECK pull/push
- PRIMARY KEY(user_id, object_type, local_object_key, sync_scope)

This table is integration plumbing and should be service-side only unless a developer/debug UI needs read access.

### 8.7 trakt_sync_outbox — reliable outbound writes

Purpose: never make a local DB mutation depend on Trakt being online at that exact moment.

Suggested columns:

- id uuid PK
- user_id uuid FK auth.users ON DELETE CASCADE
- aggregate_type text CHECK movie_entry/tv_entry/tv_episode
- aggregate_key text
- operation text
- payload jsonb
- created_at timestamptz
- attempt_count integer default 0
- next_attempt_at timestamptz
- claimed_at timestamptz
- processed_at timestamptz
- last_error text

Operations initially:

- history_add
- history_remove_explicit
- watchlist_add
- watchlist_remove
- rating_set
- rating_remove

Do not infer destructive history_remove from every status transition. Trakt history can contain multiple plays, and "not currently completed" is not necessarily equivalent to "erase my remote watch history".

The repository's Google Tasks outbox has already exposed subtle ordering/concurrency bugs. Reuse its hard-earned rules:

- claim rows with real row locking,
- preserve FIFO per logical media item,
- allow concurrency across different media items,
- use idempotency/dedup where possible,
- use conditional writes as a second safety layer,
- verify locking queries with EXPLAIN if introducing claim RPCs.

### 8.8 Optional: sync checkpoints

Store the latest Trakt activity/checkpoint timestamps separately from per-item state, e.g. trakt_sync_checkpoints keyed by user + category.

Categories can include:

- movies watched
- episodes watched
- movies watchlisted
- shows watchlisted
- movie ratings
- show ratings
- episode ratings
- playback

This allows incremental sync rather than full library reads every time.

## 9. Local-to-Trakt mapping

| Project_Daily state | Trakt mapping | Phase 1 behavior |
|---|---|---|
| Movie status=wishlist | Watchlist membership | Push add; pull can create wishlist |
| TV status=wishlist | Show watchlist membership | Push add; pull can create wishlist |
| Movie completed + watched_at | Movie history event | Push history add |
| user_tv_episodes watched row | Episode history event | Push history add |
| Movie rating | Movie rating | Two-way |
| TV entry rating | Show rating | Two-way |
| Episode rating | Episode rating | Optional after history MVP |
| watching | No clean persistent 1:1 | Keep local |
| paused | No clean persistent 1:1 | Keep local |
| dropped | No clean 1:1 | Keep local |
| upcoming | Local derived/planning state | Keep local |
| priority | No Trakt mapping | Local only |
| personal_note | No Trakt mapping | Local only |
| planned_date / notifications | No Trakt mapping | Local only |
| current_season/current_episode | Derived cache | Never sync directly |
| repeat_count | Derive from history ledger where possible | Do not treat as primary remote key |

Important: TV watched progress is episode-granular. An inbound Trakt show history must become user_tv_episodes rows. Never set a show's current_season/current_episode directly from a Trakt summary and bypass episode history.

## 10. OAuth and Edge Function design

Recommended functions:

### trakt-auth

Actions:

- start: validate Supabase user, create one-time state, return Trakt authorization URL
- exchange: validate user + state, exchange code server-side, store token pair, call /users/settings, upsert trakt_connections

Secrets:

- TRAKT_CLIENT_ID
- TRAKT_CLIENT_SECRET
- TRAKT_REDIRECT_URI

Browser never receives TRAKT_CLIENT_SECRET, access_token or refresh_token.

Recommended verify_jwt: true, because browser calls should use the normal signed-in Supabase JWT. There is no need to disable platform JWT verification for this path.

### trakt-sync

Responsibilities:

- obtain a valid access token through the token manager
- run initial full import
- run incremental pull
- drain outbound outbox
- update connection/checkpoint state
- handle pagination
- handle 401 refresh / reauth_required
- handle 429 backoff
- never expose external tokens in response

For the first release, explicit user-triggered "Sync now" is enough. Scheduled sync can be added after correctness is proven.

### trakt-disconnect

Responsibilities:

- validate user
- delete local token row
- mark/delete safe connection state
- clear transient OAuth state
- do not delete the user's local media library
- if Trakt provides a current documented token-revoke endpoint, use it; otherwise local deletion is still mandatory

Verify current Trakt revocation documentation at implementation time rather than guessing the endpoint.

## 11. Single-use refresh-token concurrency design

This is the highest-risk implementation detail.

Proposed mechanism:

1. trakt-sync sees access token is expired or receives a 401.
2. It attempts to acquire a short refresh lease in trakt_tokens using an atomic RPC/update.
3. Only the lease owner may use the current refresh_token.
4. Other concurrent callers do not attempt the same refresh token. They re-read after the lease completes or return a retryable response.
5. The lease owner calls Trakt's token endpoint.
6. On success, it atomically replaces BOTH access_token and refresh_token, increments token_version and clears the lease.
7. The update is conditional on the expected lease ID/token version.
8. If the conditional update affects zero rows, do not overwrite a newer token pair.
9. On invalid_grant/session not found, mark trakt_connections.connection_status=reauth_required and require one user reauthorization.
10. Never log the refresh token or Trakt authorization header.

A simpler "just refresh and upsert" implementation is vulnerable to token invalidation races even in a single-user app because the UI can make parallel requests.

## 12. Initial sync algorithm

Recommended first-run sequence:

1. Complete OAuth.
2. Fetch /users/settings and save safe identity/limits/permissions.
3. Pull movie watched/history data with explicit pagination.
4. Pull TV/episode watched/history data with explicit pagination.
5. Pull movie/show watchlists with explicit pagination.
6. Pull movie/show ratings with explicit pagination.
7. For each media object, match in this order:
   a. TMDB ID,
   b. existing explicit Trakt ID,
   c. IMDb ID,
   d. TMDB lookup/search only as a controlled fallback.
8. Upsert missing catalog objects from TMDB, not from Trakt artwork.
9. Write provider events to media_external_events first so the import is idempotent/auditable.
10. Apply local state through a dedicated inbound-sync database path that prevents echoing the same change back into the Trakt outbox.
11. For TV, create/upsert user_tv_entries as needed, then upsert user_tv_episodes for watched episodes.
12. Let the existing progress trigger maintain current_season/current_episode.
13. Set movie watched_at to the latest watched event and derive repeat_count from event count where semantics are safe.
14. Do not downgrade strong local statuses just because an item is also present in remote watchlist.
15. Save sync checkpoints only after the relevant category finishes successfully.
16. Mark last_full_sync_at when all selected categories complete.

The initial import should support a dry-run/report mode first: counts matched/created/changed/conflicted with no local state mutation. This is especially useful before importing hundreds/thousands of historical episode records.

## 13. Incremental sync algorithm

After initial import:

1. Query Trakt activity/checkpoint data.
2. Compare category timestamps with stored checkpoints.
3. Fetch only changed categories.
4. Page explicitly.
5. Deduplicate through external-event fingerprints/provider IDs.
6. Apply inbound changes through the no-echo path.
7. Update category checkpoint only after success.
8. Drain outbound outbox separately.
9. Record errors per connection/category so one failed rating request does not invalidate a successful history sync.

Do not use generic user_movie_entries.updated_at or user_tv_entries.updated_at as the incremental cursor.

## 14. Preventing sync loops

The dangerous loop is:

Trakt pull -> local update -> DB trigger queues Trakt push -> Trakt changes -> next pull -> repeat.

Recommended rule:

**Inbound provider writes must carry an explicit transaction-local origin = trakt, and the outbox trigger must ignore changes whose origin is trakt.**

Because writes can enter the DB from browser code, Ask AI, or Edge Functions, relying on a React-only flag is not sufficient.

A practical implementation is a dedicated database RPC for inbound sync that sets a transaction-local configuration value and performs the local DML. The enqueue trigger checks that value.

Any RPC used for this must follow current security guidance:

- prefer SECURITY INVOKER if possible,
- if SECURITY DEFINER is genuinely required, restrict EXECUTE tightly,
- set a safe search_path,
- never expose it to anon by accident,
- rerun Security Advisor after migration.

## 15. Conflict policy

Recommended default:

**Supabase remains the app's canonical state; Trakt is a synchronized peer, not the master database.**

Rules:

1. An unsent local mutation wins over an older inbound remote snapshot.
2. A successfully acknowledged outbound mutation updates trakt_sync_state.
3. A newer remote timestamp can update mapped local fields when there is no unsent local mutation for that scope.
4. Conflicts are scope-specific. A local personal_note edit must never block an inbound rating update.
5. Watchlist/history/rating clocks are separate.
6. Destructive operations require stronger evidence than additive operations.
7. Do not automatically erase Trakt history because a local status changed away from completed.
8. If two sides changed the same scope after last_synced_at, record conflict/debug data rather than silently oscillating.

For this personal single-user project, the UI can initially use "last explicit local action wins until pushed" and then accept newer remote changes after acknowledgment.

## 16. Bulk-import side effects that need explicit tests

### Existing audit triggers

A full import can generate many audit rows. Decide whether imported changes to user entry tables should remain audit-visible. External ledger/outbox/state tables should be excluded from user-authored audit.

### TV planning cleanup

Creating historical user_tv_episodes fires trg_cleanup_block_on_episode_watched. Initial backfill could unintentionally clean old scheduled blocks.

Before production import:

- run a dry-run,
- inspect planned TV blocks that would match imported episodes,
- decide whether historical imports should bypass cleanup or whether cleanup is desired.

### Cache updates

Bulk episode inserts repeatedly run trg_sync_tv_entry_progress. Correct but potentially inefficient. If import volume is large, use a controlled batch import path and recompute the cache once per affected TV entry, while preserving the trigger for normal writes.

Do not optimize before measuring; 233 current rows are small, but an external Trakt history could be much larger.

## 17. Younify Phase 2 design

Only begin after partner/web-flow confirmation.

Suggested ingestion path:

Younify -> Edge/server ingestion -> media_external_events -> reconciliation -> existing media tables

Use provider_service to preserve Netflix/Disney+/Prime/etc. provenance.

For each Younify event retain:

- streaming service
- profile
- provider timestamp
- content type
- series/title
- season/episode
- duration
- percent watched
- TMDB IDs
- provider item ID if stable
- raw normalized payload

Do not immediately translate every partial view to "watched".

Define a completion rule only after inspecting real Younify data. Example questions:

- Does Younify already expose a completed flag?
- Is 90%/95% a reasonable threshold by service?
- How are credits/recaps represented?
- Can multiple partial sessions be combined?
- Are timestamps start time, end time or provider activity time?

Younify ratings may use thumbs/stars/likes. Do not force those into the Project_Daily 1–10 scale without a documented mapping. Preserve raw provider rating first.

Avoid automatic Younify -> Trakt propagation in the first version. That creates a three-system feedback loop before we have proven event identity and conflict rules. First ingest Younify as evidence/visibility; later opt into explicit propagation rules.

## 18. Proposed rollout phases

### Phase A — schema foundation

- explicit Trakt/IMDb/TVDB IDs
- trakt_connections
- trakt_tokens
- trakt_oauth_states
- media_external_events
- trakt_sync_state
- trakt_sync_outbox
- RLS + explicit GRANTs
- indexes
- policy hardening on user entry UPDATE policies
- migration assertions
- no user-visible sync yet

### Phase B — OAuth only

- trakt-auth Edge Function
- connect/disconnect UI
- /users/settings
- safe connection status
- no library mutation yet

### Phase C — read-only dry-run and import

- fetch history/watchlist/ratings
- explicit pagination
- matching report
- dry-run counters
- import behind an explicit user action
- no outbound writes

### Phase D — bidirectional sync

- DB enqueue trigger for mapped local fields
- outbound outbox drain
- no-echo inbound RPC
- token refresh lease
- 429 retry/backoff
- conflict state

### Phase E — polish

- sync status in Media settings
- last sync / reauth-required UI
- conflict/error diagnostics
- optional scheduled sync
- developer metrics

### Phase F — Younify research/partner integration

- partner approval
- confirm web linking flow
- ingest provider history into media_external_events
- validate completion semantics
- optionally surface "watched on Netflix/Disney+/..." provenance
- only later consider controlled propagation into Trakt

## 19. Migration implementation checklist

When implementation starts, the migration should satisfy all of the following:

- Create the migration using the project's current migration tooling/convention; do not invent a migration-history version by hand.
- Re-introspect production immediately before writing it.
- Never hardcode a user UUID.
- Every new user-owned table has ON DELETE CASCADE from auth.users.
- Every public table explicitly enables RLS.
- Every Data API role grant is explicit.
- Token/OAuth-state tables revoke anon/authenticated access.
- Owner UPDATE policies use both USING and WITH CHECK.
- New functions define safe search_path.
- SECURITY DEFINER is avoided unless required.
- EXECUTE is explicitly revoked/granted on any privileged RPC.
- Provider/churn tables document why they do not get trg_audit.
- Index every actual sync lookup and queue claim pattern.
- Add assertions for unique IDs, policies/grants and token-table exposure.
- Run Security Advisor after DDL.
- Run Performance Advisor after DDL.
- Test RLS as authenticated user and verify another user cannot read rows.
- Test anon cannot access connection/token/state tables.
- Test service-role Edge Function can access the server-only tables.
- Frontend code must tolerate the pre-migration window.
- ai-proxy DB_CATALOG explicitly excludes secrets/integration plumbing unless a safe table has a concrete AI use case.
- Manual deployment steps must list migration, Vault secrets and every Edge Function.

## 20. Test plan before enabling writes

### OAuth tests

- correct state succeeds
- wrong state rejected
- reused state rejected
- expired state rejected
- redirect URI exact-match verified
- client secret never appears in browser/network response
- token rows inaccessible to authenticated browser

### Refresh tests

- normal 7-day expiry refresh
- two concurrent refresh attempts: only one consumes the token
- second caller recovers from newly stored token
- invalid_grant -> reauth_required
- no token in logs/errors

### Import tests

- known movie maps by TMDB
- known TV show maps by TMDB
- TV episodes upsert idempotently
- repeat Trakt history does not duplicate ledger rows
- repeated movie watches derive correct repeat_count
- unknown content goes through controlled metadata resolution
- import rerun produces zero unintended changes
- pagination beyond 10 and beyond 250 works
- partial category failure does not advance its checkpoint

### Sync behavior tests

- wishlist local -> Trakt add
- wishlist removal -> Trakt remove
- movie watched -> history add
- episode watched -> history add
- rating set/remove
- inbound Trakt change does not enqueue an echo
- local personal_note/priority change creates no Trakt operation
- local planning change creates no Trakt operation
- TV cache remains derived from episode rows
- destructive remote history operations are never inferred from unrelated status edits

### Existing-system regression tests

- RecentMediaWidget still works
- MediaStats still works
- briefing/AI media context still works
- useNextEpisode still uses user_tv_episodes-derived progress
- release calendar remains based on local state
- planned TV block cleanup behavior is explicitly validated during import

## 21. Open questions before implementation

1. Do we want a fully lossless Trakt watch-event archive, or is latest watched_at + repeat_count enough for the UI? Recommendation: keep the event ledger because it is cheap and prevents irreversible loss.
2. Should an inbound Trakt watchlist item ever downgrade an existing local completed/watching state to wishlist? Recommendation: no.
3. Should changing a local item from completed back to another status erase Trakt history? Recommendation: no automatic destructive sync; require an explicit unwatch/history-remove action.
4. Should local TV series rating map to Trakt show rating? Recommendation: yes.
5. Should episode ratings be included in MVP? Recommendation: defer until history/watchlist/show/movie ratings are stable.
6. Should sync be scheduled? Recommendation: start with explicit Sync now and add scheduled sync after correctness is proven.
7. Can Younify support a pure web app account-linking flow? This is a partner-blocking question.
8. Does Younify provide stable event IDs/webhooks in partner docs? Needed before treating it as a durable incremental source.
9. What exact provider-rating normalization does Younify use? Preserve raw values until confirmed.
10. Do we want an independent local is_watchlisted concept in the future? Current status model is simpler but cannot represent every external edge case.

## 22. Recommended implementation order

If work starts later, the order I would use is:

1. Register a Trakt application and decide the exact GitHub Pages callback URL.
2. Re-introspect production schema and current main.
3. Draft the schema migration only; no UI yet.
4. Review RLS/grants/security advisor output.
5. Apply migration manually.
6. Implement trakt-auth and token refresh manager.
7. Implement a read-only connection/settings test.
8. Implement read-only dry-run sync.
9. Compare dry-run results with current 6 movies / 10 series / 233 watched episodes.
10. Enable initial import.
11. Add outbox + outbound writes.
12. Add UI controls/status.
13. Only then request/validate Younify partner access and web linking.

## 23. Explicit non-actions in this research task

No database table, column, index, policy, function or row was changed.

No Supabase migration was applied.

No Supabase Edge Function was deployed.

No Vault secret was added or modified.

No Trakt/Younify account was connected.

No pull request was opened or merged.

The only repository change for this task is this temporary research document on the dedicated research branch.
