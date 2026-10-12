import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { createTask, deleteTask, updateTask, toggleTaskDone } from '../../todo/api/tasksApi'
import { createTimeBlock, deleteScheduleBlock, deleteTimeBlock, fetchScheduleBlocks, fetchTimeBlocks, updateTimeBlock } from '../../daily/api/scheduleApi'
import { findPlanTwin, type PlanTwin } from '../plan/planTwins'
import { linkBlockCalendarEvent } from '../../calendar/api/linkBlockCalendarEvent'
import { sectionForDate } from '../../../shared/components/plan-modal/planModal.config'
import { createTrainingSkip } from './trainingSkipsApi'
import { weekStartOf } from '../plan/sessionState'
import type { Task } from '../../todo/types'
import type { TimeBlock } from '../../daily/types'

// Every write a planned training session can take — the ONE place each one
// is implemented (owner, 12.10.2026: one action, one hook, everywhere). The
// popup, the task row, Daily's agenda and Training all call these through
// useTrainingPlanActions.
//
// A plan is a task (the truth: done, cancelled = skipped, its day) and its
// block on the calendar; since migration 142 the database keeps their day
// and time together and a skip row cancels/reopens the task. A day of a
// weekly plan has no row of its own: acting on it first makes it a one-off
// plan (block + task, marked with the weekly plan and the day it replaces).

export type PlanTarget =
  /** A planned session with its task (and, usually, its block). */
  | { kind: 'task'; taskId: string; blockId: string | null }
  /** A one-off training block with no task (an older plan). */
  | { kind: 'block'; blockId: string }
  /** One day of a weekly plan (schedule_blocks) nobody acted on yet. */
  | { kind: 'weekly'; templateId: string; date: string }

export interface PlanInfo {
  title: string
  /** The day it is planned for (yyyy-MM-dd). */
  date: string
  startHHMM: string | null
  minutes: number | null
  /** The Hevy routine it trains, when known. */
  routineId: string | null
}

/** One planned training session, as every view hands it to an action: where
 *  it lives (target) and what it is (info). */
export interface TrainingPlanRef {
  target: PlanTarget
  info: PlanInfo
}

export interface PlanRows { taskId: string; blockId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const timeOf = (hhmm: string | null) => (hhmm ? `${hhmm.slice(0, 5)}:00` : null)

const NOT_MIGRATED_142 = 'This needs migration 142 (training session model), which has not been applied yet.'
const isMissingColumn = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  return x?.code === '42703' || x?.code === 'PGRST204' || /column .* does not exist|Could not find the .* column/i.test(x?.message ?? '')
}

function planTaskInput(info: PlanInfo) {
  return {
    title: info.title,
    domain: 'personal' as const,
    section: sectionForDate(info.date),
    priority: 'medium' as const,
    due_date: info.date,
    due_time: timeOf(info.startHHMM),
    source_type: 'training_session' as const,
    source_id: info.routineId && UUID.test(info.routineId) ? info.routineId.toLowerCase() : null,
  }
}

/**
 * The plan's task, made first when it has none: an older block gets its
 * task; a day of a weekly plan becomes a one-off block (which takes that day
 * out of the weekly plan, migration 142) with its task. Block first, then
 * task, then the link — a failure midway leaves at worst a block with no
 * task, which the next action picks up again (the 'block' branch).
 */
export async function ensurePlanTask(target: PlanTarget, info: PlanInfo): Promise<PlanRows> {
  if (target.kind === 'task') {
    if (target.blockId) return { taskId: target.taskId, blockId: target.blockId }
    // A view that only knows the task (its row in a list): find its block.
    const { data, error } = await supabase.from('time_blocks').select('id').eq('task_id', target.taskId).maybeSingle()
    if (error) throw error
    return { taskId: target.taskId, blockId: data?.id ?? null }
  }

  let blockId: string
  if (target.kind === 'block') {
    const { data, error } = await supabase.from('time_blocks').select('task_id').eq('id', target.blockId).maybeSingle()
    if (error) throw error
    if (data?.task_id) return { taskId: data.task_id, blockId: target.blockId }
    blockId = target.blockId
  } else {
    // Already turned into a plan of its own (a second tap, another tab).
    const found = await supabase.from('time_blocks').select('id, task_id')
      .eq('schedule_block_id', target.templateId).eq('occurrence_date', target.date).maybeSingle()
    if (found.error) throw isMissingColumn(found.error) ? new Error(NOT_MIGRATED_142) : found.error
    if (found.data?.task_id) return { taskId: found.data.task_id, blockId: found.data.id }
    if (found.data) {
      blockId = found.data.id
    } else {
      const user = await requireUser()
      const { data, error } = await supabase.from('time_blocks').insert({
        user_id: user.id, date: info.date, title: info.title, start_time: timeOf(info.startHHMM),
        duration_minutes: info.minutes && info.minutes > 0 ? info.minutes : 60,
        category: 'training', color: 'accent',
        source_type: 'training_session', source_id: planTaskInput(info).source_id,
        schedule_block_id: target.templateId, occurrence_date: target.date,
      }).select('id').single()
      if (error) {
        if (isMissingColumn(error)) throw new Error(NOT_MIGRATED_142)
        // Another tap (or tab) made it a moment ago: use that one.
        if ((error as { code?: string }).code === '23505') return ensurePlanTask(target, info)
        throw error
      }
      blockId = data.id
    }
  }
  const task = await createTask(planTaskInput(info))
  await updateTimeBlock(blockId, { task_id: task.id })
  return { taskId: task.id, blockId }
}

/** The task a plan's done/reopen acts on — no block lookup for a task. */
export async function planTaskId(target: PlanTarget, info: PlanInfo): Promise<string> {
  return target.kind === 'task' ? target.taskId : (await ensurePlanTask(target, info)).taskId
}

export async function markPlanDone(taskId: string): Promise<void> {
  await toggleTaskDone(taskId, true)
}

export async function reopenPlan(taskId: string): Promise<void> {
  await toggleTaskDone(taskId, false)
}

/** Moves the session: its block when it has one (that also moves the
 *  Google Calendar event; the database moves the task, 142). A plan with no
 *  block gets one on that day and time — "set a time" and "move" are the same
 *  thing: the session on the calendar. */
export async function movePlan(rows: PlanRows, info: PlanInfo, to: { date: string; startHHMM: string | null }): Promise<void> {
  if (rows.blockId) {
    await updateTimeBlock(rows.blockId, { date: to.date, ...(to.startHHMM ? { start_time: timeOf(to.startHHMM) } : {}) })
    return
  }
  const routine = planTaskInput(info).source_id
  await createTimeBlock({
    date: to.date, title: info.title, start_time: timeOf(to.startHHMM),
    duration_minutes: info.minutes && info.minutes > 0 ? info.minutes : 60,
    category: 'training', color: 'accent', task_id: rows.taskId,
    source_type: 'training_session', ...(routine ? { source_id: routine } : {}),
  })
}

/** The same session already planned on `date` (planTwins — the plan editor's
 *  rule), so Move can ask before putting it there twice. A failed read
 *  answers null: the check guards, it never blocks. */
export async function findTwinOn(date: string, plan: TrainingPlanRef): Promise<PlanTwin | null> {
  try {
    const [blocks, templates] = await Promise.all([fetchTimeBlocks(date), fetchScheduleBlocks()])
    const own = plan.target.kind === 'task' || plan.target.kind === 'block' ? plan.target.blockId : null
    return findPlanTwin({
      date, title: plan.info.title, routineId: plan.info.routineId, excludeBlockId: own,
      // A skipped session (its task cancelled) is not a twin; nor is this one.
      blocks: blocks.filter(b => b.task_status !== 'cancelled' && (b.task_id == null || plan.target.kind !== 'task' || b.task_id !== plan.target.taskId)),
      templates: templates.filter(t => t.category === 'training'),
    })
  } catch {
    return null
  }
}

/** The one-off block a day of a weekly plan became (142), or null. */
export async function fetchOccurrenceBlockId(templateId: string, date: string): Promise<string | null> {
  const { data, error } = await supabase.from('time_blocks').select('id')
    .eq('schedule_block_id', templateId).eq('occurrence_date', date).maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return null
    throw error
  }
  return data?.id ?? null
}

/** Skips the session with its reason: its own skip row (one per session,
 *  keyed by its task), filed under the week it was planned in. The database
 *  cancels the task and fills the routine from it (142). */
export async function skipPlan(rows: PlanRows, s: { routineId: string | null; planDate: string; reason: string }): Promise<void> {
  const user = await requireUser()
  const row = {
    user_id: user.id, routine_id: s.routineId, week_start: weekStartOf(s.planDate),
    reason: s.reason.trim(), task_id: rows.taskId, plan_date: s.planDate,
  }
  const res = await supabase.from('training_skips').upsert(row, { onConflict: 'task_id' })
  if (!res.error) return
  if (!isMissingColumn(res.error) && !/no unique or exclusion constraint|null value in column "routine_id"/i.test(res.error.message ?? '')) throw res.error
  // Before 142: the routine's week skip (the Missed card's) and a cancelled task.
  if (s.routineId) await createTrainingSkip({ routine_id: s.routineId, week_start: row.week_start, reason: row.reason })
  await updateTask(rows.taskId, { status: 'cancelled' })
}

/** Undoes a skip: the task's skip row goes and the database reopens the task
 *  (142); a skip of a routine's week with no task is removed by its id. */
export async function undoPlanSkip(s: { taskId?: string | null; skipId?: string | null }): Promise<void> {
  if (s.taskId) {
    const { error } = await supabase.from('training_skips').delete().eq('task_id', s.taskId)
    if (error && !isMissingColumn(error)) throw error
    // Before 142 (no task_id) — and harmless after: reopen it ourselves.
    await updateTask(s.taskId, { status: 'open' })
    return
  }
  if (s.skipId) {
    const { error } = await supabase.from('training_skips').delete().eq('id', s.skipId)
    if (error) throw error
  }
}

// ── Delete, with Undo ───────────────────────────────────────────────────────

export interface PlanSnapshot {
  task: Task | null
  block: TimeBlock | null
  skips: Record<string, unknown>[]
}

/** Everything a delete removes, so Undo can put it back. */
export async function snapshotPlan(rows: { taskId: string | null; blockId: string | null }): Promise<PlanSnapshot> {
  const [task, block, skips] = await Promise.all([
    rows.taskId ? supabase.from('tasks').select('*').eq('id', rows.taskId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    rows.blockId
      ? supabase.from('time_blocks').select('*').eq('id', rows.blockId).maybeSingle()
      : rows.taskId ? supabase.from('time_blocks').select('*').eq('task_id', rows.taskId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    rows.taskId ? supabase.from('training_skips').select('*').eq('task_id', rows.taskId) : Promise.resolve({ data: [], error: null }),
  ])
  if (task.error) throw task.error
  if (block.error) throw block.error
  // Before 142 there is no task_id to read skips by: nothing to keep.
  if (skips.error && !isMissingColumn(skips.error)) throw skips.error
  return { task: (task.data as Task | null) ?? null, block: (block.data as TimeBlock | null) ?? null, skips: (skips.data ?? []) as Record<string, unknown>[] }
}

/** Deletes the session: its task (the block goes with it, and its Google
 *  Calendar event first — deleteTask), or a block with no task. */
export async function deletePlan(snapshot: PlanSnapshot): Promise<void> {
  if (snapshot.task) { await deleteTask(snapshot.task.id); return }
  if (snapshot.block) await deleteTimeBlock(snapshot.block.id)
}

/** Puts a deleted session back with the same ids: task, block, skip. Google
 *  copies were removed with it, so they are made again: the block's Calendar
 *  event here, the Google Task by the outbox (an inserted task with Google
 *  sync on queues its create). A step that fails takes the restored task back
 *  out (its block and skip go with it), so Undo never leaves half a session. */
export async function restorePlan(snapshot: PlanSnapshot): Promise<{ calendar: 'none' | 'linked' | 'not_linked' | 'unknown' }> {
  let insertedTask = false
  try {
    if (snapshot.task) {
      const row: Record<string, unknown> = { ...snapshot.task }
      for (const k of Object.keys(row)) if (k.startsWith('google_') && k !== 'google_sync_enabled' && k !== 'google_tasklist_id') row[k] = null
      const { error } = await supabase.from('tasks').insert(row)
      if (error) throw error
      insertedTask = true
    }
    if (snapshot.block) {
      const block: Record<string, unknown> = { ...snapshot.block, google_calendar_event_id: null }
      // Joined fields some reads carry, not columns.
      for (const k of ['task_status', 'task_workout_id', 'task_routine_id', 'task']) delete block[k]
      const { error } = await supabase.from('time_blocks').insert(block)
      if (error) throw error
    }
    if (snapshot.skips.length > 0) {
      const { error } = await supabase.from('training_skips').insert(snapshot.skips)
      if (error) throw error
    }
  } catch (err) {
    if (insertedTask && snapshot.task) await supabase.from('tasks').delete().eq('id', snapshot.task.id)
    throw err
  }
  if (!snapshot.block?.google_calendar_event_id) return { calendar: 'none' }
  const b = snapshot.block
  return { calendar: await linkBlockCalendarEvent(b.id, b.date, (b.start_time ?? '09:00').slice(0, 5), b.duration_minutes, b.title) }
}

// ── A weekly plan, deleted with Undo ────────────────────────────────────────

/** The weekly plan's row, so Undo can put it back (with its except_dates:
 *  days already turned into plans of their own stay out). */
export async function snapshotWeeklyPlan(templateId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('schedule_blocks').select('*').eq('id', templateId).single()
  if (error) throw error
  return data as Record<string, unknown>
}

export async function deleteWeeklyPlan(templateId: string): Promise<void> {
  await deleteScheduleBlock(templateId)
}

export async function restoreWeeklyPlan(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('schedule_blocks').insert(row)
  if (error) throw error
}
