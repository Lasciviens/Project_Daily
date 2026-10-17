---
paths:
  - "supabase/functions/phone-gateway/**"
  - "supabase/functions/push-send/**"
  - "scripts/iphone-shortcuts/**"
  - "public/push-sw.js"
---
# iPhone surface rules

Background: `docs/features/iphone.md`; the gateway contract: `docs/iphone-examples.md`.

- The action table in `docs/iphone-examples.md` is the contract; Shortcuts, Scriptable scripts and widgets must match it.
- Shortcuts time out after about 25 s: `ask` and `sleep` start on the fast model; `brief` builds its context on the server and answers in one shot with no tools (`surface: 'phone'`); every AI call aborts at 22 s with a clean error.
- The device secret is written as the `__PHONE_GATEWAY_SECRET__` placeholder; never commit a signed Shortcut with the real secret.
- Script and Shortcut names are load-bearing (deep links resolve by name).
- The Scriptable `HizliLog` runner obeys only links that carry its Keychain token.
- `import_body_composition` validates numbers only, refuses a conflicting re-send, and never touches `hevy_body_measurements`/`health_metrics`.
- Every Web Push must show a visible notification (iOS forbids silent pushes).
- Dates the gateway logs are Europe/Oslo days, never UTC.
- Supplement reminders (160): one push per job run with the `supplement-reminder` tag and `renotify` (push-sw passes both on; iOS support for renotify unconfirmed); iOS shows no buttons on a web push, so its tap opens the dose sheet (`?dose=…`) — the text and link live in `supplementReminder.ts`, copied verbatim into `push-send` (`verify-supplement-doses`).
