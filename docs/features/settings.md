# Settings, connections and subscriptions

> Moved out of CLAUDE.md on 13.10.2026.

## Connections live in one place
Every external integration's **connect / disconnect / connection status** lives in
**Settings → Subscriptions** (`/settings?tab=subscriptions` — the old `?tab=integrations` still works — renders `ConnectionsTab.tsx`; `/developer?tab=connections` redirects there). Each card also lists its subscriptions (`service_subscriptions`, migration `115`: price, cycle, renews_on, account, `requirement` `required` = the integration needs it / `info` = just FYI; pure rules in `settings/subscriptionRules.ts`, `verify-subscriptions`). Subscription prices carry a currency (NOK/TRY/USD/EUR) and show the other three small beneath, converted with the Home currency query (`useSubscriptionRates` reuses `useCurrencyRates`, no extra calls); the monthly total converts into one chosen currency. **Settings → Integrations and APIs** (`?tab=apis`, `apiRegistry.ts`, `ApisTab`, `verify-api-registry`) is a static registry of every external API/service: docs link, how connected, auth + secret names, direction, cadence, where used, since, limits, caveats. Settings also holds **Places** (Home/Work = saved transit stops labelled Home/Work, `transitPlaces.findPlace`; Transit's To home / To work buttons use them) and **Appearance** incl. **Display size** 80–125 % (root font-size from `useThemeStore`, stamped in `index.html`; 90 % gives a 100 %-zoom laptop the next wider PageBoard step). Older text here saying "Developer → Connections" means this page, and nowhere else. A feature page shows
that integration's DATA; it may LINK to `/developer?tab=connections`, but it must never carry
its own connect button, disconnect button, or status widget.

Before this, the same job was scattered across three unrelated surfaces — Google in the ⚙
Settings menu, Strava inside the Training tab, PlayStation inside the Games tab — so "is X
connected?" had no single answer and reconnecting meant remembering which page happened to own
it. Moved on explicit user request.

**One narrow exception (25.09.2026, user's own call): RE-authenticating an
already-configured integration may also be offered at the point of failure.**
When PlayStation's stored session expires, the npsso paste form renders inside
the Games tab's expired panel as well as in Connections. This serves the rule's
purpose rather than defeating it — the rule exists so "is X connected?" has one
answer and reconnecting isn't a hunt across pages; recovery in place is not a
second status widget. It is bounded: the form is ONE shared component
(`PsnNpssoForm`), and first-time **connect** and **disconnect** stay in
Connections only. Extend this to another integration only if its credential can
also be revoked by the provider behind our back.

`ConnectionCard`'s `Status` therefore has a fourth value, **`expired`**: a
credential IS stored, so "Not connected" would be wrong, but the provider no
longer honours it, so "Connected" is a lie. Before this, PlayStation's card
read "Connected" off the mere existence of a `psn_tokens` row and offered
nothing but Disconnect — the one action actually needed (paste a fresh token)
was unreachable from the page that owns connections.

Two kinds of integration sit side by side there and are labelled differently, deliberately:
- **user-authorized** (Google, Strava, PlayStation) — a real per-user token; connect and revoke
  from here.
- **server-configured** (Steam, Hevy, Apple Health) — a single-user secret in Supabase Vault
  with no browser consent step at all, so the card is a read-only status readout. **Never render
  a Connect button that can't actually connect anything.**

Load-bearing details:
- `GOOGLE_SCOPES` (`src/features/calendar/googleScopes.ts`) is the ONE definition of the Google
  consent list — the scope array used to live inline in `SettingsMenu.tsx`. Adding a scope =
  append there + one re-consent; never hard-code a second copy.
- **`useAutoRefreshCalendarToken()` runs in `useAppBootstrap()`** (called once by `AppShell` on
  EVERY shell route) — never on the Connections tab, which would reduce it to "refreshes only
  while that tab is open".
- `StravaWidget` is reused WHOLE inside its card (it owns the OAuth-redirect handling, sync and
  disconnect) rather than reimplemented — one Strava code path, just one home for it.
- The ⚙ menu (avatar) holds the theme switch, accent swatches, Notifications, then links to
  Connections and Developer, and Sign out; the phone More sheet reuses the same pieces.
  `/developer?tab=connections` is deep-linkable.
- Layout (`developerBoards.ts` → `CONNECTIONS_BOARD`): column stacks at every width (the PlayStation
  card is tall whenever its npsso form shows) — one list on phones and tablets; from the laptop two
  labelled columns ("Signed in from here" / "Configured on the server"); from 1920 the accounts use a
  42rem main track and the server-side cards sit in 19–22rem columns.
