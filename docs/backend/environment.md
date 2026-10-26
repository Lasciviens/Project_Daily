# Environment variables and secrets

> Moved out of CLAUDE.md on 13.10.2026.

## Environment Variables

Client vars are baked at build time by `.github/workflows/deploy.yml`; everything else lives in **Supabase Vault only** and is read by an edge function at runtime. No AI or provider key ever reaches client code.

| Variable | Where |
|---|---|
| `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_URL` | GitHub **environment `production`** secrets (main only; not Vault, never repository secrets) — the automatic deploy: a personal access token (`sbp_…`) for `supabase functions deploy`, and the Session pooler connection string for the migrations. `docs/deploy-setup.md`. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Client build — main Supabase |
| `VITE_TMDB_API_KEY` | Client build — TMDB (client-safe) |
| `VITE_GOOGLE_CLIENT_ID` | Client build — Google OAuth (Calendar + Tasks + Health consent) |
| `VITE_STRAVA_CLIENT_ID` | Client build — Strava OAuth start |
| `VITE_OXR_APP_ID` | Client build — Open Exchange Rates (Currency widget) |
| `VITE_VAPID_PUBLIC_KEY` | Client build (GitHub Actions **Variable**) — the VAPID **public** key the browser uses to subscribe to Web Push. Safe to expose. |
| `GEMINI_API_KEY` | Vault — the ONLY AI key; read by `ai-proxy`. (There is no Claude/OpenAI key in this project.) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Vault — server side of the unified Google OAuth (`calendar-oauth`/`calendar-token`) |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Vault — `strava-auth`/`strava-activities`, and `strava-disconnect` (Basic auth on Strava's `/oauth/revoke`) |
| `HEVY_API_KEY` / `HEVY_WEBHOOK_SECRET` / `HEVY_USER_ID` | Vault — Hevy API + webhook auth; `HEVY_USER_ID` is the single-user id reused by every server-side path (health webhook, phone gateway, push cron) |
| `HEALTH_EXPORT_WEBHOOK_SECRET` | Vault — Health Auto Export sends it as `Authorization: Bearer <secret>` |
| `GOOGLE_TASKS_SYNC_SECRET` | Vault — `google-tasks-sync`'s cron-path auth (`x-sync-secret`), read from Vault inside migration `072`'s `lascis-google-tasks-sync` cron job (never in the SQL text). |
| `KASSALAPP_API_KEY` | Vault — personal kassal.app token, read by `food-search`. The client never sees it. |
| `PHONE_GATEWAY_SECRET` | Vault — the iPhone's durable device secret (`x-phone-secret`). Authenticates `phone-gateway` AND `ai-proxy`'s phone branch; both act as `HEVY_USER_ID` server-side. Never put a login/service key on the device. Revoke = rotate this value. `docs/iphone-examples.md`. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Vault — Web Push (VAPID) signing keys for `push-send`. Generate with `npx web-push generate-vapid-keys`. `VAPID_SUBJECT` is the site's URL (the default when unset) or a non-work `mailto:`. `docs/web-push-setup.md`. |
| `PUSH_CRON_SECRET` | Vault — the pg_cron morning-push job's auth (`x-cron-secret` → `push-send`). Read from Vault **inside** the cron (migration 068), never written into the SQL text. |
| `SCREENSCRAPER_DEVID` / `SCREENSCRAPER_DEVPASSWORD` / `SCREENSCRAPER_SSID` / `SCREENSCRAPER_SSPASSWORD` | Vault — read by `screenscraper-sync` and `screenscraper-media`. **All four are needed and the pairs are not interchangeable**: the dev pair identifies the application, the member pair (the screenscraper.fr website login) is what switches the paid membership on. With only the dev pair the account is anonymous — 1 thread, 10k/day, 128 KB/s. |
| `ESDE_SYNC_SECRET` | Edge Function environment secrets (ES-DE exception to Vault storage) — the RP6 handheld's own device secret (`x-esde-secret`), read by `esde-sync`, `esde-media-sync`, and `esde-content-sync`. Deliberately separate from `PHONE_GATEWAY_SECRET` so revoking the handheld never revokes the iPhone's Shortcuts. Revoke = rotate this value. |
| `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` | Vault — the Trakt app's OAuth pair, read by `trakt-api`. The secret never reaches the browser. |
| `TRAKT_SYNC_SECRET` | Edge Function secrets **and** Vault — the Trakt cron's auth (`x-sync-secret`); the cron reads it from Vault, `trakt-api` from its env. |
| `TMDB_API_KEY` | Edge Function secrets — the same TMDB v3 key as `VITE_TMDB_API_KEY`; `trakt-api` needs it to add titles that come from Trakt and to tell Completed from Watching. |
| `MDBLIST_API_KEY` | Edge Function secrets — read by `trakt-api` for Rotten Tomatoes / Metacritic / IMDb / Letterboxd scores by TMDB id. |
| `KOBO_OPDS_TOKEN` | Edge Function secrets **and** Vault — the Send to Kobo catalogue token (in the OPDS path KOReader uses; the sweep cron sends it as `x-kobo-token`). Revoke = rotate it and re-enter the catalogue address on the Kobo. |
| `KOBO_SYNC_SECRET` | Edge Function secrets — the Kobo plugin's device secret (`x-kobo-secret` on `/sync`, `/inbox`, `/deliveries/<id>/ack`, `/applied`, `/cover`, `/capture`, `/ask`), stored on the Kobo in `settings/lascisboard.lua` by `scripts/kobo/set-plugin-secret.lua` over SSH. Separate from `KOBO_OPDS_TOKEN` so rotating one never breaks the other. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Edge Function secrets — a Twitch developer app's pair, read by `igdb-api`, which gets and renews its own app token from them. Never in the client. |
| `SHOP_PRICE_CRON_SECRET` | Edge Function secrets **and** Vault — the daily Shop price/rates sweep's auth (`x-cron-secret` → `shop-price`); the cron reads it from Vault (migration 137), the function from its env. |
| `STEAM_API_KEY` / `STEAM_ID64` | Vault — personal Steam Web API key (steamcommunity.com/dev/apikey) + your own SteamID64, read by `steam-api`. No OAuth — single-user, same posture as `HEVY_USER_ID`. |

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are **injected into every edge function by the platform** — don't add them to Vault and never expose the service-role key to a client or a device.
