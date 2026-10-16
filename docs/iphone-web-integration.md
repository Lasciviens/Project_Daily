# iPhone integration — design rationale + iOS platform limits

> **What shipped:** the `phone-gateway` edge function (device secret) with 12 actions plus `ai-proxy`'s matching
> secret branch · 11 generated Apple Shortcuts (`scripts/iphone-shortcuts/`, Codex-owned) · the Scriptable food
> logger · 4 Scriptable widgets + the quick-log runner · a Web Push morning brief · Web Push supplement reminders
> (migration `160`, `features/supplements.md`: the server reminds, the tap opens the dose sheet — no buttons in an iOS
> web notification).
> **Setup + the action contract → `iphone-examples.md`** · food logger → `scriptable-food-logger.md` ·
> widgets → `scriptable-widgets.md` · push → `web-push-setup.md` · how the feature works → `features/iphone.md`.
> **This doc answers *why*, and it is the one home of the iOS platform limits** — other docs link here instead of
> repeating them.

## Auth model — the real friction is auth, not transport

Shipped: a **static, revocable device secret** validated by a `verify_jwt = off` edge function that acts as the single
user **server-side via the service role** — the same pattern as `hevy-sync` / `health-export-webhook`.

- **Deliberately avoid the on-device refresh-token dance:** Supabase refresh tokens are single-use/rotating, so a
  Shortcut and the PWA sharing a session can invalidate each other. `service_role` never touches the device.
- Shortcuts has **no secret store** — a token sits in plaintext and iCloud-syncs. That is exactly why the credential
  must be revocable in seconds rather than a JWT.
- **`verify_jwt` must be OFF for any edge function that authenticates with its own Bearer/custom secret** (the
  documented `hevy-sync` gotcha), or Supabase rejects the call before our code runs. `supabase/config.toml` holds
  that setting and the automatic deploy applies it.

## iOS platform limits (hard constraints — plan around them, don't re-litigate)

1. **No background execution at all.** PWAs get no Background Sync or Periodic Background Sync; Shortcuts has no
   daemon. An unattended run needs a trigger (time of day, location, NFC), and **iOS forces a visible banner on every
   auto-run automation**. Anything that must happen "while the app is closed" comes from the server and reaches the
   phone as a Web Push — that is why Web Push exists here.
2. **iOS Web Push:**
   - only in the **home-screen-installed PWA** (never a Safari tab), iOS 16.4 or later;
   - permission is granted by a direct tap in the app (here: the **Turn on notifications** row);
   - **every push must show a visible notification** — there is no silent data push;
   - delivery is best-effort and may be minutes late.
3. **Web Share Target is unsupported on iOS.** "Share a photo into the app to log it" would need a native Share
   Extension, i.e. a real App Store app. Don't plan around it.
4. **Scriptable widgets:**
   - a refresh budget of about **40–70 refreshes a day, at least 5 minutes apart**, and iOS decides the real cadence;
   - a **Small widget has only ONE tap target**;
   - a widget cannot run code in place — a tap opens a deep link, which is why the quick-log runner pattern exists
     (the tap opens a runner script that does the write). Script names are load-bearing: deep links resolve by name.

Two related limits that shape the integration:

- **Shortcuts' "Get Contents of URL" gives up after roughly 25 seconds.** That is why the AI actions start on a fast
  model, `brief` answers in one turn from context the server builds (no tools), and every AI call aborts at
  22 seconds with a clean error.
- **HealthKit cannot be read while the phone is locked**, so Health Auto Export's scheduled exports run when iOS
  lets them, not on the minute. Delivery gaps there are the platform, not a bug in either app.

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

- **22.07.2026 — the pasted-JWT spike was deliberately SKIPPED** ("it should be permanent, full setup") and the
  durable device-secret gateway was built directly: one endpoint, one revocable `x-phone-secret`, flat `{action}`
  bodies, never expiring. Web Push was **deferred at that moment** and added later (23.07.2026, migration `068` +
  `push-send`).
- **The 12th action**, `import_body_composition` (migration `085`), takes the numbers an on-device OCR Shortcut reads
  from a smart-scale report photo; it is validated and stored server-side, never by the AI.
