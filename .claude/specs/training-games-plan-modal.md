### Problem
Nine improvements needed across Training page layout, a universal Plan modal, DB category column, Games "Plan session" integration, error log toast feedback, and header week number.

### Solution
Incremental changes: DB migration first, then shared modal, then feature integrations, then layout/UI polish.

### Files affected

#### NEW files
- `supabase/migrations/027_time_blocks_category.sql` — adds `category` column
- `src/shared/components/PlanModal.tsx` — universal plan modal (replaces/wraps AddTimeBlockModal)

#### MODIFIED files
- `src/features/daily/types.ts` — add `category` to `TimeBlock` + `CreateTimeBlockInput`
- `src/features/daily/api/scheduleApi.ts` — pass `category` through createTimeBlock
- `src/features/training/pages/TrainingPage.tsx` — full-width + compact header
- `src/features/training/components/HevyTab.tsx` — remove calendar sub-tab, expose calendar below
- `src/features/training/components/HevyPRList.tsx` — add header description copy
- `src/features/games/components/GameDetailModal.tsx` — add "Plan a session" button + PlanModal integration
- `src/features/developer/pages/DeveloperPage.tsx` — add toast feedback to refresh button
- `src/app/layout.tsx` — add ISO week number to date display

---

### Tasks (ordered, with agent assignment and parallelism)

#### Phase 1 — DB (blocking everything else that touches time_blocks)
**T1** `mira` — Create `027_time_blocks_category.sql`:
```sql
ALTER TABLE time_blocks
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IN ('daily','training','media','games','work','projects','other'))
    DEFAULT 'other';
```
Update `CreateTimeBlockInput` in `src/features/daily/types.ts` to include `category?: string`.
Update `createTimeBlock` in `src/features/daily/api/scheduleApi.ts` to forward `category`.
Update `TimeBlock` interface to include `category?: string | null`.
**Manual Supabase action required**: Run `027_time_blocks_category.sql` in Dashboard > SQL Editor before deploying frontend.

---

#### Phase 2 — Shared PlanModal (depends on T1 types)
**T2** `forge` — Create `src/shared/components/PlanModal.tsx`

Props interface:
```ts
interface PlanModalProps {
  open: boolean
  onClose: () => void
  defaultTitle?: string
  defaultDate?: string      // yyyy-MM-dd
  defaultCategory?: 'daily' | 'training' | 'media' | 'games' | 'work' | 'projects' | 'other'
  defaultStartTime?: string // HH:MM
  defaultDuration?: number
}
```

Fields inside the modal (single "once" mode — recurring is out of scope for this modal):
1. Title `<input>` (required, autoFocus)
2. Date picker row: `←` prev day · date display as `DD.MM.YYYY Day` · `→` next day · "Today" + "Tomorrow" quick buttons
3. Time start: `<input type="time">` (24h, HH:MM)
4. Duration: preset chips (30/60/90/120/180 min) + custom number input
5. Category: `<select>` with options daily/training/media/games/work/projects/other — pre-populated from `defaultCategory` prop, hidden label "Category"
6. "Add to Google Calendar" checkbox (only shown when `calToken` exists in `useCalendarStore`)
7. "Add to To-Do list" checkbox — when checked, calls `useCreateTask` with `domain` set to `defaultCategory ?? 'daily'`

On submit: `useCreateTimeBlock` with `category` field. If "Add to Google Calendar" checked, call `createCalendarEvent`. If "Add to To-Do" checked, call `createTask.mutateAsync` first, then link time block `source_type: 'task'`, `source_id: task.id`.

Toast pattern: loading → success/error.

Dialog pattern from CLAUDE.md. `sm:max-w-md`. `min-h-[44px]` on all interactive elements.

---

#### Phase 3 — Parallel tasks (depend on T1+T2)

**T3** `flex` — Training page layout + header + calendar restructure (`TrainingPage.tsx` + `HevyTab.tsx`)

3a. `TrainingPage.tsx`:
- Remove `max-w-4xl` wrapper — use `px-4 py-6` only (full-width like MediaPage)
- Compact header: single `<div className="flex items-center gap-3 mb-5">` row containing:
  - Title `<h1>` ("Training") at `text-base font-semibold`
  - Tab pills (Hevy / Strava / Programs) inline — same row, `p-0.5 bg-ink-100 rounded-xl` pill group
  - Push `HevySyncButton` icons to the right of that row (compact: icon-only or short label, `min-h-[44px]` preserved)
- The Hevy/Strava/Programs tabs currently live as their own separate block below the h1. Merge into one row.

3b. `HevyTab.tsx`:
- Remove the calendar from any sub-tab (currently there is NO TrainingCalendar component found — confirm no sub-tab named 'calendar' exists, it seems the spec request may be anticipating a component that doesn't exist yet or it exists inside one of the sub-tabs — check `BodyMeasurementsTab`, `RoutinesTab` etc for any calendar reference).
- Actually based on codebase read: `TrainingCalendar.tsx` does NOT exist (404 on read). The feature request says "calendar is a sub-tab inside HevyTab" but the actual HevyTab has sub-tabs: workouts / routines / prs / body / templates. No calendar tab. Likely this is future work — skip moving a calendar that doesn't exist. Note this in spec as: **no action needed** until a TrainingCalendar component is built.

**T4** `forge` — HevyPRList description improvement (`HevyPRList.tsx`)
- Add a compact description banner at the top of `HevyPRList`:
  ```tsx
  <div className="flex items-start gap-2 mb-3 p-3 bg-accent-50 border border-accent-100 rounded-xl">
    <span className="text-lg">🏋️</span>
    <div>
      <p className="text-sm font-semibold text-ink-900">Personal Records</p>
      <p className="text-xs text-ink-500">Your all-time heaviest lift per exercise. Weight shown in kg.</p>
    </div>
  </div>
  ```

**T5** `forge` — Games "Plan a session" button in `GameDetailModal.tsx`
- Import `PlanModal` from `src/shared/components/PlanModal`
- Add `planOpen` state boolean
- In the hero section, next to the "Sıraya Ekle" button, add:
  ```tsx
  <button
    onClick={() => setPlanOpen(true)}
    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent-100 hover:bg-accent-200 text-accent-700 transition-colors min-h-[44px]"
  >
    📅 Plan session
  </button>
  ```
- Render `<PlanModal open={planOpen} onClose={() => setPlanOpen(false)} defaultTitle={game.title} defaultCategory="games" />` at bottom of the Dialog content

**T6** `debug` — Error log refresh toast feedback (`DeveloperPage.tsx`)
- The `refetch()` call on the "↻ Refresh" button currently has no toast
- Wrap in async handler:
  ```ts
  async function handleRefresh() {
    const tid = toast.loading('Refreshing logs…')
    try {
      await refetch()
      toast.dismiss(tid); toast.success('Logs refreshed ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }
  ```
- Replace `onClick={() => refetch()}` with `onClick={handleRefresh}`

**T7** `flex` — Header week number (`src/app/layout.tsx`)
- Import `getISOWeek` from `date-fns`
- Change the date display span:
  ```tsx
  {format(new Date(), 'EEE, d MMM')} · W{getISOWeek(new Date())}
  ```
  Keep `hidden md:block`. Use `text-xs text-ink-400`.

---

#### Phase 4 — Wiring PlanModal into existing daily flow (optional enhancement)
**T8** `forge` — In `DayTimeline.tsx`, the existing "+" button that opens `AddTimeBlockModal` can optionally be updated to use `PlanModal` instead with `defaultDate` pre-filled and `defaultCategory="daily"`. This is an optional wire-up — the existing `AddTimeBlockModal` still works. Decision: keep `AddTimeBlockModal` as-is for Daily page (it has recurring support which PlanModal won't have), just make sure both components coexist.

---

### Open questions
1. **TrainingCalendar**: The requested feature "move calendar below Hevy section" cannot be actioned because `TrainingCalendar.tsx` does not exist in the codebase. T3b should be skipped or deferred until that component is built.
2. **HevySyncButton compact**: Currently `HevySyncButton` renders its own full-width `<div>` with two buttons and a text row. To make it fit a compact header row, it needs a `compact` prop or a separate inline variant. `flex` agent should handle this as part of T3a by either adding a `compact?: boolean` prop to `HevySyncButton`, or extracting a `HevySyncButtonCompact` component.
3. **PlanModal vs AddTimeBlockModal**: Both will coexist. `AddTimeBlockModal` serves `DayTimeline` (has recurring mode, takes a `dateStr` prop, no category). `PlanModal` is the new universal modal (no recurring, has category, has date picker). Do not delete `AddTimeBlockModal`.

### Manual Supabase actions required
- Run `supabase/migrations/027_time_blocks_category.sql` in Supabase Dashboard > SQL Editor **before** deploying the frontend build that uses the `category` field.
- No Edge Function changes needed.
