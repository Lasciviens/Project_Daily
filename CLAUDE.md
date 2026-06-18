# Lasci's Board — Master Project Guide

> **For any AI starting a new session:** Read this entire file before touching any code.
> This is the single source of truth — update it whenever architecture or phase status changes.

---

## How Claude Code Web Sessions Work (Workflow Guide)

This project runs on **Claude Code on the web** (claude.ai/code). Here's what that means in practice:

### Every session starts fresh
Each time you open a new Claude Code session, the cloud container:
1. Clones the repo fresh from GitHub
2. Reads `CLAUDE.md` automatically
3. Has no memory of previous sessions

This means **everything that matters must be in git**. If it's not committed and pushed, the next session won't know about it.

### The development loop
```
1. You describe what you want
2. Claude creates a branch: claude/<descriptive-name>
3. Claude writes code, runs npm run build to verify, commits
4. Claude pushes and opens a draft PR
5. You review on GitHub, mark ready, merge
6. GitHub Actions auto-deploys to GitHub Pages in ~1 minute
```

### Branches and PRs
- All work goes on `claude/<descriptive-name>` branches — never directly on `main`
- PRs are opened as drafts automatically
- You mark them ready and merge when satisfied
- After merge, `main` auto-deploys via GitHub Actions

### CLAUDE.md is the AI's memory
Since sessions start fresh, CLAUDE.md is the only persistent context the AI has. It should contain:
- Architecture decisions and WHY they were made
- What's been built (so the AI doesn't rebuild it)
- What's NOT done yet (so the AI doesn't assume it exists)
- Coding rules that must be followed every session

**Update CLAUDE.md whenever:** a new feature is completed, an architecture decision changes, a new rule is established.

### Live URLs
- **App:** `https://lasciviens.github.io/Project_Daily/#/login`
- **Repo:** `https://github.com/Lasciviens/Project_Daily`

---

## What This Is

A private personal dashboard for one user (Furkan). Hosted on GitHub Pages (static), backend on Supabase. Single user — no multi-tenancy.

**Covers:** Daily planning, tasks, media tracking (movies + TV), work tasks, projects, AI assistant, Google Calendar, training/Strava, games library (RP5/Retroid), home widgets (weather, transit, currency, news).

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | GitHub Pages = static only |
| Routing | HashRouter (`/#/route`) | GitHub Pages has no server rewrite |
| Styling | Tailwind CSS v3 | Utility-first, design tokens in config |
| Color theme | CSS custom properties (`--accent-*`) | Runtime theme switching |
| State (UI) | Zustand (`src/app/store.ts`) | Drawer open/close, selectedDate |
| State (server) | TanStack Query v5 | All Supabase/API calls |
| Forms | React Hook Form + Zod | Zod schemas in `shared/schemas/` |
| DB | Supabase (Postgres + Auth + RLS) | Free tier, Edge Functions for proxying |
| Hosting | GitHub Pages via Actions | Builds on push to `main` |

### What Is NOT Used
- No animation library — only `transition-colors` and `transition-shadow` Tailwind utilities
- No shadcn/ui
- No SSR — GitHub Pages is static
- No AI API keys in client — all AI calls go through Supabase Edge Functions

---

## Routing

```
/#/login      → LoginPage (public)
/#/           → HomePage (protected) — dashboard overview
/#/daily      → DailyPage (protected)
/#/media      → MediaPage (protected)
/#/work       → WorkPage (protected)
/#/projects   → ProjectsPage (protected)
/#/training   → TrainingPage (protected)
/#/games      → GamesPage (protected)
```

Protected routes wrapped by `SessionGuard` in `src/app/router.tsx`.

---

## Project Structure

```
src/
├── app/
│   ├── router.tsx        # Route definitions, SessionGuard
│   ├── layout.tsx        # Nav bar, ToDoDrawer toggle, ThemeSwitcher
│   ├── providers.tsx     # QueryClient, theme init
│   └── store.ts          # Zustand: isToDoOpen, toggleToDo
│
├── features/
│   ├── auth/             ✅ Done — LoginPage
│   ├── daily/            ✅ Done — DailyPage, DayView, DayTimeline, WeekWidget, MonthWidget, AddTimeBlockModal
│   ├── todo/             ✅ Done — ToDoDrawer (bottom sheet mobile / right panel desktop), ToDoSection, ToDoItem
│   ├── media/            ✅ Done — MediaPage, MovieCard, TVCard, MediaDetailModal, MediaSearch, PlanThisButton, DiscoveryTabs, TonightPicker, ReleaseCalendar
│   ├── work/             ✅ Done — WorkPage with task board, stats, week calendar
│   ├── projects/         ✅ Done — ProjectsPage, ProjectDetail, PhaseCard, ItemRow, StatusCycleChip
│   ├── training/         ✅ Done — TrainingPage, Strava OAuth, LogWorkoutModal, SessionCard, TrainingWeekView
│   ├── games/            ✅ Done — GamesPage (Retroid/PlayStation tabs), Library (6 view modes), TierEditorTab, PlayQueueTab (drag-and-drop), GameDetailModal
│   ├── ai/               ✅ Done — AIPanel (Gemini 2.5 Flash via Edge Function, function calling for create_task)
│   ├── calendar/         ✅ Done — OAuth, read/write events, DayCalendarSection with refresh button in Daily page
│   ├── football/         ✅ Done — FootballPage (My Teams + Tournaments tabs), NextMatchHero, FormGuide, FixtureList, StandingsTable
│   └── home/             ✅ Done — HomePage dashboard, WidgetShell, WeatherWidget, RuterWidget (Entur transit), CurrencyWidget, NewsWidget, RecentMediaWidget, GamesHomeWidget, TrainingHomeWidget
│
├── shared/
│   ├── components/
│   │   ├── AddTaskModal.tsx
│   │   └── ThemeSwitcher.tsx
│   └── schemas/
│
└── integrations/
    ├── supabase/client.ts      # Main Supabase client
    ├── rp5-library/client.ts   # Separate RP5/Retroid Supabase client
    ├── tmdb/client.ts          # TMDB API
    ├── anthropic/              # Claude AI (via Edge Function only)
    └── openai/                 # OpenAI (via Edge Function only)

supabase/
├── migrations/
│   ├── 001_tasks.sql           ✅ Applied
│   └── 002_media.sql           ✅ Applied
├── rp5-migrations/
│   └── 001_play_order.sql      ✅ Applied in RP5 Supabase
└── functions/
    ├── football-api/index.ts   Proxy for api-sports.io (API-Football v3) — needs FOOTBALL_API_KEY secret
```

---

## Phase Status

| Phase | Status | Notes |
|---|---|---|
| 1 — Foundation | ✅ Done | Auth, layout, routing, design system |
| 2 — Daily + To-Do | ✅ Done | Tasks CRUD, DayView, WeekWidget, MonthWidget, ToDoDrawer |
| 2.5 — UI Polish | ✅ Done | Color themes, AddTaskModal, DayTimeline |
| 3 — Media | ✅ Done | TMDB, Movies + TV, PlanThisButton, TonightPicker, ReleaseCalendar |
| 4 — Work | ✅ Done | WorkPage task board |
| 5 — AI | ✅ Done | Gemini 2.5 Flash proxy, AIPanel, create_task function calling |
| 6 — Calendar | 🔄 Read-only done | Google Calendar OAuth read; **write/edit = Phase 6.1, NOT started** |
| 7 — Games | ✅ Done | RP5 library proxy, 6 view modes, TierEditor, PlayQueue drag-and-drop |
| 8 — Training | ✅ Done | Strava OAuth, workout logging, week view |
| 9 — Projects | ✅ Done | ProjectsPage with phases, items, status tracking |
| 9.5 — Mobile | ✅ Done | Full mobile pass — 44px touch targets, bottom sheets, responsive layouts |
| 10 — Home | ✅ Done | HomePage dashboard with all widgets |
| 11 — Polish | 📋 Not started | Command Bar (Cmd+K), Activity Log, stats/streaks widget |
| 12 — Calendar Write | 📋 Not started | Phase 6.1 — create/edit/delete Google Calendar events |

---

## Coding Standards (Strict)

### Mobile-first — MANDATORY

Every component must be mobile-first. The app is used on phones.

```tsx
// ✅ Correct — mobile base, desktop override
<button className="w-full md:w-auto min-h-[44px]">

// ❌ Wrong
<button className="w-32 h-8">
```

**Touch target rule:** Every interactive element must have `min-h-[44px]`. No exceptions.

**Hover-only actions are invisible on touch.** Any action hidden behind `hover:` needs an always-visible mobile fallback:
```tsx
{/* Mobile: always visible */}
<div className="flex lg:hidden gap-1">
  <button className="min-w-[44px] min-h-[44px]">Delete</button>
</div>
{/* Desktop: hover reveal */}
<div className="hidden lg:flex gap-1 opacity-0 group-hover:opacity-100">
  <button>Delete</button>
</div>
```

**No horizontal overflow on the page** — only inside explicit `overflow-x-auto` containers.

**Modal pattern on mobile** — bottom sheet on mobile, centered on `sm:`:
```tsx
<div className="fixed inset-0 flex items-end sm:items-center justify-center">
  <div className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[90vh] overflow-y-auto">
```

### Comments
Only when the WHY is non-obvious. Never describe what the code does. One comment per logical block max.

### File length
Component exceeds ~150 lines → split it.

### Naming
- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- API modules: `camelCaseApi.ts`

### Date formatting — MANDATORY
Always **DD/MM/YYYY**. Never MM/DD/YYYY.
```ts
new Date(dateStr).toLocaleDateString('en-GB')  // ✅ "06/06/2026"
toLocaleDateString('en-US')                     // ❌ FORBIDDEN
```

### User feedback — MANDATORY
Every async action must give visible feedback:
```ts
import { toast } from '../../../app/store'

const id = toast.loading('Saving…')
await doSomething()
toast.dismiss(id)
toast.success('Saved ✓')
```

| Situation | Feedback |
|---|---|
| Button triggers async (save, delete) | `toast.loading` → `toast.success` or `toast.error` |
| Quick toggle (checkbox) | Optimistic UI — no toast unless it fails |
| Destructive action (delete) | Toast confirms |
| Non-critical warning | `toast.warning` (yellow) |

**Toast colors:** 🟢 green = success · 🔴 red = error · 🟡 yellow = warning · ⚫ dark = loading.
Toasts appear **bottom-left**. Always wrap async in try/catch and dismiss loading before success/error:

```ts
const tid = toast.loading('Saving…')
try {
  await doSomething()
  toast.dismiss(tid); toast.success('Saved ✓')
} catch (err) {
  toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
}
```

### Error handling
Only at system boundaries (Supabase calls, external APIs). TanStack Query handles loading/error states.

---

## Color / Theme System

**Never hardcode `amber-*` — always use `accent-*`.**

Available themes: `orange` (default), `red`, `blue`, `purple`, `yellow`, `black`.
Theme persists via `localStorage` key `accent-theme`. Applied on mount in `src/app/providers.tsx`.

---

## Key Patterns

### Query keys
```ts
['tasks', 'section', section]
['tasks', 'day', dateStr, section]
['movies', 'user']
['tv', 'user']
['tmdb', 'search', query]
['rp5', 'stats']
['rp5', 'all-games']
['rp5', 'play-queue']
['rp5', 'game', id]
```
`invalidateQueries({ queryKey: ['rp5'] })` invalidates all games queries at once.

### RP5 Games Library
- Separate Supabase instance: `VITE_RP5_SUPABASE_URL` + `VITE_RP5_SUPABASE_ANON_KEY`
- Client: `src/integrations/rp5-library/client.ts`
- Read from `v_games_summary` (list view) and `v_games_full` (detail view)
- Write to raw `games` table directly (views are read-only)
- `series_name` is computed in the view via JOIN — not in raw `games` table; never select it from `games` directly
- `play_order` column added via `supabase/rp5-migrations/001_play_order.sql`
- Play Queue queries: `v_games_full WHERE play_order IS NOT NULL ORDER BY play_order`

### "Plan This" Button
Creates a task linked to a media item:
```ts
createTask({
  domain: 'media',
  source_type: 'movie' | 'tv_series',
  source_id: entry.id,
  due_date: selected_date,
  title: `Watch: ${title}`,
  section: mapped_from_date,
})
```

### TMDB Image URL
```ts
const posterUrl = (path: string | null, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : '/placeholder-poster.png'
```

### Home widgets — WidgetShell pattern
All home widgets use `WidgetShell` + `useWidgetState` for collapse/sync/interval.
When collapsed, the widget's query must be disabled (no API calls).

---

## Environment Variables

| Variable | Used in | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `integrations/supabase/client.ts` | GitHub Secret |
| `VITE_SUPABASE_ANON_KEY` | `integrations/supabase/client.ts` | GitHub Secret |
| `VITE_TMDB_API_KEY` | `integrations/tmdb/client.ts` | Public read key — safe client-side |
| `VITE_GOOGLE_CLIENT_ID` | Calendar OAuth | GitHub Secret |
| `VITE_RP5_SUPABASE_URL` | `integrations/rp5-library/client.ts` | GitHub Secret |
| `VITE_RP5_SUPABASE_ANON_KEY` | `integrations/rp5-library/client.ts` | GitHub Secret |
| `CLAUDE_API_KEY` | Supabase Vault only | **Never in client code** |
| `OPENAI_API_KEY` | Supabase Vault only | **Never in client code** |

---

## What's NOT Done Yet

### Phase 6.1 — Calendar Write (not started)
- New OAuth scope needed: `https://www.googleapis.com/auth/calendar.events`
- Re-auth flow (current token is read-only scope)
- New Edge Function: `calendar-write`
- UI already exists (`EditCalendarEventModal`) — just needs the backend wired up

### Phase 11 — Polish (not started)
- Command Bar (`Cmd+K`) — quick navigation + task creation
- Activity Log — what happened today/this week across all sections
- Stats/streaks widget on HomePage

### iOS Safari drag-and-drop
HTML5 drag API doesn't work on iOS Safari. The Play Queue drag-to-reorder works on desktop and Android only. No polyfill added — acceptable limitation.

---

## How to Continue Development

1. Start a new Claude Code web session — it reads this file automatically
2. Describe what you want to build or fix
3. Claude creates `claude/<feature-name>` branch, codes, runs `npm run build`, commits, pushes, opens draft PR
4. Review on GitHub → mark ready → merge → auto-deploys in ~1 min
5. Update this CLAUDE.md if the change affects architecture or phase status
