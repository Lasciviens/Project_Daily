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
| **0 · Discovery** ← *current* | Learn every viable method (Shortcuts/Siri/widgets/apps/PWA/…), how each reaches our Supabase/edge, capabilities, limits, effort, two-way support, 2026 innovations. | A comparison table of options + a recommended shortlist, written into this doc. | **User picks the approach(es).** |
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

_Pending the Discovery research committee — filled in below once it reports._

## Decision log

_(empty — the user records approach decisions here as gates are crossed.)_

## Notes

- If an earlier `dev_requests` note about this exists, fold it in here (this doc supersedes it).
- Research posture: **max effort**, open to novel methods; every claim should cite a real source before it drives a decision.
