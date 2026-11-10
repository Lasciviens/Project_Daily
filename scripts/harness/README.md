# Browser test harness

The real app (the Vite dev server) on a **mock Supabase**, for Playwright. The page
audits (`scripts/audit-page-width.mjs`, `scripts/audit-text-overflow.mjs`) run
through it, and any Playwright script can use it. Nothing here reaches a real
backend or the internet.

A browser context gets `installMocks(context)`: every request it makes outside the
app's own server is answered in Node by Playwright's request routing (a "route":
the browser asks, the harness answers instead of the network):

| Request | Answer |
|---|---|
| `https://mock.supabase.co/auth/v1/…` | a signed-in session for the made-up owner, Ola Nordmann (`ola.nordmann@example.com`) |
| `…/rest/v1/<table>` | the made-up rows, read and written through a small PostgREST copy (`postgrest.cjs`); an unknown table answers `[]` |
| `…/rest/v1/rpc/<name>` | `rpc.cjs`; an unknown function answers `[]` |
| `…/functions/v1/<name>` | `functions.cjs`: what each function says when nothing outside is connected; an unknown one answers `{}` |
| `…/storage/v1/…` | empty lists, signed URLs, a transparent pixel for a file |
| any other host (TMDB, Open Food Facts, met.no, EnTur, ESPN, Google …) | **blocked**; an image gets a transparent pixel |
| a WebSocket to any host but the app's | closed before it opens |

The owner lock (`app_allowed_users`) is enforced by the real database only; the
mock answers as the database does for the allowed owner.

## Run it

1. A real `node_modules` in the project folder (`npm ci`). A **symlinked**
   `node_modules` (a git worktree pointing at another checkout) does not work:
   Vite serves nothing outside the project folder, so the Inter font answers 403 and
   every page renders in a fallback font — wrong for any text measurement. The
   harness prints a warning when that happens. Use `npm ci`, or on Linux a
   hard-linked copy: `cp -al <checkout>/node_modules node_modules`.
2. Start the app on the mock (leave it running):

   ```sh
   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=mock-publishable \
   VITE_TMDB_API_KEY=mock VITE_GOOGLE_CLIENT_ID=mock-client.apps.googleusercontent.com \
   npx vite --port 5371 --strictPort --host 127.0.0.1
   ```

   Values given on the command line win over a `.env.local` (Vite never
   overwrites a variable that is already set), so the app talks to the mock.
3. Run an audit:

   ```sh
   node scripts/audit-page-width.mjs --harness scripts/harness               # widths 402, 1469, 2450
   node scripts/audit-text-overflow.mjs --harness scripts/harness
   node scripts/audit-page-width.mjs --harness scripts/harness --routes daily:week --widths 402 --shots /tmp/shots
   node scripts/audit-cls.mjs --harness scripts/harness --slow 800 --tabs     # layout shifts: CLS per page and tab switch
   node scripts/audit-cls.mjs --harness scripts/harness --slow 800 --tabs --data seed,light,empty --revisit
   ```

   `audit-cls.mjs` loads each page at 402, 874 (the phone sideways), 1469 and 2450, records every
   layout shift the browser reports (content moving after it was drawn) and, with `--tabs`, switches
   each tab in the page header. `--slow 800` holds every mock answer 800 ms, so each loading copy is
   on screen before its content replaces it. It names what moved by its component and exits 1 when a
   page or a switch goes over the budget (`--budget`, default 0.1 — Chrome's "good"). Not in CI: the
   numbers need a quiet machine and the harness's own data.

   `--data seed,light,empty` plays three accounts: the full seed, a light one (a little of everything)
   and a new, empty one. A loading copy has to suit all three: one sized for the seed moves a light page
   as much as a short one moves the seed's. A first visit should never move more than before the change.
   `--revisit` loads each page once, then measures a second load in the same browser: what the next visit
   looks like once the page remembers its last layout (`useLayoutMemory`). That one should stay within
   the budget.

   `--at HH:MM` starts the page's clock at that time today in Oslo and builds the data around it, so a
   part that follows the hour can be measured at any time — the brief's schedule line stops at 22:00:
   `--routes home --at 23:00`. Only `Date` is shifted and runs on; timers, frames and `performance` stay
   real (a clock that stood still, Playwright's `clock.setFixedTime`, changed the order reads landed in).
   Every mock answer is held the same time, so on a first visit several parts often land in one frame,
   and which ones do varies between runs: a page whose first visit moves in steps (Home) can measure 0.08
   one run and 0.6 the next. Compare a few runs, not one.

   Port 5371 taken? Start Vite on another port and add `--base http://127.0.0.1:<port>`.
   The scripts launch Playwright's Chromium (in the cloud container from
   `/opt/pw-browsers`; elsewhere `npx playwright install chromium`).

`HARNESS_LOG=1` before a command prints every request the mock had no data for
(a table, an RPC, a function) and every blocked outside call — the list to work
from when a page shows an empty state it shouldn't.

### In your own Playwright script

```js
const { installMocks, SESSION } = require('./scripts/harness/mock-server.cjs')

const context = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block' })
const store = await installMocks(context)          // a fresh copy of the data per context
await context.addInitScript(s => localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)), SESSION)
const page = await context.newPage()
await page.goto('http://127.0.0.1:5371/#/daily')
// What the page wrote: store.rows('tasks'). Options: installMocks(context, { tables, now, log, outside }).
```

- `tables: { wish_items: [] }` replaces those tables (an empty state, a long list).
- `now: new Date('2026-12-24T12:00:00Z')` builds the data around another day.
- `log: (message) => …` collects what the mock could not answer.
- `outside: (url, request) => ({ status, headers, body }) | null` answers an outside host
  with a fixture of the test's own; everything else stays blocked.

Writes (insert, upsert, update, delete) change the context's own copy, so a flow can
add a task and see it listed. A new row gets an id, `user_id`, timestamps, `false` for
a flag and `[]` for an array, plus the column defaults listed in `seed.cjs`'s `DEFAULTS`
(today `shop_items`: a quick-list row is open, as the database makes it); other column
defaults, database triggers, RLS and writes made through an RPC are **not** simulated —
except the RPCs answered in `rpc.cjs` (Needs a look's states, `shop_delete_items`).

## The data (`seed.cjs`)

Made up, and relative to **today in Europe/Oslo**, so it never goes stale. Ids are
valid UUIDs, the same on every run.

| Page | What is there |
|---|---|
| Home, Personal | tasks today (timed, waiting, in progress, done, a long title), overdue, the week, the month, undated; one-off slots; repeats (a walk, stretching, stand-up) with today's task; the training plan |
| Training | 16 exercises, 4 routines (Upper A/B, Lower A/B) in the current program and weekly schedule, 8 weeks of logged workouts with sets, 6 Strava activities, the athlete profile |
| Food | 18 foods, 6 recipes with ingredients, 4 weeks of diary, today's meals (a dish, a planned dinner, a supplement dose), next week's plan, water, goals, quick guesses, 2 supplement schedules |
| Health | 60 days of Apple Health metrics (steps, energy, heart rate, HRV, sleep, weight, body fat …), scale reports, Hevy body measurements, workouts |
| Media | 10 films and 6 series (watching, completed, wishlist, paused, dropped, coming soon), watched episodes and every watch, a cinema visit |
| Shop | wishlist (a general wish with two models, a price watch and its clean reads), quick list with past ticks (bananas, coffee and dish soap due for Buy again, bread and a birthday card bought before), owned things (an accessory, a sold one, a cost); 190's deal days, and its functions answered from these rows (`shop_price_stats`, the three Needs-a-look writes, `shop_delete_items`) |
| Work, Projects | work tasks, notes, weekly goals, pinned links; 4 projects with phases, tasks, parts table, log, links and decisions |
| Wishes, Developer, Games, Books, Football, Settings | wishes with seasons; activity, errors, memory, dev requests; 8 games; 6 books with reading sessions; followed teams; subscriptions and a home stop |

Nothing is real: names are placeholders (Ola and Kari Nordmann), places public
landmarks (Jernbanetorget), links `example.com`, every title invented and every
health number generated. Keep it that way (`AGENTS.md`: the repo is public).

## Extend it

- **A table:** add `tables.<name> = [ … ]` in `buildTables()` (`seed.cjs`), shaped like
  the app's own type for it (`src/features/<feature>/types.ts` or its api file). Use the
  `day(n)` / `at(n, 'HH:MM')` helpers for dates.
- **An embed** (`select=*,movie:movies(*)`): found by name — `<embedded table, singular>_id`
  on the row (many-to-one) or `<this table, singular>_id` on the embedded rows
  (one-to-many). Anything else goes into `RELATIONS` in `seed.cjs`.
- **An RPC:** add `name: (args, store) => answer` to `rpc.cjs`.
- **An edge function:** add `name: ({ method, url, headers, body, store, log }) => answer`
  to `functions.cjs` (a plain object is a 200; `reply(status, body)` for another status).
  Read the function in `supabase/functions/<name>/index.ts` and answer as it does when
  the outside service isn't connected.

What the PostgREST copy understands: column filters (`eq` … `ilike`, `in`, `is`,
`cs`/`cd`/`ov`, `fts`, `not.`, `(any)`/`(all)`), `or=` / `and=` trees, JSON paths
(`a->>b`), select with renamed columns, embeds (`!inner`, hints, spreads, nested),
`order` with nulls first/last, `limit`/`offset`, `count=exact`, aggregates (`count()`,
`sum()` …), single-object answers (406 when not exactly one row), and inserts,
upserts (`on_conflict`), updates and deletes. Comparisons follow SQL: a comparison
with NULL is neither true nor false.
