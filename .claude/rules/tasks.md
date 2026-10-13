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
- `is_focused` clears when a task closes (143); reopening doesn't bring it back.
- Daily's glance board uses explicit column counts, never auto-fill: a card never changes place with its content.
- `useSwipeToReveal` captures the pointer only once a horizontal swipe is confirmed — capturing on pointerdown sends every tap on a nested button to the row.
- A cancelled task keeps its record and shows in that day's Cancelled section; Delete is the one delete flow with Undo.
