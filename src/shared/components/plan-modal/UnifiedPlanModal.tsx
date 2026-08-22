// ═════════════════════════════════════════════════════════════════════════════
//  UnifiedPlanModal — the single planning surface for the whole app.
//
//  ┌─ RULES (read before editing) ─────────────────────────────────────────────┐
//  │ 1. ALWAYS ON TOP. Each open instance claims the next z-index above every    │
//  │    other modal (see useTopZIndex). Never hardcode a z-class on the Dialog.  │
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
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast, useCalendarStore } from '../../../app/store'
import { useCreateTimeBlock, useCreateScheduleBlock } from '../../../features/daily/hooks/useSchedule'
import { updateTimeBlock, deleteTimeBlock, updateScheduleBlock, deleteScheduleBlock } from '../../../features/daily/api/scheduleApi'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../../../features/todo/hooks/useTodos'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'
import { resolveOrCreateGoogleTaskListId } from '../../../features/todo/api/googleTasksSync'
import { createCalendarEvent } from '../../../features/calendar/api/calendarApi'
import { logError } from '../../utils/logError'
import { supabase } from '../../../integrations/supabase/client'
import { ScheduleTab } from './ScheduleTab'
import { TaskTab } from './TaskTab'
import { RecurringTab } from './RecurringTab'
import { buildInitialForm } from './planForm'
import {
  daysForRecurrence, endTimeFrom, sectionForDate, LOCAL_TZ,
  blockSourceTypeForTask, taskSourceTypeForBlock, needsGoogleTaskDedupe, shouldCreateLinkedTask,
  needsGoogleTasksFallback,
} from './planModal.config'
import type { PlanForm } from './planForm'
import type { PlanMode, UnifiedPlanModalProps, PlanModalConfig } from './planModal.types'
import type { TimeBlock } from '../../../features/daily/types'

// ── z-index stacking — newest open modal always wins ──────────────────────────
let zCursor = 1000
function useTopZIndex(open: boolean): number {
  const [z, setZ] = useState(1000)
  useEffect(() => {
    if (open) { zCursor += 10; setZ(zCursor) }
  }, [open])
  return z
}

const MODE_HEADING: Record<PlanMode, { create: string; edit: string }> = {
  task:      { create: 'New Task',     edit: 'Edit Task' },
  schedule:  { create: 'Add to schedule', edit: 'Edit schedule' },
  recurring: { create: 'New repeating schedule', edit: 'Edit repeating schedule' },
}

export function UnifiedPlanModal({
  open, onClose, mode, config, defaults, source, task, timeBlock, scheduleBlock, scheduleExtra, taskExtra, onSaved,
}: UnifiedPlanModalProps) {
  // task / timeBlock / scheduleBlock presence always wins over an explicit
  // `mode` — a caller editing an existing row never needs to think about
  // mode, and an inconsistent pair (e.g. task set but mode='schedule') would
  // be a caller bug we'd rather resolve predictably than surface silently.
  const effectiveMode: PlanMode = task ? 'task' : scheduleBlock ? 'recurring' : timeBlock ? 'schedule' : (mode ?? 'task')
  const editMode   = !!task || !!timeBlock || !!scheduleBlock
  const zIndex     = useTopZIndex(open)

  const [form,      setForm]      = useState<PlanForm>(() => buildInitialForm(defaults, task, timeBlock, scheduleBlock))
  const [saving,    setSaving]    = useState(false)
  // The task's linked one-off time_block, if any — fetched once per open via
  // hydrateLinkedBlock below. null = confirmed no linked block; undefined =
  // not fetched yet (mode='task', editMode only).
  const [linkedBlock, setLinkedBlock] = useState<TimeBlock | null | undefined>(undefined)

  const qc          = useQueryClient()
  const calToken    = useCalendarStore(s => s.accessToken)
  const createBlock = useCreateTimeBlock()
  const createRecur = useCreateScheduleBlock()
  const createTask  = useCreateTask()
  const updateTaskM = useUpdateTask()
  const deleteTaskM = useDeleteTask()
  const { data: googleTaskLists = [] } = useGoogleTaskLists()

  // Re-seed whenever the modal (re)opens or its inputs change.
  useEffect(() => {
    if (!open) return
    setForm(buildInitialForm(defaults, task, timeBlock, scheduleBlock))
    setLinkedBlock(task ? undefined : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, timeBlock, scheduleBlock])

  // Fetch a Task's linked one-off block, ONCE per open, and correct the
  // schedule sub-section's seeded guess to reality. Guarded by a ref (not
  // just `linkedBlock === undefined`, since that's also the value while the
  // fetch is in flight) so this never re-fires and clobbers an edit the user
  // made while it was loading — plan requirement: "async fetch yüzünden
  // kullanıcının editini sonradan overwrite eden useEffect yazma."
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!open || !task) { hydratedRef.current = false; return }
    if (hydratedRef.current) return
    let cancelled = false
    supabase.from('time_blocks').select('*').eq('task_id', task.id).maybeSingle().then(({ data }) => {
      if (cancelled || hydratedRef.current) return
      hydratedRef.current = true
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
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task])

  // googleListTitle is seeded from the task's domain (a guess) synchronously
  // — correct it to the task's REAL current list title once the lists load,
  // same one-time-hydration shape as the schedule fetch above.
  useEffect(() => {
    if (!open || !task?.google_tasklist_id) return
    const list = googleTaskLists.find(l => l.id === task.google_tasklist_id)
    if (list) setForm(f => ({ ...f, googleListTitle: list.title }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, googleTaskLists])

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))

  // Create a Google Calendar event for a block and store the event id back on
  // the block, so it can be updated/deleted with the block later (prevents
  // orphaned/duplicate events). Idempotent BY CONSTRUCTION: it re-reads the
  // block first and NEVER creates a second event when one already exists — so
  // re-saving (e.g. edit → add-to-calendar) can't duplicate, regardless of what
  // the call site checked. Best-effort — never THROWS — but now returns
  // whether the block actually ended up calendar-linked, so a caller that's
  // about to drop the task's OTHER Google representation (its Google Task)
  // can wait for real confirmation instead of assuming success.
  async function linkCalendarEvent(blockId: string, dateStr: string, timeHHMM: string, durationMin: number, title: string): Promise<boolean> {
    if (!calToken) return false
    try {
      const { data: current } = await supabase
        .from('time_blocks').select('google_calendar_event_id').eq('id', blockId).single()
      if (current?.google_calendar_event_id) return true
      const start = new Date(`${dateStr}T${timeHHMM}:00`)
      const end   = new Date(start.getTime() + durationMin * 60_000)
      const created = await createCalendarEvent(calToken, 'primary', {
        summary: title,
        start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
        end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
      })
      await updateTimeBlock(blockId, { google_calendar_event_id: created.id })
      return true
    } catch (err) {
      // Was a hardcoded generic message with the real cause swallowed —
      // surfacing it (expired token, missing write scope, a malformed
      // date/time producing an Invalid Date before the request is even
      // sent, etc.) so a sync failure is actually diagnosable instead of
      // needing a code change every time to find out why.
      toast.error(`Planned locally, Google Calendar sync failed: ${(err as Error).message}`)
      logError((err as Error).message, { action: 'link_calendar_event' })
      return false
    }
  }

  async function resolveGoogleListField(): Promise<string | undefined> {
    if (!calToken || !form.googleListTitle.trim()) return undefined
    try {
      return await resolveOrCreateGoogleTaskListId(calToken, form.googleListTitle)
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
  async function reenableGoogleTasksIfCalendarFailed(taskId: string | undefined, skippedGoogleTasks: boolean, calendarLinked: boolean) {
    if (!taskId || !needsGoogleTasksFallback(skippedGoogleTasks, calendarLinked)) return
    await updateTaskM.mutateAsync({ id: taskId, patch: { google_sync_enabled: true } })
  }

  // ── Save: mode='task' — Task fields + at most one linked one-off block ────
  // Returns whether the linked block ends up ACTUALLY calendar-linked after
  // this call — the caller (saveTask) needs the real, confirmed outcome
  // (not the mere intent `form.gcal`) before it's safe to drop the task's
  // Google Task representation; see needsGoogleTaskDedupe's doc comment.
  async function syncTaskSchedule(taskId: string, existingBlock: TimeBlock | null): Promise<boolean> {
    const title = form.title.trim()
    if (!form.scheduled) {
      // "Unschedule": the time slot goes, the Task never does.
      if (existingBlock) await deleteTimeBlock(existingBlock.id)
      return false
    }

    const effDuration  = form.customMin !== '' ? Number(form.customMin) || 60 : form.duration
    const startTimeVal = `${form.startTime}:00`

    if (existingBlock) {
      // The real bug this closes: this call's OWN remote push can discover
      // (404) that the existing block's calendar event is gone — trust
      // ITS confirmed outcome, not the pre-call `existingBlock` snapshot,
      // when deciding what's actually linked right now.
      const syncResult = await updateTimeBlock(existingBlock.id, {
        date: form.date, start_time: startTimeVal, duration_minutes: effDuration,
        title, category: form.category,
      })
      if (form.gcal && calToken && syncResult.calendarStatus === 'not_linked') {
        // Never linked, or just confirmed gone (404 — cleared above) —
        // nothing there right now, safe to (re)create one.
        return await linkCalendarEvent(existingBlock.id, form.date, form.startTime, effDuration, title)
      }
      if (form.gcal && calToken && syncResult.calendarStatus === 'unknown') {
        // The push above failed WITHOUT confirming the event is gone
        // (network, rate limit, …) — the event is presumably still fine,
        // but we don't know for sure, and either way this must NEVER be
        // the reason the task's Google Task gets deleted. Report
        // "not safely confirmed linked" and take no further action —
        // never attempt another remote call on an unconfirmed failure.
        return false
      }
      if (!form.gcal && calToken && existingBlock.google_calendar_event_id) {
        await updateTimeBlock(existingBlock.id, { google_calendar_event_id: null })
        return false
      }
      return form.gcal && syncResult.calendarStatus === 'linked'
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
      return await linkCalendarEvent(block.id, form.date, form.startTime, effDuration, title)
    }
    return false
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
      const nowCalendarLinked = await syncTaskSchedule(task.id, linkedBlock ?? null)
      // Only NOW — with the calendar link outcome actually known — decide
      // whether to drop the now-redundant Google Task. A second, separate
      // mutation on purpose: bundling it into the update above would have
      // meant deciding before the outcome existed.
      if (needsGoogleTaskDedupe(nowCalendarLinked, task.google_sync_enabled)) {
        await updateTaskM.mutateAsync({ id: task.id, patch: { google_sync_enabled: false } })
      }
      onSaved?.({ mode: 'task', taskId: task.id })
      return
    }

    // A scheduled task with a linked Google Calendar event suppresses the
    // duplicate Google Task (one task, one Google entry) — same policy as
    // before, now keyed off `scheduled` + `gcal` instead of domain==='personal'.
    const willBeCalendarEvent = form.scheduled && form.gcal && !!calToken
    const { task: created, googleTaskError } = await createTask.mutateAsync({
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
    if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)
    const nowCalendarLinked = await syncTaskSchedule(created.id, null)
    // The mirror of the edit-path fix above: if the calendar link this task
    // was created betting on didn't actually happen, push it to Google
    // Tasks after all rather than leaving it with no Google presence at all.
    await reenableGoogleTasksIfCalendarFailed(created.id, willBeCalendarEvent, nowCalendarLinked)
    onSaved?.({ mode: 'task', taskId: created.id })
  }

  // ── Save: mode='schedule' — a standalone one-off block (never task-linked;
  // a task-linked block is always edited via mode='task' instead — see
  // planModal.types.ts). "Also add to Tasks" is therefore unambiguous here:
  // it always means create-and-link, never a readout of an existing link.
  async function saveSchedule() {
    const title = form.title.trim()
    const effDuration = form.customMin !== '' ? Number(form.customMin) || 60 : form.duration
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
        const { task: created, googleTaskError } = await createTask.mutateAsync({
          title, section: sectionForDate(form.date), domain: defaults?.domain ?? 'personal',
          priority: defaults?.priority ?? 'medium', due_date: form.date,
          // No explicit `source` on this call site (common — e.g. a
          // Training/Media block that predates this edit) falls back to the
          // BLOCK's own real origin rather than creating a source-less Task.
          source_type: source?.taskSourceType ?? taskSourceTypeForBlock(timeBlock.source_type),
          source_id:   source?.sourceId       ?? timeBlock.source_id ?? undefined,
          skipGoogleTasks: willBeCalendarEvent,
        })
        if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)
        linkedTaskId = created.id
        skippedGoogleTasksForLinkedTask = willBeCalendarEvent
      }
      // Same fix as syncTaskSchedule above: trust THIS call's own confirmed
      // outcome, not the pre-call `timeBlock` snapshot — a 404 discovered
      // here must not read as "still linked".
      const syncResult = await updateTimeBlock(timeBlock.id, {
        date: form.date, start_time: startTimeVal, duration_minutes: effDuration,
        title, category: form.category,
        ...(linkedTaskId ? { task_id: linkedTaskId } : {}),
      })
      let calendarLinked = syncResult.calendarStatus === 'linked'
      if (form.gcal && calToken && syncResult.calendarStatus === 'not_linked') {
        calendarLinked = await linkCalendarEvent(timeBlock.id, form.date, form.startTime, effDuration, title)
      } else if (form.gcal && calToken && syncResult.calendarStatus === 'unknown') {
        // Unconfirmed failure — never treat as linked, but take no further
        // action (see updateTimeBlock's own doc comment for why).
        calendarLinked = false
      } else if (!form.gcal && calToken && timeBlock.google_calendar_event_id) {
        await updateTimeBlock(timeBlock.id, { google_calendar_event_id: null })
        calendarLinked = false
      }
      await reenableGoogleTasksIfCalendarFailed(linkedTaskId, skippedGoogleTasksForLinkedTask, calendarLinked)
      onSaved?.({ mode: 'schedule', taskId: linkedTaskId, timeBlockCreated: false })
      return
    }

    // CREATE — recurrence decides the target table, exactly like before;
    // "also create task" only applies to the one-off path (there is no
    // recurring-Task concept in this app).
    if (form.recurrence !== 'none') {
      await createRecur.mutateAsync({
        title, days_of_week: daysForRecurrence(form.recurrence, form.weeklyDays),
        start_time: startTimeVal, end_time: endTimeFrom(form.startTime, effDuration),
        color: defaults?.color ?? 'blue', category: form.category,
      })
      onSaved?.({ mode: 'schedule', recurringCreated: true })
      return
    }

    let linkedTaskId: string | undefined
    let skippedGoogleTasksForLinkedTask = false
    if (form.alsoCreateTask) {
      const taskDomain = defaults?.domain
        ?? (form.category === 'work' ? 'work' : form.category === 'media' ? 'media' : 'personal')
      const willBeCalendarEvent = form.gcal && !!calToken
      const { task: created, googleTaskError } = await createTask.mutateAsync({
        title, section: sectionForDate(form.date), domain: taskDomain,
        priority: defaults?.priority ?? 'medium', due_date: form.date,
        source_type: source?.taskSourceType, source_id: source?.sourceId,
        skipGoogleTasks: willBeCalendarEvent,
      })
      if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)
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
    let calendarLinked = false
    if (form.gcal && calToken) {
      calendarLinked = await linkCalendarEvent(block.id, form.date, form.startTime, effDuration, title)
    }
    await reenableGoogleTasksIfCalendarFailed(linkedTaskId, skippedGoogleTasksForLinkedTask, calendarLinked)
    onSaved?.({ mode: 'schedule', taskId: linkedTaskId, timeBlockCreated: true })
  }

  // ── Save: mode='recurring' — schedule_blocks. No GCal (never implemented —
  // the field is hidden entirely, not shown-but-inert), no linked Task.
  async function saveRecurring() {
    const title = form.title.trim()
    const effDuration = form.customMin !== '' ? Number(form.customMin) || 60 : form.duration
    const startTimeVal = `${form.startTime}:00`
    const days = daysForRecurrence(form.recurrence === 'none' ? 'weekly' : form.recurrence, form.weeklyDays)

    if (scheduleBlock) {
      await updateScheduleBlock(scheduleBlock.id, {
        title, days_of_week: days, start_time: startTimeVal,
        end_time: endTimeFrom(form.startTime, effDuration), category: form.category,
      })
      onSaved?.({ mode: 'recurring' })
      return
    }
    await createRecur.mutateAsync({
      title, days_of_week: days, start_time: startTimeVal,
      end_time: endTimeFrom(form.startTime, effDuration), color: defaults?.color ?? 'blue', category: form.category,
    })
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

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (scheduleStillLoading) { toast.error('Still loading this task’s schedule — try again in a moment'); return }
    setSaving(true)
    const tid = toast.loading(editMode ? 'Saving…' : 'Planning…')
    try {
      if (effectiveMode === 'task')            await saveTask()
      else if (effectiveMode === 'schedule')   await saveSchedule()
      else                                     await saveRecurring()
      toast.dismiss(tid); toast.success(editMode ? 'Saved ✓' : 'Planned ✓')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (task) {
      if (!confirm('Delete this task?')) return
      const tid = toast.loading('Deleting…')
      try {
        await deleteTaskM.mutateAsync(task)
        toast.dismiss(tid); toast.success('Deleted ✓')
        onClose()
      } catch (err) {
        toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
      }
      return
    }
    if (scheduleBlock) {
      if (!confirm('Delete this repeating schedule?')) return
      const tid = toast.loading('Deleting…')
      try {
        await deleteScheduleBlock(scheduleBlock.id)
        qc.invalidateQueries({ queryKey: ['schedule', 'blocks'] })
        toast.dismiss(tid); toast.success('Deleted ✓')
        onClose()
      } catch (err) {
        toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
      }
      return
    }
    if (timeBlock) {
      if (!confirm('Delete this schedule?')) return
      const tid = toast.loading('Deleting…')
      try {
        await deleteTimeBlock(timeBlock.id)
        qc.invalidateQueries({ queryKey: ['schedule'] })
        qc.invalidateQueries({ queryKey: ['calendar'] })
        toast.dismiss(tid); toast.success('Deleted ✓')
        onClose()
      } catch (err) {
        toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
      }
    }
  }

  const primaryLabel = saving
    ? (editMode ? 'Saving…' : 'Planning…')
    : (editMode ? 'Save Changes' : (effectiveMode === 'task' ? 'Add Task' : effectiveMode === 'recurring' ? 'Save Repeat' : 'Plan it'))

  // Editing an existing one-off block never offers recurrence (no silent
  // one-off <-> recurring conversion — a real, separate storage-migration UX
  // this refactor deliberately does not build) — merged with whatever the
  // caller already hides so neither side has to know about the other.
  const effectiveScheduleConfig: PlanModalConfig | undefined = effectiveMode === 'schedule' && !!timeBlock
    ? { ...config, hideScheduleFields: [...(config?.hideScheduleFields ?? []), 'recurrence'] }
    : config

  return (
    <Dialog open={open} onClose={onClose} className="relative" style={{ zIndex }}>
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header — no tab switcher any more; mode decides the content */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100 sticky top-0 bg-cream-50 z-10">
            <h2 className="text-base font-bold text-ink-900">
              {config?.heading ?? MODE_HEADING[effectiveMode][editMode ? 'edit' : 'create']}
            </h2>
            <button
              type="button" onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl"
            >×</button>
          </div>

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
            <RecurringTab form={form} patch={patch} extra={scheduleExtra} />
          )}

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-cream-50">
            <button
              type="button" onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >Cancel</button>
            <button
              type="button" onClick={handleSave} disabled={saving || !form.title.trim() || scheduleStillLoading}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >{scheduleStillLoading ? 'Loading…' : primaryLabel}</button>
          </div>

          {editMode && (
            <div className="px-5 pb-5">
              <button
                type="button" onClick={handleDelete} disabled={saving}
                className="w-full min-h-[44px] text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
              >
                {task ? 'Delete Task' : scheduleBlock ? 'Delete Repeating Schedule' : 'Delete Schedule'}
              </button>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
