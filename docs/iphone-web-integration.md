# iPhone ⇄ Lasci's Board — integration project

> Living project doc, owned by the `planner` agent (`.claude/agents/planner.md`).
> Single source of truth for this initiative. Keep current and lean.
> **The user (Furkan) is the final decision authority at every phase gate.**

## Goal (simplest form)

Talk to Lasci's Board **from an iPhone** — send requests to the web / database and
get responses back. Communicate via **Apple Shortcuts**, and/or **Siri**, and/or
**home-screen widgets**, and/or **App Store apps** — or a **better method if
research surfaces one**. Start simple; stay open to innovations. Research proposes;
the user decides.

Concretely, "talk to" means things like: ask/《add a task》/《what's on today》/
《log 100g chicken》/《plan legs Thursday》 by voice or a tap, and see or hear the
answer — reaching our Supabase data and/or the existing `ai-proxy` AI endpoint.

## Context / what we already have (grounding for research)

- **Web app:** React + Vite SPA on GitHub Pages (`lasciviens.github.io/Project_Daily`),
  hash-routed, installable as a **PWA** (service worker already configured).
- **Backend:** Supabase — Postgres + **RLS** (owner-scoped), **Edge Functions**
  (incl. `ai-proxy`, which already accepts JSON over HTTPS with a user JWT and
  does tool-calling over the user's data), plus a generic DB tool layer.
- **Auth:** Supabase Auth (email/password); anon key is client-safe, the service
  key is server-only. A request from a phone would need a real user session/JWT
  (or a scoped token) — never the service key.
- **Single user.** No native iOS app today.

These are the surfaces a phone could plausibly hit: **Supabase REST/RPC**, an
**Edge Function** (e.g. `ai-proxy`), or the **PWA** itself.

## Constraints / non-negotiables

- Security: no service-role key on the device; respect RLS; a leaked token must
  be revocable and low-blast-radius.
- Prefer no-new-heavy-infra; reuse Supabase + the existing edge functions where possible.
- Two-way is the aim: send a request AND get a usable response (shown, spoken, or notified).

## Phase plan (phase-gated — see planner rules)

| Phase | Goal | Exit criteria (Definition of Done) | Gate |
|---|---|---|---|
| **0 · Discovery** — research DONE ✅, awaiting user decision | Learn every viable method (Shortcuts/Siri/widgets/apps/PWA/…), how each reaches our Supabase/edge, capabilities, limits, effort, two-way support, 2026 innovations. | ✅ Comparison table + recommended shortlist written below. | **← USER PICKS THE APPROACH(ES) HERE.** |
| 1 · Decide + spike | Prove the chosen method end-to-end with ONE tiny real call (e.g. a Shortcut that hits a read endpoint and shows the result). | A working round-trip demo on the real iPhone. | User: "yes, build on this." |
| 2 · Auth + security | Safe, revocable auth from the phone to our backend. | `guardian`-approved auth path; no secrets on device. | User sign-off. |
| 3 · Build core actions | The handful of real actions (add task / today / log food / ask AI …). | Each action works on-device + is documented here. | User sign-off. |
| 4 · Polish | Widgets / Siri phrasing / notifications / discoverability. | — | — |

## Open questions (for Discovery)

- Can a **Shortcut** authenticate to Supabase/`ai-proxy` cleanly (store a JWT/token, send `Authorization: Bearer …`), and parse+show/speak the JSON response?
- Do we need a **thin request-handler edge function** as a stable "phone API", or can the phone hit existing endpoints directly?
- Can our **PWA** receive **iOS Web Push** (iOS 16.4+) and/or act as a **Share Target** — a no-extra-app route for web→phone and phone→web?
- **App Intents / Siri** (needs a real app?) vs Shortcuts (no app) — what's the 2026 state?
- Which **App Store apps** (Scriptable, Pushcut, …) add capability worth the dependency?
- Best pattern for **web → phone push** (notify the phone from the server)?

## Candidate approaches

_Discovery research committee, 2026-07-22 (5 angles + synthesis). Confidence HIGH
on stable mechanisms; primary docs (Apple/WebKit/Supabase/OpenAI/Anthropic) 403'd
the fetchers, so freshest post-cutoff specifics (exact Supabase max JWT expiry,
iOS 26 "semantic Siri", OAuth 2.1 GA) must be verified on-device/in-dashboard
before they drive a commitment._

### Recommended shortlist (research committee)
1. **iOS Shortcuts → `ai-proxy` (+ PostgREST for fixed commands)** — the workhorse.
   Genuinely two-way and **Siri-speakable today**, **no App Store app, no cost,
   backend unchanged**. ONE shortcut (Dictate → POST ai-proxy → speak reply) covers
   add-task / today / log-food / ask-AI because ai-proxy already has the generic
   DB-tool layer. Maps onto the repo's proven Edge-Function auth pattern. **Effort S.**
2. **iOS Web Push to the installed PWA** — the missing **return channel**: push the
   AI's answer / reminders / digests to the lock screen when the app is closed,
   reusing the PWA's own auth + VAPID (no Apple Developer account, own domain).
   Build to **pair with #1** (Shortcut asks → ai-proxy computes → push delivers).
   **Effort M.**
3. **ntfy** (free push app with actionable `http` buttons) — for unattended,
   actionable server-pushed loops (button POSTs back to a secret-authed Edge
   Function → reply as a second push). Alternative: a **ChatGPT custom-GPT Action**
   or **Claude MCP connector** if you'd rather converse inside an existing AI app
   (both need a paid sub + put a third party in the request path).

### First spike (Phase 1 candidate) — ~15 min, ZERO backend changes
One Shortcut: **Dictate Text → "Get Contents of URL"** (POST to the EXISTING
`https://<project>.supabase.co/functions/v1/ai-proxy`, headers `apikey:<anon key>`
+ `Authorization: Bearer <a manually-pasted CURRENT user JWT>` + `Content-Type:
application/json`, body `{"messages":[{"role":"user","content":<Dictated Text>}]}`)
**→ "Get Dictionary Value"** (reply text) **→ "Speak Text"** (+ Show Result).
Invoke with "Hey Siri, <name>". `verify_jwt` stays true; RLS scopes everything to
the one user; a leaked shortcut exposes only that user's own data. The pasted JWT
is a **spike credential only** (expires ~1h–max) — productionize via the durable
auth model below.

### Full option comparison (deduped)
| Method | Reaches backend / auth | Two-way | Effort | App Store app? | Key limit |
|---|---|---|---|---|---|
| **Shortcuts → ai-proxy / PostgREST** | Get-Contents-of-URL POST/GET, `apikey` + `Bearer <JWT>` | ✅ | S | none (built-in) | no secret store (token plaintext, iCloud-synced); JWT expiry/rotation |
| **Installed PWA (the existing client)** | the app itself (supabase-js session in localStorage) | ✅ | S | none (Add to Home Screen) | must be OPENED — not ambient; no iOS background execution |
| **iOS Web Push → PWA** | Edge Function stores PushSubscription (owner RLS) + sends VAPID-signed push | partial (delivery only) | M | none (on the PWA) | PWA must be home-screen-installed; user-tap permission; must show a visible notification; best-effort |
| **Scriptable (free JS app)** | `Request` GET/POST to REST/RPC/ai-proxy; **Keychain** for the token; can draw a live widget | ✅ | M | Scriptable (free, generic) | widget refresh budget (~40–70/day, ≥5 min); not your own app |
| **ntfy** (free) | Edge Function `POST ntfy.sh/<topic>`; push's `http` button POSTs back to a secret-authed Edge Function | ✅ | M | ntfy (free) | free tier ~250/day; on-device header-passing of the http button not device-verified |
| **Bark** (free) | Edge Function `POST api.day.app/<key>/…?url=<deep link>` | partial | S | Bark (free) | one-way; only interaction is the click-through URL |
| **Pushcut** | server push → runs a Shortcut; Automation Server | ✅ | M | Pushcut (+ Pro for dynamic/automation) | dynamic content + Automation Server are paid |
| **ChatGPT custom GPT + Action** | OpenAI servers call your OpenAPI endpoint (ai-proxy/PostgREST) | ✅ | M | ChatGPT app (+ Plus to author) | needs Plus + a documented OpenAPI surface; third party in path |
| **Claude custom connector (remote MCP)** | user-scoped MCP server (deployable as an Edge Function) wrapping ai-proxy/REST; OAuth | ✅ | L | Claude app (+ Pro) | most build effort; needs hosted OAuth redirect; Supabase OAuth 2.1 in beta |
| **Native app — App Intents / widgets / Live Activities** | Swift app, Keychain JWT+refresh, App-Intent handlers | ✅ | L | YES — your own app (~$99/yr) | must build/sign/ship a binary; deepest OS integration but heaviest |
| **No-code API-widget / REST-client apps** | generic app points at REST/RPC with a Bearer header | read-only widget / manual REST | S | a generic app | widgets read-only, no token refresh → need a stable secret-authed endpoint |

### Cross-cutting decisions & risks (weigh before Phase 2)
- **AUTH MODEL is the real friction, not transport.** Recommended: a **static,
  revocable "device secret"** validated by a thin **`verify_jwt=off` Edge Function**
  that acts as the single user **server-side via `service_role`** — exactly the
  repo's `hevy-sync`/`health-export-webhook` pattern. Avoid the on-device
  refresh-token dance (Supabase refresh tokens are single-use/rotating; a Shortcut
  and the PWA sharing a session can invalidate each other). **`service_role` never
  touches the device.**
- **No iOS background execution** — PWAs get no Background/Periodic Sync; Shortcuts
  has no daemon. Unattended runs only fire on a trigger (time/location/NFC/…) and
  iOS FORCES a visible banner on every auto-run automation. The server→phone push
  channel (#2/ntfy/Bark/Pushcut) is how you get anything "while closed".
- **Web Push hard rules:** installed PWA only (not a Safari tab), direct-tap
  permission, every push must show a notification (no silent data push). Norway =
  EEA and Apple reversed the 2024 EU home-screen removal, so it *should* work — one
  2026 source still warns of EU-DMA breakage → **verify on the real iPhone.**
- **Web Share Target is unsupported on iOS** — "share a photo/text into the app to
  log it" would force a native Share Extension (an App Store app).
- **`verify_jwt` must be OFF** for any Edge Function that authenticates with its own
  Bearer secret (the documented `hevy-sync` gotcha).
- **Do NOT** wire the *official* Supabase Claude/ChatGPT connector for user data —
  it's a project-management tool (runs SQL / deploys) that bypasses per-user RLS.

## Decision log

_(empty — the user records approach decisions here as gates are crossed.)_

## Notes

- If an earlier `dev_requests` note about this exists, fold it in here (this doc supersedes it).
- Research posture: **max effort**, open to novel methods; every claim should cite a real source before it drives a decision.
