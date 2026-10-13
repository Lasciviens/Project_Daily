---
paths:
  - "src/shared/components/plan-modal/**"
  - "src/features/calendar/**"
  - "src/features/daily/api/**"
  - "src/features/todo/api/google*"
  - "supabase/functions/google-tasks-sync/**"
  - "supabase/functions/calendar-*/**"
  - "src/features/daily/hooks/useSchedule.ts"
  - "src/features/daily/components/DayAgenda*"
  - "src/features/daily/components/dayAgendaProjection.ts"
  - "src/features/todo/hooks/useTodos.ts"
---
# Planning, schedule and Google rules

Background: `docs/features/planning-calendar.md`.

- `UnifiedPlanModal` is the one planner. Callers open it through `useEntityModal` (`task`, `time-block`, `schedule-block`, `plan-block`); `PlanEntityModals.tsx` holds the one routing rule (a block with a `task_id` opens as its task). Log every logic change in the CHANGELOG at the top of `UnifiedPlanModal.tsx`.
- A task and its one-off slot are independent facts. `time_blocks.task_id` is the only link; `time_blocks.source_type` is never `'task'` (it names the block's real origin). TV vocabulary differs: tasks use `tv_series`, time_blocks `tv_episode`. A training task's day/time and block move together (142).
- Calendar status is typed: `'linked' | 'not_linked' | 'unknown'` from the real HTTP status (`isCalendarNotFound` accepts 404 and 410) — never a message-string guess. `'unknown'` never deletes a Google Task copy and never creates a fallback.
- One task = one Google entry: a task linked to a Calendar event skips Google Tasks. Don't simplify away `skipGoogleTasks` in `useTodos.ts`; apply the dedupe only after the Calendar link is confirmed.
- Google Tasks outbox: per-task FIFO claim (079); a delete clears `google_task_id` only if it still matches (`clear_google_task_id_if_matches`); a create checkpoints its progress in its own row's payload, never a second row; the opt-out check is never bypassed by `force_recreate`.
- `GOOGLE_SCOPES` (`calendar/googleScopes.ts`) is the one consent list. Calendar writes go through `ensureValidCalendarToken()`.
- Every linked Calendar event lives in `'primary'`; a path that links another calendar must store it on `time_blocks` and in the outbox trigger (`verify-calendar-outbox`).
- Duration is 1–1440 minutes (`clampDurationMinutes`, CHECK in 080). Recurring templates start at `effective_from` (081) and never render before it. Blocks crossing midnight project onto both days (`dayAgendaProjection.ts`).
- A weekly recurrence with no day selected can't be saved (`hasValidRecurrenceSelection`); editing a recurring template never silently turns it into a one-off.
- Schedule writes invalidate the whole `schedule`/`taskGraph` groups; never give a schedule view its own private query key.
