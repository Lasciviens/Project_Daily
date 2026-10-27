import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { todayStr } from '../../../shared/utils/dateUtils'
import { createTask, updateTask, toggleTaskDone } from '../../todo/api/tasksApi'
import { createTimeBlock, fetchScheduleBlocks, fetchTimeBlocks, fetchTrainingBlocksRange, updateTimeBlock } from '../../daily/api/scheduleApi'
import {
  carryOccurrenceToCalendar, putSkippedDayBackOnCalendar, takeSkippedDayOffCalendar,
} from '../../calendar/api/scheduleSeriesCalendar'
import { refreshTaskEventSoon } from '../../calendar/api/itemCalendar'
import { findPlanTwin, type PlanTwin } from '../plan/planTwins'
import { sectionForDate } from '../../../shared/components/plan-modal/planModal.config'
import { createTrainingSkip } from './trainingSkipsApi'
import { weekStartOf } from '../plan/sessionState'

// Every write a planned training session can take — the ONE place each one
// is implemented (owner, 12.10.2026: one action, one hook, everywhere). The
// popup, the task row, Daily's agenda and Training all call these through
// useTrainingPlanActions.
//
// A plan is a task (the truth: done, cancelled = skipped, its day) and its
// block on the calendar; since migration 142 the database keeps their day
// and time together and a skip row cancels/reopens the task. A day of a
// weekly plan is its day's task since 156 (made on its day, no block):
// acting on it first makes it a one-off plan (142's split — block + task,
// marked with the weekly plan and the day it replaces), REUSING that task,
// so every training view (they read blocks) sees it and no day has two.

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

/** 142's split of one day of a repeat, in the database (155's item_occurrence,
 *  156: it reuses the day's task) — one transaction, the repeat locked, so a
 *  second tap or tab gets the same rows. `created`: the block was made now. */
async function splitRepeatDay(templateId: string, date: string): Promise<PlanRows & { created: boolean }> {
  const { data, error } = await supabase.rpc('item_occurrence', { p_plan: templateId, p_date: date, p_today: todayStr() })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { block_id?: string; task_id?: string; created?: boolean } | null
  if (!row?.task_id) throw new Error('That day of the repeating plan could not be planned on its own')
  return { taskId: row.task_id, blockId: row.block_id ?? null, created: row.created === true }
}

/** A split day's task keeps the routine this view read for it (when the
 *  database found none of its own — 141 links the routine from source_id). */
async function keepRoutine(taskId: string, routineId: string | null): Promise<void> {
  if (!routineId || !UUID.test(routineId)) return
  const user = await requireUser()
  const { error } = await supabase.from('tasks').update({ source_id: routineId.toLowerCase() })
    .eq('user_id', user.id).eq('id', taskId).is('source_id', null)
  if (error && !isMissingColumn(error)) throw error
}

const isMissingRpc = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  return x?.code === 'PGRST202' || x?.code === '42883' || /could not find the function/i.test(x?.message ?? '')
}

/**
 * The plan's task, made first when it has none: an older block gets its
 * task; a day of a weekly plan becomes a one-off block (which takes that day
 * out of the weekly plan, migration 142) with its task — the day's own task
 * when it has one (156); so does a day's task with no block (the training
 * views read blocks). Block first, then task, then the link — a failure
 * midway leaves at worst a block with no task, which the next action picks
 * up again (the 'block' branch).
 */
export async function ensurePlanTask(target: PlanTarget, info: PlanInfo): Promise<PlanRows> {
  if (target.kind === 'task') {
    if (target.blockId) return { taskId: target.taskId, blockId: target.blockId }
    // A view that only knows the task (its row in a list): find its block.
    const { data, error } = await supabase.from('time_blocks').select('id').eq('task_id', target.taskId).maybeSingle()
    if (error) throw error
    if (data?.id) return { taskId: target.taskId, blockId: data.id }
    // A repeat's day made on its day (156) has no block yet: 142's split gives it one.
    const day = await fetchRepeatDayOf(target.taskId)
    if (!day) return { taskId: target.taskId, blockId: null }
    const rows = await splitRepeatDay(day.scheduleBlockId, day.date)
    await keepRoutine(rows.taskId, info.routineId)
    if (rows.created && rows.blockId) carryOccurrenceToCalendar(day.scheduleBlockId, rows.blockId)
    return { taskId: rows.taskId, blockId: rows.blockId }
  }

  let blockId: string
  // A day of a plan that has no Google event of its own yet (147).
  let carry = false
  if (target.kind === 'block') {
    const { data, error } = await supabase.from('time_blocks').select('task_id').eq('id', target.blockId).maybeSingle()
    if (error) throw error
    if (data?.task_id) return { taskId: data.task_id, blockId: target.blockId }
    blockId = target.blockId
  } else {
    // 142's split in the database (156: the day's own task reused, never a second one).
    try {
      const rows = await splitRepeatDay(target.templateId, target.date)
      await keepRoutine(rows.taskId, info.routineId)
      if (rows.created && rows.blockId) carryOccurrenceToCalendar(target.templateId, rows.blockId)
      return { taskId: rows.taskId, blockId: rows.blockId }
    } catch (err) {
      if (!isMissingRpc(err)) throw err
      // Before 155 (no item_occurrence): the browser's own split, below.
    }
    // Already turned into a plan of its own (a second tap, another tab).
    const found = await supabase.from('time_blocks').select('id, task_id, google_calendar_event_id')
      .eq('schedule_block_id', target.templateId).eq('occurrence_date', target.date).maybeSingle()
    if (found.error) throw isMissingColumn(found.error) ? new Error(NOT_MIGRATED_142) : found.error
    if (found.data?.task_id) return { taskId: found.data.task_id, blockId: found.data.id }
    if (found.data) {
      blockId = found.data.id
      carry = !found.data.google_calendar_event_id
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
      carry = true
    }
  }
  const task = await createTask(planTaskInput(info))
  await updateTimeBlock(blockId, { task_id: task.id })
  // A day of a plan on Google Calendar (147): the series leaves the day out
  // and the block gets its own event — in the background, after the plan's
  // own writes, so Done / Move / Skip never wait on Google; it reads the
  // block fresh, so a move or skip that ran meanwhile wins.
  if (carry && target.kind === 'weekly') carryOccurrenceToCalendar(target.templateId, blockId)
  return { taskId: task.id, blockId }
}

/** The task a plan's done/reopen acts on — a task with its block as it is; a
 *  repeat's day made on its day (156) is split first, so the training views
 *  (which read blocks) see it done. */
export async function planTaskId(target: PlanTarget, info: PlanInfo): Promise<string> {
  if (target.kind === 'task' && target.blockId) return target.taskId
  return (await ensurePlanTask(target, info)).taskId
}

/** A session's first day (167): its week is that day and the next six; a
 *  move to 7 or more days after it skips it there. Null before 167 or unknown. */
export async function fetchFirstPlanDay(taskId: string): Promise<string | null> {
  const { data, error } = await supabase.from('tasks').select('first_plan_date').eq('id', taskId).maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return null
    throw error
  }
  return (data as { first_plan_date?: string | null } | null)?.first_plan_date ?? null
}

/** The repeat and day a task is (156: made on its day), or null. Before 156 there is no such column: null. */
export async function fetchRepeatDayOf(taskId: string): Promise<{ scheduleBlockId: string; date: string } | null> {
  const { data, error } = await supabase.from('tasks').select('schedule_block_id, occurrence_date').eq('id', taskId).maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return null
    throw error
  }
  const row = data as { schedule_block_id?: string | null; occurrence_date?: string | null } | null
  return row?.schedule_block_id && row.occurrence_date ? { scheduleBlockId: row.schedule_block_id, date: row.occurrence_date } : null
}

export async function markPlanDone(taskId: string): Promise<void> {
  await toggleTaskDone(taskId, true)
  // Its event on Google Calendar gets "✓ " (155), in the background.
  refreshTaskEventSoon(taskId)
}

export async function reopenPlan(taskId: string): Promise<void> {
  await toggleTaskDone(taskId, false)
  refreshTaskEventSoon(taskId)
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

/** After a move 7 or more days past the session's first day (167): the
 *  database skipped the session on its first day and moved that week's
 *  session of the same plan onto `date` (splitting a repeat's day). Google
 *  follows as for a skip and a split made here: the skipped day comes off the
 *  calendar, the day moved onto `date` gets its own event (the series its
 *  EXDATE). Background — the move is done and reported first. */
export function carryPastWeekMoveToCalendar(rows: PlanRows, date: string): void {
  if (rows.blockId) takeSkippedDayOffCalendar(rows.blockId)
  void (async () => {
    const blocks = await fetchTrainingBlocksRange(date, date)
    for (const b of blocks) {
      if (b.id !== rows.blockId && b.schedule_block_id && b.occurrence_date && b.occurrence_date !== date && !b.google_calendar_event_id) {
        carryOccurrenceToCalendar(b.schedule_block_id, b.id)
      }
    }
  })().catch(() => { /* a failed read leaves Google as it was; the next app open pushes what is pending */ })
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

/** A day of a weekly plan as it is now: the one-off block it became (142),
 *  or its day's task (156 — made on its day, no block), or neither. */
export async function fetchOccurrence(templateId: string, date: string): Promise<{ blockId: string | null; dayTaskId: string | null }> {
  const { data, error } = await supabase.from('time_blocks').select('id')
    .eq('schedule_block_id', templateId).eq('occurrence_date', date).maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return { blockId: null, dayTaskId: null }
    throw error
  }
  if (data?.id) return { blockId: data.id, dayTaskId: null }
  const day = await supabase.from('tasks').select('id')
    .eq('schedule_block_id', templateId).eq('occurrence_date', date).maybeSingle()
  if (day.error) {
    if (isMissingColumn(day.error)) return { blockId: null, dayTaskId: null }
    throw day.error
  }
  return { blockId: null, dayTaskId: day.data?.id ?? null }
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
  if (res.error) {
    if (!isMissingColumn(res.error) && !/no unique or exclusion constraint|null value in column "routine_id"/i.test(res.error.message ?? '')) throw res.error
    // Before 142: the routine's week skip (the Missed card's) and a cancelled task.
    if (s.routineId) await createTrainingSkip({ routine_id: s.routineId, week_start: row.week_start, reason: row.reason })
    await updateTask(rows.taskId, { status: 'cancelled' })
  }
  // A skipped day of a plan comes off Google Calendar (147); in the background.
  if (rows.blockId) takeSkippedDayOffCalendar(rows.blockId)
}

/** Undoes a skip: the task's skip row goes and the database reopens the task
 *  (142); a skip of a routine's week with no task is removed by its id. */
export async function undoPlanSkip(s: { taskId?: string | null; skipId?: string | null }): Promise<void> {
  if (s.taskId) {
    const { error } = await supabase.from('training_skips').delete().eq('task_id', s.taskId)
    if (error && !isMissingColumn(error)) throw error
    // Before 142 (no task_id) — and harmless after: reopen it ourselves.
    await updateTask(s.taskId, { status: 'open' })
    // A day of a plan on Google Calendar gets its own event back (147); in the background.
    putSkippedDayBackOnCalendar(s.taskId)
    return
  }
  if (s.skipId) {
    const { error } = await supabase.from('training_skips').delete().eq('id', s.skipId)
    if (error) throw error
  }
}

