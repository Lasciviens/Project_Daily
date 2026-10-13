// ═════════════════════════════════════════════════════════════════════════════
//  UnifiedPlanModal — the single planning surface for the whole app.
//
//  ┌─ RULES (read before editing) ─────────────────────────────────────────────┐
//  │ 1. ONE CHROME. Rendered inside ModalShell (THEME.md §8) — stacking, Back,   │
//  │    Esc and the phone sheet come from there. Never hand-roll a Dialog here.  │
//  │ 2. CONFIG-DRIVEN. Callers shape the modal from THEIR file via `config`,      │
//  │    `defaults`, `source`, `scheduleExtra`/`taskExtra`, `onSaved`. Adding a    │
//  │    per-caller variation should NOT require editing this folder — add a       │
//  │    field key + a `hide*/lock*` entry instead.                                │
//  │ 3. SINGLE SOURCE OF TRUTH. All mutable state lives in `form` (planForm.ts).  │
//  │ 4. PRESENTATION IS SPLIT. Field widgets → fields.tsx; entity layouts →       │
//  │    TaskTab/ScheduleTab/RecurringTab. This file owns state + save            │
//  │    side-effects only.                                                        │
//  │ 5. MODE, NOT TABS. `mode` ('task'/'schedule'/'recurring') decides which      │
//  │    entity is being created/edited — the user never picks a tab. A caller     │
//  │    editing an existing row never needs to also pass `mode`: `task` implies   │
//  │    'task', `timeBlock` implies 'schedule', `scheduleBlock` implies           │
//  │    'recurring'.                                                              │
//  │ 6. LOG EVERY LOGIC CHANGE in the CHANGELOG below (date · what · why).        │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  CHANGELOG
//  2026-10-13 · v16 · Repeating plans on Google Calendar (migration 147) +
//                    four review fixes on v15:
//                    (a) "Add to Google Calendar" now shows for a repeat too —
//                    on create (Schedule tab with a repeat picked) and in the
//                    repeating-plan editor ("Added to Google Calendar" once
//                    linked). A plan becomes ONE repeating event in 'primary'
//                    (calendar/calendarSeries.ts: RRULE for weekly / every N
//                    days / weeks; an RDATE list for monthly / every N months
//                    / picked dates, the monthly kinds a year ahead and pushed
//                    again when the app opens with < 90 days left;
//                    except_dates → EXDATE). The save hooks
//                    (useCreate/UpdateScheduleBlock, `gcal`) add it, bring it
//                    up to date on every save, or remove it when unticked —
//                    the typed 'linked' / 'not_linked' / 'unknown' status,
//                    deterministic event ids (blockEventId on the plan's id),
//                    and a Calendar failure never undoes the local save. With
//                    no Google connection (`gcal` undefined) the link is left
//                    as it is. The form seeds gcal from the plan's own
//                    google_calendar_event_id (an untouched save never
//                    removes it). Delete removes the series (outbox safety
//                    net, 147's trigger); Undo makes a new one. A day turned
//                    into a one-off plan (142) gets an EXDATE and its own event
//                    (trainingPlanApi.ensurePlanTask → carryOccurrenceToCalendar).
//                    (b) Editing a saved plan shows "Starts" when the choice
//                    counts from it (Monthly, every N days / weeks / months):
//                    a weekly plan saved 05.03 turned Monthly used to anchor on
//                    the 5th with no way to pick the 13th. A change of what it
//                    counts from moves Starts to today (back to the saved start
//                    when the choice returns to it, or to one without an
//                    anchor — withStartForRepeatChange), and the save writes
//                    effective_from from it (editedRepeatStart); any other
//                    choice keeps the saved start as before.
//                    (c) The summary + "Next …" line shows only for Monthly
//                    and Custom — for Every day / Weekdays / Weekly it only
//                    repeated the select and circles (an extra phone line).
//                    (d) Custom → Dates is capped at 366 picks (146's CHECK) in
//                    recurrenceProblem with a plain message, instead of a raw
//                    constraint error on save.
//                    (e) Outside this folder, the same review: a plan may be
//                    monthly / every N / picked dates now, so "weekly plan"
//                    became "repeating plan" (Daily's and Training's delete:
//                    "Repeating plan deleted"; Training's "Change / Delete
//                    repeating plan"), a workout's plan note reads the plan's
//                    own repeat ("Planned every 2 weeks on Tue and Thu,
//                    16:45", repeatSummary), and the coach / Program tab count
//                    an every-N-weeks plan's days as 1/N of a training day
//                    a week (recurrence.weeklyDaysPerWeek).
//  2026-10-13 · v15 · More ways to repeat (migration 146) + owner's requests:
//                    (a) Repeat is ONE line at every width — a select with No
//                    repeat · Every day · Weekdays · Weekly · Monthly · Custom
//                    — plus the M–S day circles (Monday first; stored 0=Sun
//                    numbering unchanged; full day name on hover). Every day /
//                    Weekdays light their circles; a tap turns the choice into
//                    the set it now is (toggleRepeatDay). Picking Weekly with
//                    no set of its own starts from the plan's weekday.
//                    Monthly = the chosen weekday nearest the start's date, or
//                    that date; Custom = every N days / weeks / months, or
//                    picked dates (DateCalendar). A one-line summary and the
//                    next three days come from recurrence.ts — the same rule
//                    every projection uses. Validation is recurrenceProblem
//                    (hasValidRecurrenceSelection still guards weekly).
//                    (b) Saves write schedule_blocks' repeat columns
//                    (repeatRowFromForm: "every 1 week" is stored as weekly,
//                    "every 1 month" as monthly). A new repeat starts on the
//                    planner's date (effective_from = form.date, labelled
//                    "Starts"), no longer always today; picked dates start at
//                    the earliest pick if that is earlier. Editing keeps the
//                    saved start (only an earlier picked date moves it).
//                    Before 146 is applied a weekly-style save still works
//                    and the new kinds fail with "migration 146 not applied"
//                    (scheduleApi).
//                    (c) The date stepper lost its Today / Tomorrow chips.
//                    (d) sectionForDate (the "Also add to Tasks" task and
//                    Training's planned task) and Daily's day section
//                    (taskRules.sectionForDay) no longer write the retired
//                    Tomorrow / This week: any day but today files under
//                    Backlog, so "(legacy)" shows only on an old row.
//                    (e) Deleting a repeating plan says "Repeating plan
//                    deleted" (it may not be weekly any more).
//                    (f) The Google Task list field resolves/creates its list
//                    with ensureValidCalendarToken() instead of the stored
//                    token as is — an expired token used to fail with 401
//                    when a new list name was typed; no valid connection now
//                    says so in the same "Couldn't set up …" toast.
//  2026-10-13 · v14 · One delete flow + faster saves (migration 144):
//                    Delete goes through the shared delete hooks' run(): it
//                    asks, deletes with one call that returns what went with
//                    the row, and says "Task deleted · Undo" (Undo puts back
//                    the same rows — slot, skip, links — and makes the Calendar
//                    event again). Save is no longer "Saving…" while the
//                    question is open. Unscheduling deletes the slot in the
//                    database first, then its Calendar event (best effort; the
//                    calendar outbox, 135, removes it if Google isn't reached)
//                    — before, a missing Google connection blocked removing
//                    the slot at all. The task/block hooks this editor calls
//                    take { report: false }: the editor says "Saved" once.
//  2026-09-26 · v13 · Theme + shared popup system (THEME.md §8–§10):
//                    Chrome moved onto ModalShell — the hand-rolled Dialog,
//                    backdrop and the module-level zCursor/useTopZIndex are
//                    gone (ModalShell's depth context stacks nested popups),
//                    Back now closes it, dismiss is blocked while saving.
//                    No supabase import any more: the linked block is read
//                    through the schedule hook layer's linkedTimeBlockQuery
//                    (qk.schedule.byTask, staleTime 0 — same ref-guarded
//                    once-per-open hydration; a failed read now toasts and
//                    keeps Save disabled instead of guessing "none"), the calendar
//                    link's fresh event-id read through scheduleApi's
//                    fetchTimeBlockCalendarEventId. Every write now goes
//                    through a useMutationWithFeedback hook (create/update/
//                    delete block, update/delete recurring, task hooks), so
//                    every failure is toasted + logged exactly once by the
//                    hook; handleSave only stops the flow and shows the
//                    'Saving…'/'Saved' copy via withProgress. The Google Tasks
//                    sync warning moved into useCreateTask. Deletes confirm
//                    through entityModal.confirm (no native confirm()).
//                    New `loading`/`loadError` props let PlanEntityModals
//                    show the same shell while a row loads by id.
//  2026-08-22 · v12 · Fourth post-review pass (one correctness fix):
//                    updateTimeBlock's remote calendar-event PATCH swallowed
//                    ALL failures (including 404 — the remote event deleted
//                    directly in Google Calendar), so a caller checking the
//                    block's OWN google_calendar_event_id column right after
//                    still saw "confirmed linked" — a live scenario where
//                    editing a calendar-linked task would then dedupe-delete
//                    its Google Task (needsGoogleTaskDedupe), leaving NEITHER
//                    Google representation. updateTimeBlock now returns a
//                    real calendarStatus ('linked'/'not_linked'/'unknown'):
//                    a confirmed 404 clears the stale local id and reports
//                    'not_linked' (safe to recreate); any OTHER failure
//                    (network, rate limit, …) reports 'unknown' WITHOUT
//                    touching the local id — the event is presumably still
//                    fine, we just couldn't confirm it, and this must never
//                    be the reason a task's Google Task gets deleted.
//                    syncTaskSchedule and saveSchedule's timeBlock branch
//                    both now trust this call's own confirmed outcome
//                    instead of the pre-call block snapshot.
//  2026-08-22 · v11 · Third post-review pass (correctness fixes only):
//                    (a) shouldSkipPendingCreate's opt-out guard (google_
//                    sync_enabled=false) is now ABSOLUTE — force_recreate
//                    (migration 078's Reopen fix) bypasses ONLY the "already
//                    has an id" guard, never the opt-out one. Previously
//                    both guards shared the same `!forceRecreate` condition,
//                    so a force_recreate row bypassed opt-out too — a real
//                    sequence (Reopen enqueues a force_recreate 'create',
//                    then before it drains the task opts out via a
//                    calendar-linked schedule) could still put an unwanted
//                    Google Task back.
//                    (b) The CREATE-side mirror of v10(a)'s edit-path
//                    ordering fix: saveTask's plain create, saveSchedule's
//                    timeBlock+"Also add to Tasks" branch, and saveSchedule's
//                    plain create+"Also add to Tasks" branch all pass
//                    skipGoogleTasks=willBeCalendarEvent to useCreateTask
//                    SPECULATIVELY, before the calendar link is attempted —
//                    if that link then fails, the task had NEITHER Google
//                    representation. All three now call the new
//                    reenableGoogleTasksIfCalendarFailed after the real,
//                    confirmed outcome is known, re-enabling google_sync_
//                    enabled (pushing the task to Google Tasks as a
//                    fallback) exactly when the bet didn't pay off.
//  2026-08-22 · v10 · Second post-review pass (correctness fixes only):
//                    (a) linkCalendarEvent/syncTaskSchedule now return
//                    whether the block ended up ACTUALLY calendar-linked.
//                    saveTask's edit branch no longer decides the Google
//                    Task dedupe (google_sync_enabled: false) before that
//                    outcome is known — deciding first meant useUpdateTask's
//                    synchronous outbox drain could delete the real Google
//                    Task moments before a failed calendar link, leaving
//                    the task with NEITHER Google representation. The
//                    dedupe is now a SEPARATE mutation, applied only after
//                    confirmation. needsGoogleTaskDedupe dropped its
//                    googleTaskId parameter (a pending, undrained 'create'
//                    has google_sync_enabled=true with google_task_id still
//                    NULL — requiring an id meant that pending create was
//                    never cancelled); shouldSkipPendingCreate (a new
//                    import-free pure module, googleTasksOutboxRules.ts) is
//                    the matching fix on the drain side, in both
//                    processCreate implementations.
//                    (b) blockSourceTypeForTask no longer maps task
//                    'tv_series' -> block 'tv_episode' — a context-free
//                    fallback can't back up episode-specificity it has no
//                    season/episode numbers for. ai-proxy's planMedia now
//                    stamps season_number/episode_number when the AI was
//                    given a specific episode (mirrors EpisodesPanel's own
//                    rule), so cleanup_block_on_episode_watched can match
//                    an AI-planned episode block at all.
//                    (c) saveSchedule's "Also add to Tasks" branch gained a
//                    shouldCreateLinkedTask defensive guard: never create a
//                    second task when the `timeBlock` passed in already has
//                    one (should be structurally unreachable, but this is
//                    what stops a caller bug from doing it silently) — the
//                    exact TrainingCalendar bug this pass found and fixed
//                    (it opened a task-linked plan block via `timeBlock`
//                    instead of `task`, so buildInitialForm seeded
//                    alsoCreateTask=true with no idea a task already
//                    existed, and Save minted a duplicate).
//  2026-08-22 · v9 · Post-review fixes on top of v8 (real runtime gaps, not
//                    architecture changes):
//                    (a) A standalone timeBlock's `gcal` wasn't seeded from
//                    its own google_calendar_event_id (planForm.ts) — saving
//                    an already-calendar-linked block unchanged silently
//                    unlinked its real Google Calendar event.
//                    (b) "One task = one Google entry" only held on CREATE.
//                    Editing an ALREADY Google-synced task into a
//                    calendar-linked schedule, and checking "Also add to
//                    Tasks" on an already-calendar-linked standalone block,
//                    both skipped the skipGoogleTasks dedupe — now fixed on
//                    both save paths.
//                    (c) When no `source` prop is passed (common — most
//                    editors don't have one), a NEW block/task created for
//                    an EXISTING task/timeBlock now falls back to that
//                    entity's own source_type/source_id (mapped through
//                    blockSourceTypeForTask/taskSourceTypeForBlock) instead
//                    of silently going source-less.
//                    (d) Save is now blocked (button disabled + a guard in
//                    handleSave) while a Task's linked block is still being
//                    fetched (linkedBlock === undefined) — saving mid-fetch
//                    used to make syncTaskSchedule think no block existed
//                    yet and CREATE a second one, instantly violating the
//                    at-most-one-per-task DB constraint.
//  2026-08-22 · v8 · Tasks/Schedule model fix (migration 077) — replaces the
//                    Task/Schedule TAB switcher entirely with explicit `mode`.
//                    Root causes fixed together:
//                    (a) time_blocks.source_type/source_id used to do two
//                    jobs — "linked to a Task" AND "which real entity this
//                    was planned from" — and creating a task+schedule
//                    together silently overwrote the real source with
//                    {source_type:'task', source_id:<task id>}, discarding
//                    it. time_blocks.task_id is now the ONLY "linked to a
//                    Task" representation (a real FK, ON DELETE CASCADE);
//                    source_type/source_id are passed through UNCHANGED
//                    alongside task_id now, never replaced.
//                    (b) tasks.due_date/due_time and time_blocks.date/
//                    start_time were kept bidirectionally equal by DB
//                    triggers (043/047) — "the deadline" and "when I'll
//                    actually do it" are different facts and are now fully
//                    independent; those triggers are dropped, not disabled.
//                    (c) Deleting/unscheduling a block no longer soft-
//                    cancels its Task (the old block_delete_cascades_task
//                    rule, retired) — Task survives, only the time slot
//                    goes. The one remaining cross-table effect is
//                    one-directional: Task hard-delete removes its linked
//                    block (the task_id FK), and a Task title edit mirrors
//                    onto its linked block's title (a DB trigger, so it
//                    fires from every write door — browser, AI, Google
//                    Tasks pull — not just this modal).
//                    (d) Recurring schedule_blocks gained a real edit path
//                    (RecurringTab + updateScheduleBlock) — there was no
//                    update API for them at all before this.
//                    The Task editor's "Add to schedule" section seeds from
//                    a task's linked block via a ref-guarded one-time async
//                    effect (never overwrites a user's own in-progress edit
//                    — see hydrateLinkedBlock below). Google Calendar's
//                    create/update/unlink lifecycle now also fires on
//                    title/duration changes, not just date/time (see
//                    scheduleApi.ts's updateTimeBlock).
//  2026-07-31 · v6 · Task windows + two save-path fixes.
//                    (a) `startDate` joins PlanForm/PlanDefaults/TaskField and is
//                    written to tasks.start_date on BOTH save paths — a task can
//                    now say "do it between A and B", where due_date stays the
//                    SOLE deadline (nothing else in the app learns a new concept).
//                    The Task tab renders it as a window control (TaskWindowField,
//                    season chips reusing shared/components/windowChips' math), not
//                    a second bare date box. This could not live in `taskExtra`:
//                    that prop is React.ReactNode with no access to form/patch or
//                    the save payload. Pre-migration-safe — tasksApi retries the
//                    write without start_date on 42703/PGRST204, and create omits
//                    the key entirely when unset.
//                    (b) The create path dropped the Notes textarea silently
//                    (CreateTaskInput had no `description` until now) — a task
//                    created with notes saved them nowhere while edit persisted
//                    them. Now passed on create too.
//                    (c) TaskTab's SECTIONS lost 'tomorrow' and 'this_week': they
//                    have no home of their own in the UI, so choosing one only
//                    made the task float like Backlog under a date-shaped name.
//                    The TaskSection TYPE and planForm's 'today' default are
//                    UNCHANGED — four server-side predicates filter on
//                    section.eq.today (phone-gateway ×2, push-send, ai-proxy) and
//                    legacy rows still hold both retired values.
//  2026-07-04 · v5 · New `timeBlock` prop: Schedule-tab edit mode for a plain
//                    time_block with no linked task (e.g. a planned training
//                    session). saveSchedule updates that row in place instead
//                    of creating a new one; Delete removes it. Lets callers
//                    like NextSessionBanner/TrainingCalendar make ANY planned
//                    session clickable+editable, not just task-linked ones.
//  2026-06-30 · v4 · Task tab redesign: grouped layout (Section+Priority side
//                    by side, "When" divider above Due Date/Time, Notes moved
//                    after), 24h Time24Field for Due Time, explicit "+ Set a
//                    time" / clear affordance instead of always showing a time
//                    value — makes the auto-schedule trigger (date AND time
//                    both set) visible to the user instead of implicit.
//  2026-06-30 · v1 · Created. Merges legacy PlanModal + AddTimeBlockModal +
//                    AddTaskModal into one config-driven modal. Recurrence is now
//                    functional (one-off time block vs recurring schedule block).
//  2026-06-30 · v3 · Task↔schedule consistency: a personal task earns an auto
//                    schedule block ONLY when it has BOTH a due date and a due
//                    time (kills the 17:00 pile-up). Edit/create now sync the
//                    linked block (update/create/delete via syncTaskBlock);
//                    delete is handled in deleteTask. due_time is persisted on
//                    create so the round-trip is stable.
//  2026-06-30 · v2 · Media feedback: default start time = next half-hour slot
//                    (planForm/nextPlanTime); 24h-only time field (Time24Field,
//                    no AM/PM). Cross-table consistency: when "also create task"
//                    is on, task is created FIRST and the time block links to it
//                    (source_type='task') — fixes time_blocks_source_type_check
//                    violation from passing 'media'. Callers now pass a VALID
//                    time_blocks source_type for the no-task path.
//                    [Superseded by v8 — a linked block's table link is task_id
//                    now, never source_type='task'.]
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Trash2 } from 'lucide-react'
import { toast, useCalendarStore } from '../../../app/store'
import {
  useCreateTimeBlock, useCreateScheduleBlock, useUpdateTimeBlock, useDeleteTimeBlock, useRemoveSlotOnSave,
  useUpdateScheduleBlock, useDeleteScheduleBlock, linkedTimeBlockQuery,
} from '../../../features/daily/hooks/useSchedule'
import { fetchTimeBlocks, fetchScheduleBlocks } from '../../../features/daily/api/scheduleApi'
import { findPlanTwin, planTwinMessage } from '../../../features/training/plan/planTwins'
import { qk } from '../../query'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../../../features/todo/hooks/useTodos'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'
import { resolveOrCreateGoogleTaskListId } from '../../../features/todo/api/googleTasksSync'
import { linkBlockCalendarEvent } from '../../../features/calendar/api/linkBlockCalendarEvent'
import { ensureValidCalendarToken } from '../../../features/calendar/api/calendarTokenSync'
import { logError } from '../../utils/logError'
import { withProgress } from '../../hooks/useMutationWithFeedback'
import { invalidate } from '../../query'
import { ModalShell } from '../../modals/ModalShell'
import { entityModal } from '../../modals/useEntityModal'
import { Button, Skeleton } from '../../ui'
import { ScheduleTab } from './ScheduleTab'
import { TaskTab } from './TaskTab'
import { RecurringTab } from './RecurringTab'
import { buildInitialForm } from './planForm'
import {
  endTimeFrom, sectionForDate, repeatRowFromForm, repeatStart, recurrenceProblem, editedRepeatStart, repeatAnchorOfRow,
  blockSourceTypeForTask, taskSourceTypeForBlock, needsGoogleTaskDedupe, shouldCreateLinkedTask,
  needsGoogleTasksFallback, clampDurationMinutes,
} from './planModal.config'
import type { PlanForm } from './planForm'
import type { PlanMode, UnifiedPlanModalProps, PlanModalConfig } from './planModal.types'
import type { TimeBlock } from '../../../features/daily/types'
import type { Task } from '../../../features/todo/types'
import type { TimeBlockCalendarStatus } from '../../../features/daily/api/scheduleSyncRules'

const MODE_HEADING: Record<PlanMode, { create: string; edit: string }> = {
  task:      { create: 'New task',     edit: 'Edit task' },
  schedule:  { create: 'Add to schedule', edit: 'Edit schedule' },
  recurring: { create: 'New repeating schedule', edit: 'Edit repeating schedule' },
}

export function UnifiedPlanModal({
  open, onClose, mode, config, defaults, source, task, timeBlock, scheduleBlock, scheduleExtra, taskExtra, onSaved,
  loading = false, loadError, onDeleteOverride,
}: UnifiedPlanModalProps) {
  // task / timeBlock / scheduleBlock presence always wins over an explicit
  // `mode` — a caller editing an existing row never needs to think about
  // mode, and an inconsistent pair (e.g. task set but mode='schedule') would
  // be a caller bug we'd rather resolve predictably than surface silently.
  const effectiveMode: PlanMode = task ? 'task' : scheduleBlock ? 'recurring' : timeBlock ? 'schedule' : (mode ?? 'task')
  const editMode   = !!task || !!timeBlock || !!scheduleBlock

  const [form,      setForm]      = useState<PlanForm>(() => buildInitialForm(defaults, task, timeBlock, scheduleBlock))
  const [saving,    setSaving]    = useState(false)
  // The task's linked one-off time_block, if any — fetched once per open via
  // hydrateLinkedBlock below. null = confirmed no linked block; undefined =
  // not fetched yet (mode='task', editMode only).
  const [linkedBlock, setLinkedBlock] = useState<TimeBlock | null | undefined>(() => (task ? undefined : null))

  const qc          = useQueryClient()
  const calToken    = useCalendarStore(s => s.accessToken)
  const createBlock = useCreateTimeBlock()
  const updateBlock = useUpdateTimeBlock({ report: false })
  const deleteBlock = useDeleteTimeBlock()
  const removeSlot  = useRemoveSlotOnSave()
  const createRecur = useCreateScheduleBlock()
  const updateRecur = useUpdateScheduleBlock()
  const deleteRecur = useDeleteScheduleBlock()
  // The editor reports the whole save ("Saved" / "Planned"), not each step.
  const createTask  = useCreateTask({ report: false })
  const updateTaskM = useUpdateTask({ report: false })
  const deleteTaskM = useDeleteTask()
  const { data: googleTaskLists = [] } = useGoogleTaskLists()

  // Re-seed whenever the modal (re)opens or its inputs change — adjusted
  // during render (not in an effect) so the stale form never paints. `seed`
  // is a fresh object per open/input change; the list hydration below keys
  // off its identity to run once per open.
  const [seed, setSeed] = useState(() => ({ open, task, timeBlock, scheduleBlock }))
  if (seed.open !== open || seed.task !== task || seed.timeBlock !== timeBlock || seed.scheduleBlock !== scheduleBlock) {
    setSeed({ open, task, timeBlock, scheduleBlock })
    if (open) {
      setForm(buildInitialForm(defaults, task, timeBlock, scheduleBlock))
      setLinkedBlock(task ? undefined : null)
    }
  }

  // Fetch a Task's linked one-off block, ONCE per open (a fresh server read
  // through the schedule hook layer's shared query options — never a cached
  // row), and correct the schedule sub-section's seeded guess to reality.
  // Guarded by a ref (not just `linkedBlock === undefined`, since that's also
  // the value while the fetch is in flight) so this never re-fires and
  // clobbers an edit the user made while it was loading — plan requirement:
  // "async fetch yüzünden kullanıcının editini sonradan overwrite eden
  // useEffect yazma." A failed read leaves `linkedBlock` undefined, which
  // keeps Save disabled: guessing "no block" could insert a second one.
  // Keyed on the task OBJECT: a re-seed (new task identity) re-hydrates too,
  // instead of leaving Save stuck on "Loading…" behind a spent guard.
  const hydratedForRef = useRef<Task | null>(null)
  useEffect(() => {
    if (!open || !task) { hydratedForRef.current = null; return }
    if (hydratedForRef.current === task) return
    let cancelled = false
    qc.fetchQuery(linkedTimeBlockQuery(task.id)).then(data => {
      if (cancelled || hydratedForRef.current === task) return
      hydratedForRef.current = task
      setLinkedBlock(data ?? null)
      if (data) {
        setForm(f => ({
          ...f,
          scheduled: true,
          date: data.date,
          startTime: data.start_time ? data.start_time.slice(0, 5) : f.startTime,
          duration: data.duration_minutes,
          category: data.category,
          gcal: !!data.google_calendar_event_id,
        }))
      }
    }, (err: Error) => {
      if (cancelled) return
      toast.error(`Couldn't load this task's schedule: ${err.message}`)
      logError(err.message, { action: 'load_linked_time_block', taskId: task.id })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task])

  // googleListTitle is seeded from the task's domain (a guess) synchronously
  // — correct it to the task's REAL current list title once the lists load,
  // ONCE per open (a later lists refetch never overwrites what was typed).
  const [listSeed, setListSeed] = useState<object | null>(null)
  if (open && task?.google_tasklist_id && listSeed !== seed) {
    const list = googleTaskLists.find(l => l.id === task.google_tasklist_id)
    if (list) {
      setListSeed(seed)
      setForm(f => ({ ...f, googleListTitle: list.title }))
    }
  }

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))
  // Editing a repeating plan: its saved start and what it counts from.
  const savedRepeat = scheduleBlock
    ? { start: scheduleBlock.effective_from ?? form.date, anchor: repeatAnchorOfRow(scheduleBlock) }
    : undefined

  // A token that is still valid (refreshed when it has expired), never the
  // stored one as is — typing a new list name after an hour used to fail with 401.
  async function resolveGoogleListField(): Promise<string | undefined> {
    if (!calToken || !form.googleListTitle.trim()) return undefined
    try {
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('the Google connection needs signing in again (Settings → Subscriptions)')
      return await resolveOrCreateGoogleTaskListId(token, form.googleListTitle)
    } catch (err) {
      toast.error(`Couldn't set up "${form.googleListTitle.trim()}" on Google: ${(err as Error).message}`)
      return undefined
    }
  }

  // The CREATE-side mirror of the edit-path dedupe-ordering fix above: every
  // create path that makes a new task ALONGSIDE a schedule speculatively
  // passes skipGoogleTasks=willBeCalendarEvent to useCreateTask, betting the
  // calendar link will succeed. If it then doesn't, the task would be left
  // with NEITHER Google representation. Call this AFTER the real calendar
  // outcome is known — flipping google_sync_enabled back to true re-fires
  // migration 071's opt-in branch, pushing the task to Google Tasks as a
  // fallback instead of silently losing it there.
  async function reenableGoogleTasksIfCalendarFailed(taskId: string | undefined, skippedGoogleTasks: boolean, calendarStatus: TimeBlockCalendarStatus) {
    if (!taskId || !needsGoogleTasksFallback(skippedGoogleTasks, calendarStatus)) return
    await updateTaskM.mutateAsync({ id: taskId, patch: { google_sync_enabled: true } })
  }

  // ── Save: mode='task' — Task fields + at most one linked one-off block ────
  // Returns the block's REAL, confirmed calendarStatus after this call — the
  // caller (saveTask) needs this (not the mere intent `form.gcal`) before
  // it's safe to drop the task's Google Task representation; see
  // needsGoogleTaskDedupe's doc comment. Policy this enforces throughout:
  // 'linked' -> dedupe may proceed; 'not_linked' -> a create-time fallback
  // may proceed; 'unknown' -> NEITHER — never guess in either direction.
  async function syncTaskSchedule(taskId: string, existingBlock: TimeBlock | null): Promise<TimeBlockCalendarStatus> {
    const title = form.title.trim()
    if (!form.scheduled) {
      // "Unschedule": the time slot goes, the Task never does.
      if (existingBlock) await removeSlot.mutateAsync(existingBlock.id)
      return 'not_linked'
    }

    const effDuration  = clampDurationMinutes(form.customMin !== '' ? Number(form.customMin) || 60 : form.duration)
    const startTimeVal = `${form.startTime}:00`

    if (existingBlock) {
      // The real bug this closes: this call's OWN remote push can discover
      // (404) that the existing block's calendar event is gone — trust
      // ITS confirmed outcome, not the pre-call `existingBlock` snapshot,
      // when deciding what's actually linked right now.
      const syncResult = await updateBlock.mutateAsync({ id: existingBlock.id, patch: {
        date: form.date, start_time: startTimeVal, duration_minutes: effDuration,
        title, category: form.category,
      } })
      if (form.gcal && calToken && syncResult.calendarStatus === 'not_linked') {
        // Never linked, or just confirmed gone (404 — cleared above) —
        // nothing there right now, safe to (re)create one.
        return await linkBlockCalendarEvent(existingBlock.id, form.date, form.startTime, effDuration, title)
      }
      if (!form.gcal && calToken && existingBlock.google_calendar_event_id) {
        const unlinkResult = await updateBlock.mutateAsync({ id: existingBlock.id, patch: { google_calendar_event_id: null } })
        return unlinkResult.calendarStatus
      }
      // form.gcal && calToken && syncResult.calendarStatus === 'unknown' falls
      // through to here too: never attempt another remote call on an
      // unconfirmed failure, and never report anything but the real status.
      return form.gcal ? syncResult.calendarStatus : 'not_linked'
    }

    // The originating entity's source_type/source_id (movie/training_session/
    // project_item/tv_episode) travels alongside task_id, never replaced by
    // it — the real bug this migration fixes. When the caller passed no
    // `source` at all (common for a plain To-Do being scheduled for the
    // first time, e.g. from ToDoItem's edit modal) fall back to the
    // EXISTING task's own source_type/source_id — an editor with no
    // explicit source prop must not silently drop a real origin the task
    // already carries (e.g. a project_item task gaining a schedule).
    const episodeFields = source?.episodeInfo
      ? { season_number: source.episodeInfo.seasonNumber, episode_number: source.episodeInfo.episodeNumber }
      : {}
    const block = await createBlock.mutateAsync({
      date: form.date, title, start_time: startTimeVal, duration_minutes: effDuration,
      category: form.category, color: 'accent', task_id: taskId,
      source_type: source?.sourceType ?? blockSourceTypeForTask(task?.source_type),
      source_id:   source?.sourceId   ?? task?.source_id ?? undefined,
      ...episodeFields,
    })
    if (form.gcal && calToken) {
      return await linkBlockCalendarEvent(block.id, form.date, form.startTime, effDuration, title)
    }
    return 'not_linked'
  }

  async function saveTask() {
    const title = form.title.trim()
    const googleTasklistId = await resolveGoogleListField()

    if (editMode && task) {
      // Content fields ONLY here — google_sync_enabled is deliberately NOT
      // touched yet. "One task = ONE Google entry" has to hold when an
      // ALREADY google_sync_enabled task later gains a calendar-linked
      // schedule on an EDIT, but opting OUT before the calendar event is
      // actually confirmed linked would be a real data-loss ordering bug:
      // useUpdateTask drains the outbox (and would delete the Google Task)
      // IMMEDIATELY on this mutation resolving, while syncTaskSchedule (and
      // its own linkCalendarEvent call) only runs AFTER — a failed calendar
      // link would then leave the task with NEITHER Google representation.
      await updateTaskM.mutateAsync({
        id: task.id,
        patch: {
          title,
          description: form.notes.trim() || null,
          section:     form.section,
          priority:    form.priority,
          domain:      form.domain,
          ...(form.startDate || task.start_date ? { start_date: form.startDate || null } : {}),
          due_date:    form.dueDate || null,
          due_time:    form.dueTime ? `${form.dueTime}:00` : null,
          ...(googleTasklistId !== undefined ? { google_tasklist_id: googleTasklistId } : {}),
        },
      })
      // Snapshot BEFORE syncTaskSchedule runs — needed below to detect the
      // REVERSE transition (was calendar-linked, this edit just removed
      // that link) as distinct from "was never linked at all".
      const wasCalendarLinked = !!linkedBlock?.google_calendar_event_id
      const calendarStatus = await syncTaskSchedule(task.id, linkedBlock ?? null)
      // Only NOW — with the calendar link outcome actually known — decide
      // whether to drop the now-redundant Google Task. A second, separate
      // mutation on purpose: bundling it into the update above would have
      // meant deciding before the outcome existed.
      if (needsGoogleTaskDedupe(calendarStatus, task.google_sync_enabled)) {
        await updateTaskM.mutateAsync({ id: task.id, patch: { google_sync_enabled: false } })
      } else if (!task.google_sync_enabled && needsGoogleTasksFallback(wasCalendarLinked, calendarStatus)) {
        // The mirror of the block above, for the OPPOSITE transition: this
        // task was calendar-linked (so Google Tasks sync was suppressed by
        // the dedupe path on an earlier save) and THIS edit just confirmed
        // there's no calendar link any more (unscheduled, or GCal turned
        // off) — with google_sync_enabled already false, the task would be
        // left with NEITHER Google representation. Real gap this closes:
        // only the "gained a calendar link" direction re-fired the opt-out
        // trigger; "lost the calendar link" never re-fired the opt-in one.
        await updateTaskM.mutateAsync({ id: task.id, patch: { google_sync_enabled: true } })
      }
      onSaved?.({ mode: 'task', taskId: task.id })
      return
    }

    // A scheduled task with a linked Google Calendar event suppresses the
    // duplicate Google Task (one task, one Google entry) — same policy as
    // before, now keyed off `scheduled` + `gcal` instead of domain==='personal'.
    const willBeCalendarEvent = form.scheduled && form.gcal && !!calToken
    const { task: created } = await createTask.mutateAsync({
      title,
      description: form.notes.trim() || null,
      section:     form.section,
      priority:    form.priority,
      domain:      form.domain,
      start_date:  form.startDate || undefined,
      due_date:    form.dueDate || null,
      due_time:    form.dueTime ? `${form.dueTime}:00` : null,
      source_type: source?.taskSourceType,
      source_id:   source?.sourceId,
      google_tasklist_id: googleTasklistId,
      skipGoogleTasks: willBeCalendarEvent,
    })
    const calendarStatus = await syncTaskSchedule(created.id, null)
    // The mirror of the edit-path fix above: if the calendar link this task
    // was created betting on didn't actually happen, push it to Google
    // Tasks after all rather than leaving it with no Google presence at all.
    await reenableGoogleTasksIfCalendarFailed(created.id, willBeCalendarEvent, calendarStatus)
    onSaved?.({ mode: 'task', taskId: created.id })
  }

  // ── Save: mode='schedule' — a standalone one-off block (never task-linked;
  // a task-linked block is always edited via mode='task' instead — see
  // planModal.types.ts). "Also add to Tasks" is therefore unambiguous here:
  // it always means create-and-link, never a readout of an existing link.
  async function saveSchedule() {
    const title = form.title.trim()
    const effDuration = clampDurationMinutes(form.customMin !== '' ? Number(form.customMin) || 60 : form.duration)
    const startTimeVal = `${form.startTime}:00`

    if (timeBlock) {
      let linkedTaskId: string | undefined
      let skippedGoogleTasksForLinkedTask = false
      // Defensive: `timeBlock` is contractually a STANDALONE block (never
      // task-linked — planModal.types.ts's own comment on the prop), so
      // shouldCreateLinkedTask should be structurally impossible to return
      // true here for an already-linked block already. Guarding on the
      // real column anyway means a caller bug (passing an already
      // task-linked block through `timeBlock` instead of `task` — the
      // exact TrainingCalendar bug this migration's review caught) can
      // never silently mint a SECOND task and re-point this block at it —
      // it just does nothing instead.
      if (shouldCreateLinkedTask(form.alsoCreateTask, timeBlock.task_id)) {
        // This block IS (or, per the checkbox below, is about to become) a
        // Google Calendar event whenever form.gcal is on — "one task = one
        // Google entry" means the new Task must not ALSO become a Google
        // Task in that case (the exact policy useCreateTask's skipGoogleTasks
        // already exists for on every other create path; this branch was the
        // one place that forgot to pass it).
        const willBeCalendarEvent = form.gcal && !!calToken
        const { task: created } = await createTask.mutateAsync({
          title, section: sectionForDate(form.date), domain: defaults?.domain ?? 'personal',
          priority: defaults?.priority ?? 'medium', due_date: form.date,
          // No explicit `source` on this call site (common — e.g. a
          // Training/Media block that predates this edit) falls back to the
          // BLOCK's own real origin rather than creating a source-less Task.
          source_type: source?.taskSourceType ?? taskSourceTypeForBlock(timeBlock.source_type),
          source_id:   source?.sourceId       ?? timeBlock.source_id ?? undefined,
          skipGoogleTasks: willBeCalendarEvent,
        })
        linkedTaskId = created.id
        skippedGoogleTasksForLinkedTask = willBeCalendarEvent
      }
      // Same fix as syncTaskSchedule above: trust THIS call's own confirmed
      // outcome, not the pre-call `timeBlock` snapshot — a 404 discovered
      // here must not read as "still linked".
      const syncResult = await updateBlock.mutateAsync({ id: timeBlock.id, patch: {
        date: form.date, start_time: startTimeVal, duration_minutes: effDuration,
        title, category: form.category,
        ...(linkedTaskId ? { task_id: linkedTaskId } : {}),
      } })
      let calendarStatus: TimeBlockCalendarStatus = syncResult.calendarStatus
      if (form.gcal && calToken && syncResult.calendarStatus === 'not_linked') {
        calendarStatus = await linkBlockCalendarEvent(timeBlock.id, form.date, form.startTime, effDuration, title)
      } else if (!form.gcal && calToken && timeBlock.google_calendar_event_id) {
        const unlinkResult = await updateBlock.mutateAsync({ id: timeBlock.id, patch: { google_calendar_event_id: null } })
        calendarStatus = unlinkResult.calendarStatus
      } else if (!form.gcal) {
        calendarStatus = 'not_linked'
      }
      // form.gcal && calToken && syncResult.calendarStatus === 'unknown' falls
      // through unchanged: never attempt another remote call, never claim
      // anything but the real, unconfirmed status.
      await reenableGoogleTasksIfCalendarFailed(linkedTaskId, skippedGoogleTasksForLinkedTask, calendarStatus)
      onSaved?.({ mode: 'schedule', taskId: linkedTaskId, timeBlockCreated: false })
      return
    }

    // CREATE — recurrence decides the target table, exactly like before;
    // "also create task" only applies to the one-off path (there is no
    // recurring-Task concept in this app).
    if (form.recurrence !== 'none') {
      const repeat = repeatRowFromForm(form)
      // "Add to Google Calendar" makes the repeat ONE repeating event (147).
      await createRecur.mutateAsync({ input: {
        title, ...repeat, effective_from: repeatStart(repeat, form.date),
        start_time: startTimeVal, end_time: endTimeFrom(form.startTime, effDuration),
        color: defaults?.color ?? 'blue', category: form.category,
      }, gcal: calToken ? form.gcal : undefined })
      onSaved?.({ mode: 'schedule', recurringCreated: true })
      return
    }

    let linkedTaskId: string | undefined
    let skippedGoogleTasksForLinkedTask = false
    if (form.alsoCreateTask) {
      const taskDomain = defaults?.domain
        ?? (form.category === 'work' ? 'work' : form.category === 'media' ? 'media' : 'personal')
      const willBeCalendarEvent = form.gcal && !!calToken
      const { task: created } = await createTask.mutateAsync({
        title, section: sectionForDate(form.date), domain: taskDomain,
        priority: defaults?.priority ?? 'medium', due_date: form.date,
        source_type: source?.taskSourceType, source_id: source?.sourceId,
        skipGoogleTasks: willBeCalendarEvent,
      })
      linkedTaskId = created.id
      skippedGoogleTasksForLinkedTask = willBeCalendarEvent
    }

    const episodeFields = source?.episodeInfo
      ? { season_number: source.episodeInfo.seasonNumber, episode_number: source.episodeInfo.episodeNumber }
      : {}
    const block = await createBlock.mutateAsync({
      date: form.date, title, start_time: startTimeVal, duration_minutes: effDuration,
      color: defaults?.color, category: form.category,
      task_id: linkedTaskId,
      source_type: source?.sourceType, source_id: source?.sourceId,
      ...episodeFields,
    })
    let calendarStatus: TimeBlockCalendarStatus = 'not_linked'
    if (form.gcal && calToken) {
      calendarStatus = await linkBlockCalendarEvent(block.id, form.date, form.startTime, effDuration, title)
    }
    await reenableGoogleTasksIfCalendarFailed(linkedTaskId, skippedGoogleTasksForLinkedTask, calendarStatus)
    onSaved?.({ mode: 'schedule', taskId: linkedTaskId, timeBlockCreated: true })
  }

  // ── Save: mode='recurring' — schedule_blocks, no linked Task. Its Google
  // Calendar series (147) follows "Add to Google Calendar" through the save
  // hooks: ticked → added / brought up to date, unticked → removed. With no
  // Google connection (`gcal` undefined) the link is left as it is.
  async function saveRecurring() {
    const title = form.title.trim()
    const effDuration = clampDurationMinutes(form.customMin !== '' ? Number(form.customMin) || 60 : form.duration)
    const startTimeVal = `${form.startTime}:00`
    // A recurring template is never "no repeat" — RecurringTab never offers
    // picking 'none' (RECURRING_EDIT_OPTIONS), and repeatFormFromRow (which
    // seeds this form when editing an existing row) never returns it either.
    // handleSave's recurrenceProblem guard protects against an incomplete
    // selection.
    const repeat = repeatRowFromForm(form)

    const gcal = calToken ? form.gcal : undefined
    if (scheduleBlock) {
      // A choice that counts from its start (Monthly, every N…) saves the
      // "Starts" shown; any other keeps the saved start (editedRepeatStart).
      const start = scheduleBlock.effective_from
      const next = editedRepeatStart(form, repeat, start)
      await updateRecur.mutateAsync({ id: scheduleBlock.id, gcal, patch: {
        title, ...repeat, start_time: startTimeVal,
        end_time: endTimeFrom(form.startTime, effDuration), category: form.category,
        ...(next && next !== start ? { effective_from: next } : {}),
      } })
      onSaved?.({ mode: 'recurring' })
      return
    }
    await createRecur.mutateAsync({ input: {
      title, ...repeat, effective_from: repeatStart(repeat, form.date), start_time: startTimeVal,
      end_time: endTimeFrom(form.startTime, effDuration), color: defaults?.color ?? 'blue', category: form.category,
    }, gcal })
    onSaved?.({ mode: 'recurring', recurringCreated: true })
  }

  // While editing a Task, `linkedBlock` starts `undefined` ("not fetched
  // yet") and only becomes `null`/a real block once hydrateLinkedBlock
  // resolves. Saving before that resolves would make syncTaskSchedule treat
  // an actually-linked block as "none" (existingBlock=null) — CREATING a
  // second block instead of updating the real one, immediately violating
  // the DB's own at-most-one-per-task constraint. Not just cosmetic: this
  // is the difference between "update in place" and "insert" in
  // syncTaskSchedule.
  const scheduleStillLoading = effectiveMode === 'task' && !!task && linkedBlock === undefined

  // An incomplete repeat (a weekly one with no day, every N weeks with no
  // day, an N out of range, no picked date) can't be saved. A weekly one with
  // zero days used to save anyway — Mon-Fri was silently substituted.
  // Applies to both surfaces that can carry a repeat.
  const recurrenceIssue = effectiveMode === 'recurring' || (effectiveMode === 'schedule' && !timeBlock)
    ? recurrenceProblem(form) : null
  const recurrenceIncomplete = recurrenceIssue != null

  // A training session planned on a day that already has it (the weekly ⟳
  // template, or the same routine planned once already) asks first — the
  // second copy used to save silently and every page then showed the session
  // twice (planTwins.ts). Moving a plan within its own day never asks.
  async function confirmNoTwin(): Promise<boolean> {
    const oneOff = form.category === 'training' && !!form.date
      && ((effectiveMode === 'task' && form.scheduled) || (effectiveMode === 'schedule' && (timeBlock || form.recurrence === 'none')))
    if (!oneOff) return true
    const existing = timeBlock ?? linkedBlock ?? null
    if (existing && existing.date === form.date) return true
    try {
      const [blocks, templates] = await Promise.all([
        qc.fetchQuery({ queryKey: qk.schedule.day(form.date), queryFn: () => fetchTimeBlocks(form.date), staleTime: 30_000 }),
        qc.fetchQuery({ queryKey: qk.schedule.templates(), queryFn: fetchScheduleBlocks, staleTime: 30_000 }),
      ])
      const routineId = source?.sourceType === 'training_session' ? source.sourceId ?? null
        : existing?.source_type === 'training_session' ? existing.source_id ?? null : null
      const twin = findPlanTwin({
        date: form.date, title: form.title.trim(), routineId, excludeBlockId: existing?.id ?? null,
        blocks, templates: templates.filter(t => t.category === 'training'),
      })
      if (!twin) return true
      return await entityModal.confirm({
        title: 'Plan this session twice?',
        message: `${planTwinMessage(twin)} Keep the one you have, or add a second session that day anyway.`,
        confirmLabel: 'Add anyway',
        cancelLabel: 'Keep one',
      })
    } catch {
      // The check is a guard, not a gate: a failed read never blocks saving.
      return true
    }
  }

  // Every write inside the save paths goes through a useMutationWithFeedback
  // hook, which already toasts + logs its own failure; a throw here only
  // means "stop the multi-step flow", never "toast again".
  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (scheduleStillLoading) { toast.error('Still loading this task’s schedule — try again in a moment'); return }
    if (recurrenceIssue) { toast.error(recurrenceIssue); return }
    if (!(await confirmNoTwin())) return
    setSaving(true)
    const ok = await withProgress(async () => {
      if (effectiveMode === 'task')            await saveTask()
      else if (effectiveMode === 'schedule')   await saveSchedule()
      else                                     await saveRecurring()
      return true
    }, { loading: editMode ? 'Saving…' : 'Planning…', success: editMode ? 'Saved' : 'Planned' })
    setSaving(false)
    // Also covers the calendar-link writes, which bypass the hooks on purpose
    // (see linkCalendarEvent) — refresh on failure too: an earlier step may
    // already have landed.
    void invalidate(qc, 'taskGraph')
    if (ok) onClose()
  }

  async function handleDelete() {
    if (onDeleteOverride) {
      if (await onDeleteOverride()) onClose()
      return
    }
    const title = form.title.trim() || task?.title || timeBlock?.title || scheduleBlock?.title || ''
    // The question is the flow's own popup: no "Saving…" while it asks;
    // the delete hooks' `busy` covers the write itself (`working`).
    const result = task
      ? await deleteTaskM.run([task.id], { title: 'Delete this task?', message: title, confirmLabel: 'Delete task', done: 'Task deleted' })
      : scheduleBlock
        ? await deleteRecur.run([scheduleBlock.id], {
          title: 'Delete this repeating schedule?', message: title, done: 'Repeating plan deleted' })
        : timeBlock
          ? await deleteBlock.run([timeBlock.id], { title: 'Delete this schedule?', message: title, done: 'Slot deleted' })
          : 'kept'
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const working = saving || deleteTaskM.busy || deleteRecur.busy || deleteBlock.busy
  const primaryLabel = saving
    ? (editMode ? 'Saving…' : 'Planning…')
    : (editMode ? 'Save changes' : (effectiveMode === 'task' ? 'Add task' : effectiveMode === 'recurring' ? 'Save repeat' : 'Plan it'))

  // Editing an existing one-off block never offers recurrence (no silent
  // one-off <-> recurring conversion — a real, separate storage-migration UX
  // this refactor deliberately does not build) — merged with whatever the
  // caller already hides so neither side has to know about the other.
  const effectiveScheduleConfig: PlanModalConfig | undefined = effectiveMode === 'schedule' && !!timeBlock
    ? { ...config, hideScheduleFields: [...(config?.hideScheduleFields ?? []), 'recurrence'] }
    : config

  // A row still loading by id (or failed to) is an edit, not a create.
  const blocked = loading || !!loadError
  const heading = config?.heading ?? MODE_HEADING[effectiveMode][editMode || blocked ? 'edit' : 'create']

  const deleteLabel = task ? 'Delete task' : scheduleBlock ? 'Delete repeating schedule' : 'Delete schedule'
  const footer = (
    // One row on every width: on a phone Delete is an icon (it used to take a
    // second full row under Cancel / Save).
    <div className="flex items-center gap-2">
      {editMode && !blocked && (
        <Button
          variant="ghost" icon={<Trash2 />} onClick={() => { void handleDelete() }} disabled={working}
          aria-label={deleteLabel}
          className="shrink-0 text-danger hover:text-danger max-sm:px-3 sm:mr-auto"
        >
          <span className="max-sm:sr-only">{deleteLabel}</span>
        </Button>
      )}
      <div className="flex min-w-0 flex-1 gap-2 sm:ml-auto sm:flex-none">
        <Button onClick={onClose} disabled={working} className="flex-1 sm:flex-none">Cancel</Button>
        {!loadError && (
          <Button
            variant="primary" onClick={() => { void handleSave() }} loading={saving}
            disabled={blocked || !form.title.trim() || scheduleStillLoading || recurrenceIncomplete}
            className="flex-1 sm:flex-none"
          >{blocked || scheduleStillLoading ? 'Loading…' : primaryLabel}</Button>
        )}
      </div>
    </div>
  )

  return (
    <ModalShell open={open} onClose={onClose} title={heading} footer={footer} size="md" dismissible={!working}>
      {loadError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <AlertCircle className="h-6 w-6 text-danger" aria-hidden />
          <p className="text-body text-fg-2">{loadError.message}</p>
          {loadError.onRetry && <Button size="sm" onClick={loadError.onRetry}>Try again</Button>}
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-16 w-full" rounded="rounded-input" />
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" rounded="rounded-full" />
            <Skeleton className="h-9 w-20" rounded="rounded-full" />
            <Skeleton className="h-9 w-20" rounded="rounded-full" />
          </div>
          <Skeleton className="h-11 w-full" rounded="rounded-input" />
        </div>
      ) : (
        <>
          {effectiveMode === 'task' && (
            <TaskTab
              form={form} patch={patch} config={config} gcalAvailable={!!calToken} editMode={editMode}
              calendarLinked={!!linkedBlock?.google_calendar_event_id} extra={taskExtra}
            />
          )}
          {effectiveMode === 'schedule' && (
            <ScheduleTab form={form} patch={patch} config={effectiveScheduleConfig} gcalAvailable={!!calToken} extra={scheduleExtra} />
          )}
          {effectiveMode === 'recurring' && (
            <RecurringTab
              form={form} patch={patch} creating={!scheduleBlock} saved={savedRepeat} exceptDates={scheduleBlock?.except_dates}
              gcalAvailable={!!calToken} calendarLinked={!!scheduleBlock?.google_calendar_event_id} extra={scheduleExtra}
            />
          )}
        </>
      )}
    </ModalShell>
  )
}
