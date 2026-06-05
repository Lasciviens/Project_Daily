# Lasci's Board — Master Project Guide

> **For any AI continuing this project:** Read this entire file before touching any code.
> This is a living document — update it whenever architectural decisions change.

---

## What This Is

A private personal dashboard for one user. Hosted on GitHub Pages (static), backend on Supabase.
Covers: daily planning, tasks, media tracking (movies + TV), work tasks, AI assistant, Google Calendar.

**Single user.** No multi-tenancy complexity. All RLS policies use `auth.uid() = user_id`.

**Live URL:** `https://lasciviens.github.io/Project_Daily/#/login`
**Repo:** `https://github.com/Lasciviens/Project_Daily`
**Branch convention:** All work goes on `claude/<descriptive-name>` → PR → merge to `main` → auto-deploy.

---

## Specialized Agents — Use These First

| Agent | When to invoke | File |
|---|---|---|
| **guardian** | Security, RLS, auth, API keys, Edge Functions, any migration | `.claude/agents/guardian.md` |
| **flex** | Mobile layout, breakpoints, touch targets, bottom sheets | `.claude/agents/flex.md` |

**Hard rule:** New table or auth change → guardian reviews first. New UI component → flex reviews.

---

## Tech Stack (with rationale)

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | GitHub Pages = static only, no SSR |
| Routing | HashRouter (`/#/route`) | GitHub Pages 404 fix — no server rewrite available |
| Styling | Tailwind CSS v3 | Utility-first, design tokens in config |
| Color theme | CSS custom properties (`--accent-*`) | Runtime theme switching without class rebuilds |
| State (UI) | Zustand (`src/app/store.ts`) | Drawer open/close, selectedDate |
| State (server) | TanStack Query v5 | All Supabase/API calls; cache key: `['domain', 'qualifier', id]` |
| Forms | React Hook Form + Zod | Zod schemas in `shared/schemas/` |
| DB | Supabase (Postgres + Auth + RLS) | Free tier, Edge Functions for API proxying |
| Hosting | GitHub Pages via Actions | Builds on push to `main` |

### What Is NOT Used
- **No animation library** — no Framer Motion, no CSS keyframe libraries. Only `transition-colors duration-150` and `transition-shadow duration-150`.
- **No shadcn/ui installed yet** — planned but not needed until Phase 8 polish.
- **No server-side rendering** — GitHub Pages is static.
- **No AI API keys in client** — all AI calls proxy through Supabase Edge Functions.

---

## Coding Standards (Strict)

### Comments
Write comments **only** when the WHY is non-obvious. Never describe what the code does.

```ts
// Good: explains a non-obvious constraint
// PostgREST OR with nested AND isn't reliable; two queries + JS merge is safer
const [a, b] = await Promise.all([query1, query2])

// Bad: describes what the code does
// Fetch tasks by section
const tasks = await fetchTasksBySection(section)
```

Maximum one comment per logical block. No multi-line comment blocks. No JSDoc on internal functions.

### File length
If a component exceeds ~150 lines, split it. One responsibility per file.

### Component structure
```tsx
// 1. imports
// 2. types/interfaces
// 3. constants (outside component)
// 4. component function
// 5. sub-components (if small and tightly coupled)
```

### Naming
- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- API modules: `camelCaseApi.ts`
- Types file per feature: `types.ts`
- Zod schemas: `shared/schemas/camelCaseSchema.ts`

### No premature abstraction
Three similar things is not enough to abstract. Five similar things with identical structure: abstract.
Don't build for hypothetical future requirements. Build for what's in the current phase.

### Error handling
Only at system boundaries (Supabase calls, TMDB calls). Don't wrap internal functions with try/catch.
TanStack Query handles loading/error states — use `isLoading`, `error` from `useQuery`.

### Query keys
```ts
['tasks', 'section', section]         // section tasks
['tasks', 'day', dateStr, section]    // day view tasks
['movies', 'user']                    // user's movie entries
['tv', 'user']                        // user's TV entries
['tmdb', 'search', query]             // TMDB search results
['tmdb', 'trending', 'week']          // TMDB trending
```
`invalidateQueries({ queryKey: ['movies'] })` invalidates all movie queries at once.

---

## Color / Theme System

Accent color is driven by CSS custom properties. Never hardcode `amber-*` — always use `accent-*`.

```css
/* src/index.css :root — default is Orange */
--accent-50  through --accent-700
```

```ts
/* src/shared/components/ThemeSwitcher.tsx */
applyTheme('blue')  // updates CSS vars + saves to localStorage
```

Available themes: `orange` (default), `red`, `blue`, `purple`, `yellow`, `black`.
Theme persists via `localStorage` key `accent-theme`. Applied on mount in `src/app/providers.tsx`.

---

## Routing

```
/#/login    → LoginPage (public)
/#/daily    → DailyPage (protected)
/#/media    → MediaPage (protected) — Phase 3
/#/work     → WorkPage (protected) — Phase 4
```

Protected routes wrapped by `SessionGuard` in `src/app/router.tsx`.
`<Navigate to="/login">` not `"/#/login"` — HashRouter adds the `#` automatically.

---

## Project Structure

```
src/
├── app/
│   ├── router.tsx        # Route definitions, SessionGuard wrapping
│   ├── layout.tsx        # Nav, ToDoDrawer, ThemeSwitcher, today's date
│   ├── providers.tsx     # QueryClient, theme init
│   └── store.ts          # Zustand: isToDoOpen, toggleToDo, (selectedDate future)
│
├── features/
│   ├── auth/
│   │   └── pages/LoginPage.tsx
│   │
│   ├── daily/                          ✅ Phase 2 complete
│   │   ├── pages/DailyPage.tsx         # Tabs: Today/Tomorrow/Week/Month + viewDate state
│   │   ├── components/
│   │   │   ├── DayView.tsx             # Task list for a date, uses AddTaskModal
│   │   │   ├── WeekWidget.tsx          # 7-day grid, week nav, week number, onDayClick
│   │   │   └── MonthWidget.tsx         # Calendar grid, month nav, onDayClick
│   │   └── hooks/useDayData.ts         # Maps date → section + calls useTasksForDay
│   │
│   ├── todo/                           ✅ Phase 2 complete
│   │   ├── components/
│   │   │   ├── ToDoDrawer.tsx          # Fixed panel: bottom sheet mobile / right side desktop
│   │   │   ├── ToDoSection.tsx         # Collapsible section with AddTaskModal
│   │   │   └── ToDoItem.tsx            # Checkbox, priority dot, domain badge, hover-delete
│   │   ├── hooks/useTodos.ts           # useTasksBySection, useTasksForDay, useCreateTask, etc.
│   │   ├── api/tasksApi.ts             # Supabase CRUD for tasks
│   │   └── types.ts                    # Task, CreateTaskInput, UpdateTaskInput
│   │
│   ├── media/                          🔄 Phase 3 — IN PROGRESS
│   │   ├── pages/MediaPage.tsx         # Movies tab + TV tab; Trending sections at top
│   │   ├── components/
│   │   │   ├── MediaTabs.tsx           # Movies / TV Series tab switcher
│   │   │   ├── MediaSection.tsx        # Reusable collapsible section (title, items, count)
│   │   │   ├── MovieCard.tsx           # Movie poster card with actions
│   │   │   ├── TVCard.tsx              # TV series card with episode progress
│   │   │   ├── MediaSearch.tsx         # TMDB search bar + results dropdown
│   │   │   ├── AddMediaConfirm.tsx     # Confirmation dialog before writing to DB
│   │   │   └── PlanThisButton.tsx      # Date picker popover → creates task (PRIORITY FEATURE)
│   │   ├── hooks/
│   │   │   ├── useMovies.ts            # TanStack Query: user movie entries
│   │   │   ├── useTVSeries.ts          # TanStack Query: user TV entries
│   │   │   └── useTMDB.ts              # TMDB search, trending, details
│   │   ├── api/
│   │   │   ├── moviesApi.ts            # Supabase CRUD for movies + user_movie_entries
│   │   │   ├── tvApi.ts                # Supabase CRUD for tv_series + user_tv_entries
│   │   │   └── tmdbApi.ts              # TMDB REST calls (search, trending, details)
│   │   └── types.ts                    # Movie, TVSeries, UserMovieEntry, UserTVEntry, TMDBResult
│   │
│   ├── work/                           📋 Phase 4
│   ├── ai/                             📋 Phase 5
│   └── calendar/                       📋 Phase 6
│
├── shared/
│   ├── components/
│   │   ├── AddTaskModal.tsx            # Full modal: title textarea + section/priority/domain/date
│   │   └── ThemeSwitcher.tsx           # Color palette dot in nav
│   ├── hooks/
│   │   ├── useAuth.ts                  # { session, loading, user }
│   │   └── useBreakpoint.ts            # (not yet built)
│   └── schemas/                        # Zod validation schemas
│
├── integrations/
│   ├── supabase/client.ts              # createClient — throws if env vars missing
│   ├── tmdb/client.ts                  # TMDB base URL + fetch wrapper (Phase 3)
│   └── (others Phase 5+)
│
└── security/
    ├── supabaseClient.ts               # Re-exports supabase + signIn/signOut/getSession
    ├── sessionGuard.tsx                # Redirects to /login if no session
    └── apiProxy.ts                     # Phase 5: Edge Function proxy wrapper

supabase/
├── migrations/
│   ├── 001_tasks.sql                   ✅ Applied
│   └── 002_media.sql                   🔄 Phase 3 — needs to be run in Supabase SQL Editor
└── functions/                          📋 Phase 5+
```

---

## Data Model

### Completed migrations

#### `tasks` (001_tasks.sql) ✅
```sql
tasks (
  id, user_id, title, description,
  domain:      personal | work | media,
  section:     inbox | today | tomorrow | this_week | backlog,
  status:      open | in_progress | done | cancelled,
  priority:    low | medium | high,
  due_date, due_time,
  source_type: manual | movie | tv_series | calendar | ai,
  source_id,   -- movies.id or tv_series.id when source_type = movie/tv_series
  created_at, updated_at
)
RLS: auth.uid() = user_id (SELECT + INSERT + UPDATE + DELETE)
```

### Phase 3 migrations (002_media.sql) — run in Supabase SQL Editor

#### `movies` — canonical TMDB movie data
```sql
movies (
  id, tmdb_id UNIQUE,
  title, original_title, overview,
  release_date,       -- NULL = TBA/unknown
  runtime,            -- minutes
  status,             -- TMDB status: 'Released' | 'Post Production' | 'Planned' | etc.
  poster_path,        -- TMDB path; build URL as: https://image.tmdb.org/t/p/w500{poster_path}
  backdrop_path,
  genres jsonb,       -- [{ id: number, name: string }]
  tmdb_rating, tmdb_vote_count,
  metadata_json,      -- raw TMDB response; never query directly
  created_at
)
RLS: SELECT → all authenticated; INSERT → authenticated only
```

#### `tv_series` — canonical TMDB TV data
```sql
tv_series (
  id, tmdb_id UNIQUE,
  title, original_title, overview,
  first_air_date, last_air_date,
  status,             -- 'Returning Series' | 'Ended' | 'Canceled' | 'In Production'
  episode_run_time,   -- typical episode minutes
  number_of_seasons, number_of_episodes,
  poster_path, backdrop_path,
  genres jsonb,
  tmdb_rating, tmdb_vote_count,
  metadata_json,
  created_at
)
RLS: same as movies
```

#### `user_movie_entries` — personal relationship with a movie
```sql
user_movie_entries (
  id, user_id, movie_id UNIQUE(user_id, movie_id),
  status:             watching | wishlist | completed | dropped,
  priority:           low | medium | high,
  personal_note, rating (1-10),
  planned_date,
  notify_before_days, -- calendar integration: notify X days before release/planned_date
  repeat_count DEFAULT 0,
  watched_at,
  created_at, updated_at
)
RLS: auth.uid() = user_id (all operations)
```

#### `user_tv_entries` — personal relationship with a TV series
```sql
user_tv_entries (
  id, user_id, tv_series_id UNIQUE(user_id, tv_series_id),
  status:             watching | wishlist | completed | dropped | paused,
  priority:           low | medium | high,
  personal_note, rating (1-10),
  current_season DEFAULT 1, current_episode DEFAULT 0,
  planned_date,
  notify_before_days, -- calendar integration ready
  repeat_count DEFAULT 0,
  started_at, finished_at,
  created_at, updated_at
)
RLS: auth.uid() = user_id (all operations)
```

---

## Key Patterns

### "Plan This" Button — Priority Feature
The most important cross-feature pattern. A media item gets attached to a day via a task.

```
MovieCard / TVCard → [Plan This] button
  ↓
PlanThisButton opens a date popover:
  [ Today ] [ Tomorrow ] [ This Week ] [ Pick date... ]
  ↓
Creates task: {
  domain: 'media',
  source_type: 'movie' | 'tv_series',
  source_id: entry.id,   ← user_movie_entries.id or user_tv_entries.id
  due_date: selected_date,
  title: `Watch: ${movie.title}` or `Watch: ${series.title} S${season}E${episode+1}`,
  section: mapped from due_date (today → 'today', etc.)
}
  ↓
Appears in DayView for that date with a "🎬" or "📺" icon
  ↓
DayView links back to the media item
```

### Confirm Before Adding to DB
Never write to `user_movie_entries` or `user_tv_entries` directly from search results.
Always show `AddMediaConfirm` dialog first:

```
TMDB search result clicked
  ↓
AddMediaConfirm: poster + title + "Add to [section] — [Watching / Wishlist]? [Confirm] [Cancel]"
  ↓
On confirm:
  1. Upsert into movies/tv_series (TMDB canonical data)
  2. Insert into user_movie_entries/user_tv_entries
  3. invalidateQueries(['movies', 'user']) or ['tv', 'user']
```

### Unreleased Content Display
```ts
// A movie/series is "upcoming" if:
const isUpcoming = (releaseDate: string | null): boolean => {
  if (!releaseDate) return true  // TBA
  return new Date(releaseDate) > new Date()
}
```
Upcoming items: grayscale poster with release date overlay, "Upcoming" badge, different card border.
Available items: full color poster, normal display.

### TMDB Image URL
```ts
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const posterUrl = (path: string | null, size = 'w342') =>
  path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '/placeholder-poster.png'
```
Sizes: `w92`, `w154`, `w185`, `w342`, `w500`, `w780`, `original`.

### TMDB External Links
Always provide a link to TMDB for more info:
- Movie: `https://www.themoviedb.org/movie/{tmdb_id}`
- TV: `https://www.themoviedb.org/tv/{tmdb_id}`

### Calendar Integration (design ready, Phase 6 implements)
`notify_before_days` is stored now. When Phase 6 arrives:
- Query entries where `release_date - notify_before_days = today`
- Create Google Calendar event via Edge Function
- Or: query at app load and show in-app notification

### Completed Section
Always collapsed by default (`defaultOpen: false` in `MediaSection`).

### Episode Progress (TV)
Displayed on TVCard as `S2 E5`. "Next episode" button increments `current_episode`.
If `current_episode >= episodes_in_season`: auto-advance to next season, reset episode to 0.

---

## Phase Status

| Phase | Status | Notes |
|---|---|---|
| 1 — Foundation | ✅ Done | Auth, SessionGuard, layout, routing, design system |
| 2 — Daily + To-Do | ✅ Done | Tasks CRUD, DayView, WeekWidget, MonthWidget, ToDoDrawer |
| 2.5 — UI Polish | ✅ Done | Color themes, week nav, day click, AddTaskModal, date in nav |
| 3 — Media | 🔄 In Progress | Migration written; components in progress |
| 4 — Work | ✅ Done | WorkPage with task board, stats, date nav, week calendar |
| 5 — AI | ✅ Done | Gemini 2.5 Flash proxy, AIPanel chat, function calling (create_task) |
| 6 — Calendar | 📋 Pending | Google Calendar OAuth read-only done; **write/edit events = Phase 6.1** |
| 7 — Games | 📋 Pending | RP5 DB proxy, game cards (reuses media patterns) |
| 8 — Training | 📋 Pending | See notes below — new page after Work |
| 9 — Polish | 📋 Pending | Command Bar, Activity Log, PWA, stats widget |
| 10 — Home Page | 📋 Pending | Landing/dashboard page — see notes below |

---

## Phase 6.1 — Google Calendar Event Editing (not yet started)

Currently calendar events are **read-only**. Editing requires:
- Google Calendar API write scope: `https://www.googleapis.com/auth/calendar.events`
- Re-auth flow (current OAuth only requests read scope)
- `PATCH /calendar/v3/calendars/{calendarId}/events/{eventId}` for edits
- `DELETE` for deletions
- New Supabase Edge Function: `calendar-write`
- UI: click event in DayTimeline → edit modal (title, time, description)

**Do not implement until user explicitly starts Phase 6.1.**

---

## Phase 8 — Training Page (planned, not started)

New page after Work in the nav: `/#/training`

Goal: Track workouts, runs, gym sessions.

**Potential integrations to research when starting:**
- **Strava API** — OAuth, free tier; reads activities (runs, rides, swims). Best option.
- **Garmin Connect API** — Limited, requires partnership. Harder.
- **Apple Health / Google Fit** — No direct web API; would need a mobile companion.
- **Manual logging** — Fallback: user manually logs sets/reps/duration into a `training_sessions` table.

**Recommended approach:** Strava OAuth via Edge Function + manual log fallback.
Migration needed: `training_sessions` table (date, type, duration_minutes, notes, source: 'manual'|'strava').

---

## Future Integrations — Research Notes

### Yr.no Weather (Phase 9+)
Norwegian weather service with a free, no-auth REST API.
- API: `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={lat}&lon={lon}`
- No API key needed. Requires `User-Agent` header with app name + contact email.
- Returns hourly forecast for 9 days.
- Show in Daily header: current temp + icon for today's location.
- User's location: Oslo area (ask user to confirm coords or use browser geolocation).
- Can be called directly from client (no proxy needed — public API).

### RUTER Public Transit (Phase 9+)
Oslo public transit real-time data.
- API: Entur / Ruter uses **EnTur JourneyPlanner API** (GraphQL): `https://api.entur.io/journey-planner/v3/graphql`
- No API key needed for basic use. Set `ET-Client-Name` header.
- User wants: select favorite bus/tram lines, see next departures from preferred stops.
- UI: small widget on Daily page showing "Next 68 bus: 4 min, 12 min"
- Need to store: user's preferred stop IDs and line numbers (localStorage or Supabase).
- Can call directly from client.

**Do not build either of these until user explicitly asks to start.**

---

## Phase 10 — Home Page (planned, not started)

A dedicated landing/dashboard page at `/#/` or `/#/home` that gives an at-a-glance overview of everything.

**Potential content:**
- Today's task count + done/open ratio
- Next calendar event
- Current weather (yr.no widget when Phase 9 is done)
- Next Ruter departure (when Phase 9 is done)
- Recently added media
- Quick-add task input
- Week progress bar

**Do not implement until user explicitly asks to start.**

---

## Phase 3 — Media — Detailed Plan

### Sections on MediaPage

**Movies tab:**
1. Trending Today (TMDB `/trending/movie/day`)
2. Trending This Week (TMDB `/trending/movie/week`)
3. Popular (TMDB `/movie/popular`)
4. Currently Watching
5. Wishlist
6. Completed ← collapsed by default

**TV tab:**
1. Trending Today (TMDB `/trending/tv/day`)
2. Trending This Week (TMDB `/trending/tv/week`)
3. Popular (TMDB `/tv/popular`)
4. Currently Watching
5. Wishlist
6. Completed ← collapsed by default

### TMDB API Calls
All calls use `VITE_TMDB_API_KEY` env var. Base: `https://api.themoviedb.org/3`.
```ts
GET /search/movie?query=...&language=en-US
GET /search/tv?query=...&language=en-US
GET /trending/movie/day    or /week
GET /trending/tv/day       or /week
GET /movie/popular
GET /tv/popular
GET /movie/{id}            (for detail when adding)
GET /tv/{id}               (for detail when adding)
```

### MediaSearch component
- Single search bar at the top of MediaPage
- Debounced (300ms) TMDB search
- Dropdown shows results split: "Movies" section / "TV Series" section
- Clicking a result → AddMediaConfirm dialog
- Shows TMDB rating and year in results

### PlanThisButton — detailed spec
```tsx
<PlanThisButton
  entryId={entry.id}          // user_movie_entries.id or user_tv_entries.id
  sourceType="movie"           // or 'tv_series'
  title={movie.title}
  currentSeason={undefined}    // TV only
  currentEpisode={undefined}   // TV only
/>
```
Renders as a small amber/accent button: `📅 Plan`.
On click: popover with [ Today ] [ Tomorrow ] [ This Week ] [ Pick date... ].
On date select: `createTask(...)` then shows a brief success toast (text only, no library).

### Future-proofing checklist (do this in Phase 3)
- [x] `notify_before_days` column in both user entry tables
- [x] `source_type: 'movie' | 'tv_series'` in tasks (already in 001_tasks.sql)
- [x] TMDB external links on every card
- [x] `isUpcoming()` utility for release date checks
- [x] Separate `movies` and `tv_series` tables (not merged media_items)

---

## Environment Variables

| Variable | Used in | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `integrations/supabase/client.ts` | GitHub Secret |
| `VITE_SUPABASE_ANON_KEY` | `integrations/supabase/client.ts` | GitHub Secret |
| `VITE_TMDB_API_KEY` | `integrations/tmdb/client.ts` | GitHub Secret — public TMDB read key is safe client-side |
| `VITE_GOOGLE_CLIENT_ID` | Phase 6 | GitHub Secret |
| `CLAUDE_API_KEY` | Supabase Vault only | Never in client code |
| `OPENAI_API_KEY` | Supabase Vault only | Never in client code |

---

## Planned Third-Party Integrations

These are future integrations — **do not build until explicitly started.**

| Integration | Phase | Notes |
|---|---|---|
| Google Calendar | 6 | OAuth via Edge Function. Read-only events on DayView. `notify_before_days` already stored. |
| Streaming sync (Netflix/Trakt) | 8+ | Netflix has no public API. Approach: **Trakt.tv API** (free, has watched history, scrobbling) or JustWatch for availability. Design: OAuth → sync `current_season/episode` into `user_tv_entries`. Do not over-engineer now. |
| RP5 Games Library | 7 | Read-only proxy via Supabase Edge Function to a separate Supabase DB. |
| Claude AI | 5 | Via Edge Function proxy (`supabase/functions/ai-proxy`). Keys in Supabase Vault only. |
| OpenAI | 5 | Same proxy as Claude — fallback or specific tasks. |

---

## How to Continue Development

1. Pull `main`, create branch `claude/<feature-name>`
2. Check phase status above — implement the next unchecked item
3. Run `npm run build` before every commit — no TypeScript errors allowed
4. Migrations go in `supabase/migrations/NNN_name.sql` — user must run them manually in Supabase SQL Editor
5. Never push secrets — use GitHub Secrets for Vite env vars, Supabase Vault for server-side keys
6. Every PR → draft → merge to main → auto-deploys in ~1 min

### Quick file reference
- Add a new page → `src/features/<name>/pages/<Name>Page.tsx` + route in `src/app/router.tsx`
- Add a new table → `supabase/migrations/NNN_name.sql` + types in `src/features/<name>/types.ts`
- Change accent color system → `src/shared/components/ThemeSwitcher.tsx` + `src/index.css`
- Touch auth/RLS → invoke guardian agent first
