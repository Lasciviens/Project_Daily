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
  - "src/features/todo/hooks/useGoogleTasksSync.ts"
  - "src/features/todo/components/Google*"
---
# Planning, schedule and Google rules

Background: `docs/features/planning-calendar.md`.

- `UnifiedPlanModal` is the one planner. Callers open it through `useEntityModal` (`task`, `time-block`, `schedule-block`, `plan-block`); `PlanEntityModals.tsx` holds the one routing rule (a block with a `task_id` opens as its task). Log every logic change in the CHANGELOG at the top of `UnifiedPlanModal.tsx`.
- A task and its one-off slot are independent facts. `time_blocks.task_id` is the only link; `time_blocks.source_type` is never `'task'` (it names the block's real origin). TV vocabulary differs: tasks use `tv_series`, time_blocks `tv_episode`. A training task's day/time and block move together (142).
- Calendar status is typed: `'linked' | 'not_linked' | 'unknown'` from the real HTTP status (`isCalendarNotFound` accepts 404 and 410) — never a message-string guess. `'unknown'` never deletes a Google Task copy and never creates a fallback.
- One task = one Google entry: a task linked to a Calendar event skips Google Tasks. Don't simplify away `skipGoogleTasks` in `useTodos.ts`; apply the dedupe only after the Calendar link is confirmed.
- Google Tasks outbox: per-task FIFO claim (079); a delete clears `google_task_id` only if it still matches (`clear_google_task_id_if_matches`); a create checkpoints its progress in its own row's payload, never a second row; the opt-out check is never bypassed by `force_recreate`.
- `GOOGLE_SCOPES` (`calendar/googleScopes.ts`) is the one consent list. Calendar writes and every browser Google Tasks call go through `ensureValidCalendarToken()` — never the stored token as is.
- Google Tasks → app runs only in `google-tasks-sync` (cron, Sync now, the background run): never add a second pull in the browser. Its pure rules live in `todo/api/googleTasksRules.ts` between `<google-tasks-rules>` markers, copied verbatim into the function (`verify-google-tasks`).
- Google's `due` is a date: read its date part, write midnight UTC (`googleDueToDate`/`dateToGoogleDue`) — never through a local time.
- The mirror takes Google's data as it is: two lists may share a name (145 dropped 076's index); a failing list or task is reported, never skipped silently.
- Every linked Calendar event lives in `'primary'` — a slot's and a repeating plan's series (147); a path that links another calendar must store it on `time_blocks` / `schedule_blocks` and in both outbox triggers (135, 147) (`verify-calendar-outbox`).
- A repeating plan is ONE Google event: its mapping only in `calendar/calendarSeries.ts` (start = the rule's first real day on or after the later of `effective_from` and the day it was added to Google — `google_calendar_from`, 148, stored with the link and never moved by a later push; wall-clock time + zone, EXDATE only for real occurrences — `verify-calendar-recurrence`), its calls only in `calendar/api/scheduleSeriesCalendar.ts` through the schedule save/delete hooks and Settings' "Add plans to Calendar" (`addPlansToCalendar` → `linkScheduleSeries`, never a second copy). The agenda de-dupes a linked event by its id and by `recurringEventId`.
- A plan's link is written only while it has no series or this one and cleared only while it still names this one. Background pushes keep the series' stored zone (only a planner save may change it). A day of a plan carried to Google (142) runs after the plan's own writes, never awaited; its own event is made only once Google took the EXDATE, else it goes on the retry list (`SERIES_PENDING_KEY`, cleared on sign-out). A skipped day of a plan comes off Google; Undo skip puts it back.
- Duration is 1–1440 minutes (`clampDurationMinutes`, CHECK in 080). Recurring templates start at `effective_from` (081) and never render before it. Blocks crossing midnight project onto both days (`dayAgendaProjection.ts`).
- Whether a recurring plan occurs on a day is answered only by `daily/recurrence.ts` (`occursOn` / `occurrencesBetween`; weekday layouts use `weeklyDaysOf`) — never a `days_of_week` test of its own: since 146 a plan may repeat monthly, every N days/weeks/months or on picked dates (`verify-recurrence`).
- An incomplete repeat can't be saved (`recurrenceProblem`, which runs `hasValidRecurrenceSelection` for weekly, and caps picked dates at 366); editing a recurring template never silently turns it into a one-off. The Repeat choice stays one line (a select) at every width.
- Editing a plan keeps its `effective_from`, except for a choice that counts from it (Monthly, every N): "Starts" shows and is saved (`editedRepeatStart`).
- Schedule writes invalidate the whole `schedule`/`taskGraph` groups; never give a schedule view its own private query key.
