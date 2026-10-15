---
paths:
  - "src/features/todo/**"
  - "src/features/daily/**"
  - "src/features/work/**"
---
# Tasks, Daily and Work rules

Background: `docs/features/tasks.md`, `docs/features/daily.md`, `docs/features/work.md`.

- `tasks` is the one task table for every domain — never a per-feature task table.
- One task model: open/done/day/count rules only in `todo/taskRules.ts` (`verify-task-model` guards against hand-written checks); a day's list only from `useDayTasks` (`fetchTasksForDay(day, today)`); "next" only from `daily/daySchedule.ts`; every task action through `todo/hooks/useTaskActions`. A training task routes to the session's own actions.
- "Closed on a day" reads `tasks.completed_at` (stamped by a trigger, 129), never `updated_at` — any sync moves `updated_at`.
- `tasks.start_date` opens a window that `due_date` closes; it is never a second deadline, and a window filter is never added to `fetchTasksForDay`.
- NEVER_HIDES: never add a wish/period/window/kind filter to an existing task query. The one exception is `taskRules.onDay` (only Today keeps undated rows).
- Load-bearing: `planForm.ts`'s `section: 'today'` default — four server-side `section.eq.today` filters (`phone-gateway` ×2, `push-send`, `ai-proxy`) go silent if it changes.
- An undated task that comes from Google is filed under Today by `upsert_task_from_google` (148), never picked up by a read rule on `google_task_id`: the app pushes its own tasks to Google too, so that would pull every undated Backlog task onto Today (`verify-task-model`).
- No writer produces the retired `tomorrow` / `this_week` section: a day's section comes from `taskRules.sectionForDay` (today → Today, any other day → Backlog); writers take `LiveTaskSection`; an old row opens and saves as Backlog (`taskRules.liveSection`) — never a "(legacy)" pill; ai-proxy's writes refuse them (`verify-ai-confirm`).
- `is_focused` clears when a task closes (143); reopening doesn't bring it back.
- Daily's glance board uses explicit column counts, never auto-fill: a card never changes place with its content.
- `useSwipeToReveal` captures the pointer only once a horizontal swipe is confirmed — capturing on pointerdown sends every tap on a nested button to the row.
- A cancelled task keeps its record and shows in that day's Cancelled part (a timed one dimmed in its slot); Delete is the one delete flow with Undo.
- Daily's day is ONE list: rows only from `daily/dayItems.ts` (`buildDayRows`, `verify-day-items`) over the day's existing reads — never a filter of its own on them (NEVER_HIDES). Split by TIME (timed | Anytime + Done + Cancelled), never by table; a task with its slot on the day is one row.
- A repeat's day is ticked, skipped and undone only through `useRepeatDay()` (it reports and offers Undo); a training row through the session's actions. A day that passed with no tick stays on its day as Missed — never carried over, never counted as open.
- Week strip, week card and month count repeat days through `useRepeatDays()` (`dayItems.repeatsToDoOn`: from today on; a ticked day is its own task) — never a `days_of_week` test of their own.
- One Add per day: the one sheet through `useEntityModal().open({ kind: 'task', defaults: { date, … } })`; a repeat's day opens with `occurrenceDate` (`dayItems.repeatDayRequest`).
