# Settings, connections and subscriptions

> Moved out of CLAUDE.md on 13.10.2026.

## Connections live in one place
Every external integration's **connect / disconnect / connection status** lives in
**Settings → Subscriptions** (`/settings?tab=subscriptions` — the old `?tab=integrations` still works — renders `ConnectionsTab.tsx`; `/developer?tab=connections` redirects there). Each card also lists its subscriptions (`service_subscriptions`, migration `115`: price, cycle, renews_on, account, `requirement` `required` = the integration needs it / `info` = just FYI; pure rules in `settings/subscriptionRules.ts`, `verify-subscriptions`). The sheet reads a typed price like a shop's ("1 299,00", "1.299,00", "1,299.00" → 1299, `priceFromText`) and won't save one that isn't a number; Renews on is a `DateInput` (28.10.2026 — before, "1.299,00" saved as no price and wiped the stored one). Subscription prices carry a currency (NOK/TRY/USD/EUR) and show the other three small beneath, converted with the Home currency query (`useSubscriptionRates` reuses `useCurrencyRates`, no extra calls); the monthly total converts into one chosen currency. **Settings → Integrations and APIs** (`?tab=apis`, `apiRegistry.ts`, `ApisTab`, `verify-api-registry`) is a static registry of every external API/service: docs link, how connected, auth + secret names, direction, cadence, where used, since, limits, caveats. Settings also holds **Places** (Home/Work = saved transit stops labelled Home/Work, `transitPlaces.findPlace`; Transit's To home / To work buttons use them; a stop and direction can be only one of them, so picking the other place's stop asks first — 28.10.2026, before it silently relabelled Work as Home), **Profile** (`?tab=profile`, `ProfileTab`, 20.10.2026 — owner: the profile chip "should be under settings": birth year, sex and height, `athlete_profile` migration `110`, the same `HealthProfileForm` that saves as you type; Health's header chip is gone and its Overview links here while the profile is incomplete) and **Appearance** incl. **Display size** 80–125 % (root font-size from `useThemeStore`, stamped in `index.html`; 90 % gives a 100 %-zoom laptop the next wider PageBoard step), and **Food** (`?tab=food`, `FoodTab`, 14.10.2026): one "Food · Today" card whose **Quick guess** row opens the preset editor (`QuickGuessEditor` from the Food feature — the owner's `quick_guess_items`, migration 152; a preset's form also holds its Options, migration 159, with an AI "Suggest options" that only fills the form; see `docs/features/food.md`); one bounded card, so the tab is a single 42rem-capped stack at every width (`FOOD_SETTINGS_BOARD`). Older text here saying "Developer → Connections" means this page, and nowhere else. A feature page shows
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
- **user-authorized** (Google, Strava, PlayStation, Apple Calendar through iCloud — an
  app-specific password, `docs/integrations/icloud-caldav.md`) — a real per-user credential;
  connect and revoke from here.
- **server-configured** (Steam, Hevy, Apple Health) — a single-user secret in Supabase Vault
  with no browser consent step at all, so the card is a read-only status readout. **Never render
  a Connect button that can't actually connect anything.** The Hevy card (14.10.2026, migration
  154) also shows the account Hevy reports ("@username · Hevy Pro · kg · km") and, when Hevy's
  workout count differs from the app's, the two counts with one button (**Fetch missing workouts** /
  **Check workouts with Hevy**) — a sync action, not a connect — and a warning line when the last
  account read failed (`docs/integrations/hevy.md`).
  The Google card (15.10.2026, the one-item change) also has **Convert old items** — shown
  connected or not, since it changes only the app's data: a sheet counts what would change first
  (future slots with no task become items Daily can tick; past slots stay as they are; tasks with a
  slot and repeating plans are already one item) with a few examples, and only **Convert** applies
  it (`useConvertPreview` / `useConvertOldItems`, which reports with its own Undo); nothing is
  deleted and each slot keeps its Google Calendar event. Under the Google Tasks line, a second line
  says when changes made in Google Calendar were last read back (`useCalendarReadbackState`;
  `ConvertOldItems.tsx`).

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

## Calendar (Phases 2a–2c and 2b-3a, 29.–30.10.2026)
**Settings → Calendar** (`CalendarTab.tsx`, `?tab=calendar`) holds the app's calendars in Apple Calendar, one per area — Training, Work (with Projects), Personal (tasks, repeats), Games (31.10.2026), Media (episodes, films), Football. For each: the calendar's **name**, the **emoji** in front of its events' titles, its **colour**, a **default alert** (None, at the start, 5–120 min, 1 day before, or **Custom…** — any whole number of minutes up to four weeks, owner 30.10.2026) and **In use**. The owner asked for every such choice to be a setting ("other settings that you are coding but I couldn't change without asking you"), so these are only defaults (`calendar/areas/calendarAreas.ts`; no area has an alert by default since 31.10.2026 — owner: "off by default"; a setting saved earlier keeps its value). Stored in `calendar_prefs` (172: one row per account, audited, owner lock), read through `readCalendarPrefs` (a wrong value falls back to its default; `verify-calendar-areas`). Below the areas, **Every Apple Calendar event** (2b-3a, 177): what an event's notes carry (your notes + a link to the app — the default —, notes only, the link only, or no notes; every event still links to its day in the app) and an **all-day alert** (none — the default —, on the day or the day before, at a time). An alert "None" carries Apple's no-alert marker, which asks the iPhone not to add its own default alert (*to confirm live*). A change to either re-sends every event already in Apple Calendar, and the save says they update in the background. Google Calendar's events don't use these.

One button does it all: with changes it saves them and then brings Apple Calendar up to date (**Save and update Apple Calendar**); without changes it makes what's missing (**Create in Apple Calendar**) or re-applies names and colours (**Update Apple Calendar**). Not connected to iCloud, it only saves (the card links to Settings → Subscriptions; while the connection is loading or can't be read it never says "connect"). The inputs stay locked until the saved settings have loaded, and only the areas edited are sent over the saved ones. A calendar not made is named on its row, in a warning toast, and as the iCloud row's last problem (so a reload still says why). A calendar switched off stays in iCloud as it is. Each area also has **Shows in: Google Calendar / Apple Calendar** (2b-2, `docs/features/calendar-plan.md`; Apple only once iCloud is connected; an area not in use stays on Google). Changing it turns the button into **Save and move…**, which opens a popup first: what each switched area moves ("12 events and 2 repeating plans", to Apple *from today on* or *every day*), how (the new copy first, then the old one goes), then **Move** saves, makes the calendars, moves, and shows "Moving… 8 of 14"; one line says where everything is now, a warning when something stayed behind. A move that fails before anything moved puts the settings back as they were. A calendar renamed or recoloured on the iPhone comes back here by itself (2c), unless a change made here hasn't reached Apple yet. The iCloud card in Subscriptions says "Password not encrypted yet" until the password is sealed, when changes from Apple Calendar were last read ("Changes from Apple Calendar: last read …", and any problem), how many events couldn't be sent yet and why ("2 events not sent to Apple Calendar yet — Has invitees…"), and — where something failed, or while the password isn't sealed — **New app password**: a new app-specific password for the Apple ID already connected (Apple ends the old one when the Apple ID password changes); its calendars and read-back stay. Connecting, and a new password, need a password sign-in to the app in the last 10 minutes (security check, 30.10.2026); the card says so before the form, since Apple shows a new password only once.

## Open question: Connections vs Subscriptions (owner, 13.10.2026)

The owner said Settings → Subscriptions should hold only what they subscribe to ("Google is not a subscription, it's an integration") and wants to decide the split in a later session. Proposal from 13.10.2026, not built:
- **Connections** — every integration: signed in from here (Google Calendar + Tasks, Strava, PlayStation, Trakt) and set up on the server (Steam, IGDB, Hevy, Apple Health via Health Auto Export, Kobo).
- **Subscriptions** — only `service_subscriptions` rows that are paid or renew (likely Hevy Pro, PS Plus, Trakt VIP, Strava, Google One, the ScreenScraper membership, the Supabase plan, Gemini, Health Auto Export premium); a Connections card may link to its plan.
- Questions for the owner: free accounts that renew (the IGDB/Twitch developer app, a free ScreenScraper account, the Steam API key) — Connections only? Is Health Auto Export a subscription or a one-off purchase? Rows with the cycle "Free" — their own group on Subscriptions, or moved?
- Traps: Strava's return address (`REDIRECT_URI` in `stravaApi.ts`) and `traktCallback.ts` land on `#/settings?tab=subscriptions`, so that address must keep opening their cards; about ten in-app links point at `tab=subscriptions` (`SettingsMenu`, `MoreSheet`, `StravaTab`, `ListsView`, `ListDetail`, `SteamTab`, `PlayStationTab`, `EditCalendarEventModal`, `INTEGRATIONS_PATH` in `apiRegistry`, the `DeveloperPage` redirect).
