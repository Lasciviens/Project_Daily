---
paths:
  - "supabase/functions/**"
  - "supabase/config.toml"
---
# Edge function rules

Each function's purpose, auth and secrets: `docs/backend/edge-functions.md` · secrets and env: `docs/backend/environment.md`.

- Deno: `import`, no Node built-ins. Every function is self-contained — no `_shared/` imports (a Dashboard deploy can't bundle them).
- Pick one auth model and match `supabase/config.toml`:
  1. Browser: `supabase.auth.getUser(token)` in code, then the function's own `isAppUser(user.id)` copy (copied verbatim; `verify-owner-lock` compares the copies).
  2. Third-party webhook: the sender's own `Authorization: Bearer <secret>`.
  3. Device or cron: a header secret (`x-phone-secret`, `x-cron-secret`, `x-sync-secret`, …) compared with the configured value; the function then acts as `HEVY_USER_ID` with the service role.
  Models 2 and 3, and anything called without a JWT (an `<img>`, a feed fetch), must be listed in `supabase/config.toml` with JWT verification off — a missing entry turns verification on at the next deploy and the call is refused before our code runs.
- Fail closed: a missing secret rejects the request. Compare a header secret in constant time — the function's own `sameSecret` copy, never `===` (`verify-secret-compare`). Never log a secret, a header value or a diff of the two.
- Secrets come from `Deno.env.get(…)`. Supabase keys only through the function's `<supabase-keys>` block — `serviceKey()` / `publishableKey()` (the new `sb_secret_`/`sb_publishable_` keys, legacy JWT keys as the fallback; `verify-supabase-keys`) — never `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` directly. A cron job reads its secret from Vault inside the SQL job; the function reads the same value from its environment.
- CORS: allow the origin, list every custom header in `Access-Control-Allow-Headers`, answer the OPTIONS preflight.
- Keys go in headers (or a form body, as OAuth token requests take them); if the API demands the URL, use `fetchHidingUrl` so an error names the service, not the URL. A fetch of a URL someone supplied goes through `isPrivateHost` and re-checks every redirect. `news-proxy` (no caller check) fetches with `redirect: 'manual'`, re-checks its allow-lists on every hop (≤ 3), answers pictures only as `image/*`, and caps both answers (`verify-ssrf-guard`).
- Imports pinned to exact versions (`https://esm.sh/@supabase/supabase-js@2.118.0`, `npm:psn-api@2.18.1`, `npm:web-push@3.6.7`), never `@2`/`^2`.
- Duplicated code is deliberate and must change together:
  - The Hevy upsert logic is inlined in `hevy-sync`, `hevy-initial-sync`, `hevy-incremental-sync` and `hevy-api` — change all four (import → end marker; `verify-hevy-api` compares them).
  - Sections marked GENERATED (`// <ss-shared>`, Trakt plans, `readingSync`/`opdsFeed`) are edited at their `src/` source and regenerated with `scripts/sync-*-shared.mjs`.
  - Hand-mirrored copies (`calendarOutboxRules`, `articleExtract`, `priceRead`/`fxNorgesBank`, the media reminder rules, the sleep merge in `ai-proxy`/`phone-gateway`) change in the same PR as their source; their verify scripts compare them.
- Deploy is automatic on merge after the migrations; never deploy by hand.
