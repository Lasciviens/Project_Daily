# iPhone integration — design rationale + iOS platform limits

> **What shipped:** the `phone-gateway` edge function (device secret) with 11 actions plus `ai-proxy`'s matching
> secret branch · 11 generated Apple Shortcuts (`scripts/iphone-shortcuts/`, Codex-owned) · the `Yemek Logla`
> Scriptable food logger · 4 Scriptable widgets + the `HizliLog` runner · a Web Push morning brief.
> **Setup + the action contract → `iphone-examples.md`** · food logger → `scriptable-food-logger.md` ·
> widgets → `scriptable-widgets.md` · push → `web-push-setup.md`. **This doc answers *why*.**

## Auth model — the real friction is auth, not transport

Shipped: a **static, revocable device secret** validated by a `verify_jwt = off` edge function that acts as the single
user **server-side via the service role** — the same pattern as `hevy-sync` / `health-export-webhook`.

- **Deliberately avoid the on-device refresh-token dance:** Supabase refresh tokens are single-use/rotating, so a
  Shortcut and the PWA sharing a session can invalidate each other. `service_role` never touches the device.
- Shortcuts has **no secret store** — a token sits in plaintext and iCloud-syncs. That is exactly why the credential
  must be revocable in seconds rather than a JWT.
- **`verify_jwt` must be OFF for any edge function that authenticates with its own Bearer/custom secret** (the
  documented `hevy-sync` gotcha), or Supabase rejects the call before our code runs.

## iOS platform limits (hard constraints — plan around them, don't re-litigate)

- **No background execution at all.** PWAs get no Background/Periodic Sync; Shortcuts has no daemon. Unattended runs
  need a trigger (time / location / NFC), and **iOS forces a visible banner on every auto-run automation**. Anything
  "while the app is closed" must come from a server→phone push channel — that is why Web Push exists here.
- **iOS Web Push:** home-screen-**installed PWA only** (never a Safari tab), iOS 16.4+, a direct-tap permission
  grant, and **every push must display a visible notification** (no silent data push). Delivery is best-effort and
  may be minutes late.
- **Web Share Target is unsupported on iOS** — "share a photo into the app to log it" would need a native Share
  Extension (a real App Store app). Don't plan around it.
- **Widget capability:** refresh budget ≈**40–70/day, ≥5 min apart**, and iOS decides the real cadence; a **Small
  widget has only ONE tap target**; a widget cannot run code in place — a tap opens a deep link, which is why the
  `HizliLog` runner pattern exists.

## Do NOT

Wire the official Supabase Claude/ChatGPT connector for user data — it is a project-management tool (runs SQL /
deploys) that bypasses per-user RLS.

## Evaluated and rejected

| Option | Why not |
|---|---|
| **ntfy** | Free ~250/day with actionable `http` buttons, but on-device header passing was never device-verified |
| **Bark** | One-way; the only interaction is a click-through URL |
| **Pushcut** | Dynamic content and the Automation Server are paid |
| **ChatGPT custom-GPT Action** / **Claude remote-MCP connector** | Need a paid subscription and put a third party in the request path; Supabase OAuth 2.1 is in beta and MCP needs a hosted OAuth redirect |
| **Native App Intents app** | ~$99/yr and you must build, sign and ship a binary |
| **No-code API-widget apps** | Read-only, no token refresh |

## Research-posture caveat

Primary Apple / WebKit / Supabase / OpenAI / Anthropic docs 403'd the fetchers during discovery, so post-cutoff
specifics (the exact Supabase max JWT expiry, iOS 26 Siri, OAuth 2.1 GA) were never verified — confirm on-device or
in-dashboard before any of them drives a decision.

## Decision log

- **22/07/2026 — the pasted-JWT spike was deliberately SKIPPED** ("it should be permanent, full setup") and the
  durable device-secret gateway was built directly: one endpoint, one revocable `x-phone-secret`, flat `{action}`
  bodies, never expiring. Web Push was **deferred at that moment** and added later (23/07/2026, migration `068` +
  `push-send`).
