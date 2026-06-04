# Lasci's Board — Project Guide for Claude Code

## What This Project Is
A personal productivity and entertainment dashboard hosted on GitHub Pages. It integrates with Supabase, Google Calendar, TMDB, Claude API, and OpenAI API. The project is desktop-first but responsive.

## Tech Stack
- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Animations:** Framer Motion
- **State:** Zustand (global) + React Query (server state)
- **Database:** Supabase (Postgres + Auth + Edge Functions)
- **Hosting:** GitHub Pages

## Specialized Agents — Route Tasks Here First

| Agent | Invoke for | File: |
|---|---|---|
| **guardian** | Security, RLS, auth, API keys, Edge Functions | `.claude/agents/guardian.md` |
| **flex** | Mobile/responsive design, breakpoints, animations | `.claude/agents/flex.md` |

**Rule:** Any PR or change that touches authentication, Supabase RLS, or external API keys must be reviewed by `guardian` before merge. Any new UI component must be reviewed by `flex` before merge.

## Project Structure
```
src/
├── pages/
│   ├── Daily.tsx          # Today / Tomorrow / Week / Month (tabbed)
│   ├── Media.tsx          # Films, Shows, Games
│   └── Work.tsx           # Power work tasks
├── components/
│   ├── ui/                # Base: Button, Card, Modal, Badge, Sheet
│   ├── todo/              # ToDoPanel, ToDoItem, ToDoSection
│   ├── media/             # MediaCard, WatchlistSection, GameCard
│   ├── widgets/           # WeekWidget, MonthWidget
│   └── work/              # WorkTaskList, WorkTaskItem
├── services/
│   ├── supabase.ts        # Supabase client init
│   ├── tmdb.ts            # TMDB API (films & shows)
│   ├── games.ts           # Read from existing Retroid Pocket Supabase DB
│   ├── calendar.ts        # Google Calendar API
│   └── ai.ts              # AI proxy calls (routes to Edge Function)
├── hooks/
│   ├── useTodos.ts
│   ├── useMedia.ts
│   ├── useCalendar.ts
│   └── useAI.ts
├── store/
│   ├── todoStore.ts       # Zustand: global to-do state
│   └── uiStore.ts         # Zustand: panel open/close, active tab
├── security/
│   ├── supabaseClient.ts  # Auth-aware Supabase client
│   ├── sessionGuard.tsx   # Route protection component
│   └── apiProxy.ts        # Type-safe wrapper for AI Edge Function calls
└── types/
    ├── media.ts
    ├── todo.ts
    ├── work.ts
    └── calendar.ts
supabase/
├── migrations/            # SQL migrations including RLS policies
└── functions/
    └── ai-proxy/          # Edge Function: proxies Claude + OpenAI calls
```

## Pages

### `/daily` — Daily Page
Four views via tab: **Today**, **Tomorrow**, **This Week**, **This Month**. Shows tasks, calendar events, and scheduled media notes. To-Do panel is available globally.

### `/media` — Media Page
Sections:
- Currently Playing (game — from Retroid Pocket Supabase DB)
- Currently Watching (show)
- Want to Watch (films)
- Upcoming Releases (in theaters)
- Wishlist — Unreleased
- Wishlist — General

AI assistant is context-aware: knows the active media item, can search the web, can add/remove items from lists.

### `/work` — Work Page
ClickUp-style task list for Power work. No external integrations. Tasks saved to Supabase.

## Key Conventions

### File Naming
- Components: `PascalCase.tsx`
- Hooks: `camelCase.ts` prefixed with `use`
- Services: `camelCase.ts`
- Types: `camelCase.ts` (lowercase, descriptive)

### Component Structure
Each component file follows this order:
1. Imports
2. Types/interfaces (local only — shared types go in `types/`)
3. Component function
4. Export

### API Calls
- All external API calls go through `services/` — never inline in components
- React Query handles caching, loading, and error state
- AI calls always go through `security/apiProxy.ts` → Edge Function

### Responsive Design
- Desktop-first UI, mobile must not break
- All responsive changes reviewed by the `flex` agent
- Tailwind breakpoints: default=mobile, `lg:`=desktop target

## Environment Variables
See `.env.example` for the full list. Never commit real values.

## External Integrations
| Service | Purpose | Auth Method |
|---|---|---|
| Supabase | Database + Auth + Edge Functions | anon key (RLS protected) |
| TMDB | Film/show metadata | API key (client-safe, read-only) |
| Games DB | Retroid Pocket game data | Supabase service key (Edge Function only) |
| Google Calendar | Calendar events | OAuth2 (token stored in Supabase) |
| Claude API | AI assistant | Secret key (Edge Function only) |
| OpenAI API | AI assistant fallback | Secret key (Edge Function only) |
