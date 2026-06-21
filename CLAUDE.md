# Lasci's Board — Master Project Guide

> Read this before touching any code. Single source of truth.
> Keep this file lean — no clutter, no outdated info, no verbose explanations. Every line must earn its place.

---

## Session Workflow

Runs on **Claude Code on the web** (claude.ai/code). Container clones repo fresh each session — git is the only memory.

```
1. User describes task
2. Claude branches: claude/<descriptive-name>
3. Code → npm run build → commit → push → draft PR
4. User marks ready → merges → GitHub Actions auto-deploys (~1 min)
```

- Never push directly to `main`
- Update this file when features complete or architecture changes

**Live URLs:** App: `https://lasciviens.github.io/Project_Daily/#/login` · Repo: `https://github.com/Lasciviens/Project_Daily`

---

## Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Routing | HashRouter (`/#/route`) — GitHub Pages has no server rewrite |
| Styling | Tailwind CSS v3, design tokens via CSS custom properties (`--accent-*`) |
| State (UI) | Zustand (`src/app/store.ts`) |
| State (server) | TanStack Query v5 |
| DB | Supabase (Postgres + Auth + RLS + Edge Functions) |
| Hosting | GitHub Pages via GitHub Actions |

UI primitives: `@headlessui/react` v2 (Dialog, Combobox, Popover, Menu). No animation library, no shadcn/ui, no SSR, no AI keys in client code.

---

## Routes

```
/#/login      → LoginPage (public)
/#/home       → HomePage
/#/daily      → DailyPage
/#/media      → MediaPage
/#/work       → WorkPage
/#/projects   → ProjectsPage
/#/training   → TrainingPage
/#/games      → GamesPage
/#/football   → FootballPage
```

Protected by `SessionGuard` in `src/app/router.tsx`.

---

## Features

| Feature | Status | Notes |
|---|---|---|
| Auth | ✅ | LoginPage |
| Daily + To-Do | ✅ | DayView, DayTimeline, WeekWidget, MonthWidget, AddTimeBlockModal, ToDoDrawer |
| Media | ✅ | TMDB, Movies + TV, PlanThisButton, TonightPicker, ReleaseCalendar |
| Work | ✅ | Task board |
| AI | ✅ | Gemini 2.5 Flash via Edge Function, create_task function calling |
| Calendar | ✅ | Google OAuth, read + write events, sync/refresh button in DayTimeline header |
| Games | ✅ | RP5 library proxy, 6 view modes, TierEditor, PlayQueue drag-and-drop |
| Training | ✅ | Strava OAuth, workout logging, week view |
| Projects | ✅ | Phases, items, status tracking |
| Home | ✅ | WidgetShell, Weather, Ruter transit, Currency, News, Recent Media, Games, Training |
| Football | ⚠️ | Page + UI built. API-Football free tier only goes to 2024 — data doesn't load. Plan: pull fixtures from Google Calendar instead. |

**Not done yet:**
- Football data source (Calendar integration planned)
- Command Bar (Cmd+K)
- Activity Log / stats widget
- Routes widget (Home): visual improvement pass
- Routes widget (Home): refresh button — re-fetch only the currently cached from/to values instantly
- Dark Mode: full dark/light toggle; apply `dark` class on `<html>`, define dark variants for cream/ink/accent tokens

---

## Coding Rules (Strict)

### Mobile-first — MANDATORY
Every component mobile-first. `min-h-[44px]` on every interactive element. No exceptions.

```tsx
// ✅
<button className="w-full md:w-auto min-h-[44px]">
// ❌
<button className="w-32 h-8">
```

Hover-only actions need an always-visible mobile fallback. No horizontal page overflow.

Modal pattern — use `@headlessui/react` Dialog (handles Escape, focus trap, portal automatically):
```tsx
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'

<Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
  <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
  <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
      {/* content */}
    </DialogPanel>
  </div>
</Dialog>
```

### Toast feedback — MANDATORY
Every async action must show feedback. Pattern:
```ts
const tid = toast.loading('Saving…')
try {
  await doSomething()
  toast.dismiss(tid); toast.success('Saved ✓')
} catch (err) {
  toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
}
```
Toasts appear bottom-left. 🟢 success · 🔴 error · 🟡 warning · ⚫ loading.

### Other rules
- Date format: always `en-GB` (DD/MM/YYYY). Never `en-US`.
- Never hardcode `amber-*` — use `accent-*`.
- Comments only when WHY is non-obvious.
- Component > ~150 lines → split it.
- No error handling for impossible scenarios. Only validate at system boundaries.

---

## Key Patterns

**Toast store:** `import { toast } from '../../../app/store'`

**RP5 Games:** Separate Supabase instance (`VITE_RP5_SUPABASE_URL`). Read from `v_games_summary` / `v_games_full` views. Write to raw `games` table. `series_name` only exists in the view — never select from raw `games`.

**Home widgets:** All use `WidgetShell` + `useWidgetState`. Disable queries when collapsed.

**TMDB images:** `https://image.tmdb.org/t/p/{size}{path}` (e.g. `w342`)

**Google Calendar:** OAuth scope `calendar.events` covers read + write. Token stored in `useCalendarStore`. Reconnect required if previously connected with read-only scope.

**@headlessui/react v2 — UI primitives (never use manual open/close state for these):**

| Use case | Component | Anchor / notes |
|---|---|---|
| Modal / drawer | `Dialog` + `DialogBackdrop` + `DialogPanel` | `transition` prop on both; `data-[closed]:` for exit animation |
| Search autocomplete | `Combobox` + `ComboboxInput` + `ComboboxOptions` + `ComboboxOption` | `immediate` if options should show on focus; `data-[focus]:bg-cream-50` on option |
| Floating action panel | `Popover` + `PopoverButton` + `PopoverPanel` | `anchor="top start"` / `anchor="bottom start"` via Floating UI |
| Dropdown menu | `Menu` + `MenuButton` + `MenuItems` + `MenuItem` | `anchor="bottom end"`; keyboard nav built-in |

All headlessui components handle: click-outside close, Escape key, focus trap, portal rendering, ARIA attributes. Never add these manually.

Reference files: `src/shared/components/AddTaskModal.tsx` (Dialog), `src/features/home/components/ruter/StopSearchInput.tsx` (Combobox), `src/features/media/components/PlanThisButton.tsx` (Popover), `src/shared/components/SettingsMenu.tsx` (Menu).

---

## Environment Variables

| Variable | Where |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Main Supabase |
| `VITE_TMDB_API_KEY` | TMDB (client-safe) |
| `VITE_GOOGLE_CLIENT_ID` | Calendar OAuth |
| `VITE_RP5_SUPABASE_URL` / `VITE_RP5_SUPABASE_ANON_KEY` | RP5 games Supabase |
| `CLAUDE_API_KEY` / `OPENAI_API_KEY` | Supabase Vault only — never in client |

---

## Edge Functions (Supabase)

**Deploy: manual via Supabase Dashboard or CLI.** The GitHub Actions pipeline only builds and deploys the frontend — `db-migrations` and `deploy-functions` jobs were removed (were failing; to be re-added properly later).

| Function | Purpose |
|---|---|
| `ai-proxy` | Gemini AI calls |
| `calendar-oauth` / `calendar-token` / `calendar-disconnect` | Google Calendar OAuth |
| `football-api` | API-Football proxy (currently unused — free tier doesn't cover current season) |
| `news-proxy` | RSS feed proxy |
| `strava-auth` / `strava-activities` / `strava-disconnect` | Strava OAuth |

**DB Migrations:** Manuel olarak uygulanır — Supabase Dashboard > SQL Editor veya `supabase db push` (local CLI ile). GitHub Actions'ta otomatik çalışmıyor.
