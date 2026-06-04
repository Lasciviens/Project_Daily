# Lasci's Board — Project Guide for Claude Code

## What This Project Is
A private, modular personal dashboard hosted on GitHub Pages. Covers daily planning, task management, media tracking, work task organization, and AI-assisted contextual actions. Backed by Supabase, integrated with TMDB, Google Calendar, Claude API, and OpenAI API.

## Specialized Agents — Route Tasks Here First

| Agent | Invoke for | Definition |
|---|---|---|
| **guardian** | Security, RLS, auth, API keys, Edge Functions, migrations | `.claude/agents/guardian.md` |
| **flex** | Mobile/responsive design, breakpoints, touch | `.claude/agents/flex.md` |

**Rule:** Any change touching auth/RLS/API keys → `guardian` must review. Any new UI component → `flex` must review.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | GitHub Pages compatible |
| Routing | React Router (HashRouter) | `/#/daily` — avoids GitHub Pages 404 on direct URL |
| Styling | Tailwind CSS | Transitions via Tailwind utilities only — no animation library |
| Components | shadcn/ui + Radix UI | Accessible, Tailwind-based, unstyled base |
| Global State | Zustand | UI state, drawer open/close, active tab |
| Server State | TanStack Query (React Query) | All API/Supabase calls, caching, loading/error |
| Forms | React Hook Form + Zod | Validation schemas in `shared/schemas/` |
| Database | Supabase (Postgres + Auth + Edge Functions + RLS) | |
| Testing | Vitest + React Testing Library | Unit + component tests |
| Linting | ESLint + Prettier | Enforced in CI |
| Hosting | GitHub Pages | Static only — no server-side rendering |

### No Animation Library
Framer Motion and all animation libraries are **excluded**. UI transitions are limited to Tailwind's built-in utilities:
```
transition-colors duration-150   → hover color change
transition-shadow duration-150   → hover shadow
```
No `motion.div`, no `AnimatePresence`, no CSS keyframe libraries.

---

## Routing Strategy

Using **HashRouter** to avoid 404s on GitHub Pages when navigating directly to a route:

```
/#/daily      → Daily page (Today / Tomorrow / Week / Month tabs)
/#/media      → Media page (Films, Shows, Games)
/#/work       → Work page
/#/settings   → Settings
/#/login      → Login (public route)
```

All routes except `/#/login` are protected by `SessionGuard`.

---

## Project Structure

```
src/
├── app/
│   ├── router.tsx           # HashRouter + route definitions
│   ├── layout.tsx           # App shell: nav, to-do drawer, AI panel
│   └── providers.tsx        # QueryClient, Auth, Zustand
│
├── features/                # One folder per domain — the main work happens here
│   ├── daily/
│   │   ├── pages/
│   │   │   └── DailyPage.tsx          # Tab controller: Today/Tomorrow/Week/Month
│   │   ├── components/
│   │   │   ├── DayView.tsx            # Reusable day view (receives a date prop)
│   │   │   ├── WeekWidget.tsx
│   │   │   └── MonthWidget.tsx
│   │   ├── hooks/
│   │   │   └── useDayData.ts          # Tasks + calendar events for a given date
│   │   ├── api/
│   │   │   └── dailyApi.ts
│   │   └── types.ts
│   │
│   ├── todo/
│   │   ├── components/
│   │   │   ├── ToDoDrawer.tsx         # Global right-side drawer (bottom sheet on mobile)
│   │   │   ├── ToDoSection.tsx        # One collapsible section (Inbox, Today, Work...)
│   │   │   └── ToDoItem.tsx
│   │   ├── hooks/
│   │   │   └── useTodos.ts
│   │   ├── api/
│   │   │   └── tasksApi.ts
│   │   └── types.ts
│   │
│   ├── media/
│   │   ├── pages/
│   │   │   └── MediaPage.tsx
│   │   ├── components/
│   │   │   ├── MediaSection.tsx       # Reusable section (Currently Watching, Wishlist...)
│   │   │   ├── MediaCard.tsx
│   │   │   ├── MediaSearch.tsx        # TMDB search
│   │   │   └── PlanThisButton.tsx     # "Plan This" → pick date → creates task
│   │   ├── hooks/
│   │   │   ├── useMedia.ts
│   │   │   └── useTMDB.ts
│   │   ├── api/
│   │   │   ├── mediaApi.ts            # Supabase media reads/writes
│   │   │   └── tmdbApi.ts             # TMDB search + details
│   │   └── types.ts
│   │
│   ├── work/
│   │   ├── pages/
│   │   │   └── WorkPage.tsx
│   │   ├── components/
│   │   │   ├── WorkTaskList.tsx
│   │   │   └── WorkTaskItem.tsx
│   │   ├── hooks/
│   │   │   └── useWorkTasks.ts
│   │   ├── api/
│   │   │   └── workApi.ts
│   │   └── types.ts
│   │
│   ├── ai/
│   │   ├── components/
│   │   │   ├── AIPanel.tsx            # Context-aware AI assistant panel
│   │   │   └── AIActionConfirm.tsx    # Confirmation dialog for AI-proposed actions
│   │   ├── hooks/
│   │   │   └── useAI.ts
│   │   ├── api/
│   │   │   └── aiApi.ts               # Calls Edge Function proxy
│   │   └── types.ts                   # AIAction, AIContext, AIMessage types
│   │
│   └── calendar/
│       ├── hooks/
│       │   └── useCalendar.ts
│       ├── api/
│       │   └── calendarApi.ts
│       └── types.ts
│
├── shared/
│   ├── ui/                    # Base components built on shadcn/ui
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Sheet.tsx          # Drawer/bottom-sheet primitive
│   │   ├── Badge.tsx
│   │   └── Skeleton.tsx
│   ├── components/
│   │   ├── CommandBar.tsx     # Cmd+K global command palette
│   │   └── WidgetRegistry.tsx # Widget system — add new widgets here
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   └── useBreakpoint.ts
│   ├── schemas/               # Zod validation schemas shared across features
│   └── types/
│       └── supabase.ts        # Generated Supabase types (from supabase gen types)
│
├── integrations/
│   ├── supabase/
│   │   └── client.ts
│   ├── tmdb/
│   │   └── client.ts
│   ├── openai/
│   │   └── client.ts          # Client-side stub only — real calls via Edge Function
│   ├── anthropic/
│   │   └── client.ts          # Client-side stub only — real calls via Edge Function
│   └── rp5-library/
│       └── client.ts          # Proxy to RP5 Supabase DB via Edge Function
│
├── security/
│   ├── supabaseClient.ts      # Auth-aware Supabase client (owned by guardian)
│   ├── sessionGuard.tsx       # Redirects unauthenticated users to login
│   └── apiProxy.ts            # Type-safe wrapper for AI/calendar Edge Function calls
│
supabase/
├── migrations/                # SQL migrations — all RLS policies live here
└── functions/
    ├── ai-proxy/              # Proxies Claude + OpenAI — keys in Supabase Vault
    ├── calendar-proxy/        # Google Calendar OAuth + event reads
    └── game-library-proxy/    # Reads from RP5 Supabase DB
```

---

## Data Model

See `docs/data-model.md` for full schema. Summary:

### `tasks`
Single table for all tasks across domains.
```sql
tasks (
  id, user_id, title, description,
  domain:   personal | work | media,
  section:  inbox | today | tomorrow | this_week | backlog,
  status:   open | in_progress | done | cancelled,
  priority: low | medium | high,
  due_date, due_time,
  source_type: manual | media | calendar | ai,
  source_id,   -- links to media_items.id if source_type = media
  created_at, updated_at
)
```
- Work page shows: `domain = 'work'`
- Media plan shows: `domain = 'media'`
- Daily view shows: `section = 'today'` (or tomorrow/this_week filtered by due_date)

### `media_items`
Canonical media data — what TMDB/RP5 knows about a title.
```sql
media_items (
  id, type: movie | show | game,
  external_source: tmdb | rp5 | manual,
  external_id, title, runtime, release_date,
  poster_url, metadata_json
)
```

### `user_media_entries`
Your personal relationship with a media item.
```sql
user_media_entries (
  id, user_id, media_item_id,
  status: watching | playing | wishlist | completed | dropped | paused,
  priority, personal_note, planned_date, rating,
  current_episode, current_season, repeat_count,
  started_at, finished_at, updated_at
)
```

### `activity_log`
Immutable event log — every important action.
```sql
activity_log (
  id, user_id, event_type, entity_type, entity_id,
  payload_json, created_at
)
```

---

## Key Patterns

### AI Action Confirmation
AI never writes to the DB directly. It proposes structured actions; the user confirms.
```
User: "Add Dune Part Two to my wishlist"
  ↓
AI returns: { action: "add_to_wishlist", media_title: "Dune: Part Two", tmdb_id: 693134 }
  ↓
AIActionConfirm dialog: "Add Dune: Part Two to wishlist? [Confirm] [Cancel]"
  ↓
On confirm: mediaApi.addToWishlist()
  ↓
activity_log entry: media_added
```

### "Plan This" Button
Attaches a media item to a day via the task system.
```
MediaCard → [Plan This] → date picker (Today / Tomorrow / This Week / Pick date)
  ↓
Creates tasks row: { domain: 'media', source_type: 'media', source_id: media_item_id, due_date }
  ↓
Appears in DayView for that date
```

### Command Bar (Cmd+K)
Global keyboard shortcut. Handled in `shared/components/CommandBar.tsx`.
Commands: add task, add movie, plan for today, move to tomorrow, search media, ask AI.

### Widget Registry
`shared/components/WidgetRegistry.tsx` — add new widgets here without touching page files.
```ts
export const WIDGETS = [
  { id: 'today-overview',    component: TodayOverview },
  { id: 'tomorrow-preview',  component: TomorrowPreview },
  { id: 'week-overview',     component: WeekWidget },
  { id: 'month-overview',    component: MonthWidget },
  { id: 'media-plan',        component: MediaPlanWidget },
  { id: 'work-queue',        component: WorkQueueWidget },
];
```

### API Call Pattern
- All Supabase calls go through `features/<domain>/api/<domain>Api.ts`
- All AI calls go through `security/apiProxy.ts` → Edge Function
- TanStack Query wraps everything — no raw `fetch` in components
- Zod validates all API responses at the boundary

---

## MVP Build Order

```
Phase 1 — Foundation
  Auth (login/logout) + SessionGuard
  Layout shell (nav, to-do drawer placeholder, route structure)
  Supabase RLS on all tables

Phase 2 — Daily + To-Do
  tasks table + CRUD
  DailyPage with Today/Tomorrow/Week/Month tabs
  Global ToDoDrawer with sections

Phase 3 — Media
  media_items + user_media_entries tables
  TMDB search + add to wishlist
  Currently Watching / Currently Playing sections
  Plan This → task creation
  Media notes on DayView

Phase 4 — Work
  Work task list (same tasks table, domain='work')

Phase 5 — AI
  Edge Function proxy (Claude + OpenAI)
  AI Panel with page context
  AIActionConfirm pattern
  Web search via Claude Responses API

Phase 6 — Calendar
  Google Calendar OAuth (Edge Function)
  Read-only events on DayView

Phase 7 — Games
  RP5 DB proxy via Edge Function
  MediaCard for games

Phase 8 — Polish
  Command Bar
  Activity Log view
  PWA / mobile install
```

---

## File Naming Conventions
- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- API modules: `camelCaseApi.ts`
- Types: `types.ts` per feature, shared types in `shared/types/`
- Zod schemas: `camelCaseSchema.ts` in `shared/schemas/`

## Environment Variables
See `.env.example`. Never commit real values. AI API keys go in Supabase Vault only.
