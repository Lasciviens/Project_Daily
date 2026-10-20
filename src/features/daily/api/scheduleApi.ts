import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { todayStr } from '../../../shared/utils/dateUtils'
import { updateCalendarEvent, deleteCalendarEvent, isCalendarNotFound } from '../../calendar/api/calendarApi'
import { ensureValidCalendarToken } from '../../calendar/api/calendarTokenSync'
import { logError } from '../../../shared/utils/logError'
import { classifyCalendarPushFailure } from './scheduleSyncRules'
import { blockEventBody, eventPatchFor } from '../../calendar/calendarEventRules'
import type {
  ScheduleBlock, TimeBlock, CreateTimeBlockInput, UpdateTimeBlockInput,
  CreateScheduleBlockInput, UpdateScheduleBlockInput,
} from '../types'
import type { TimeBlockCalendarStatus } from './scheduleSyncRules'

export type { TimeBlockCalendarStatus }

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export async function fetchScheduleBlocks(): Promise<ScheduleBlock[]> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .select('*')
    .order('start_time', { ascending: true })
  if (error) throw error
  return data ?? []
}

const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /column .* does not exist|could not find the '.*' column/i.test(e.message ?? '')

// The repeat columns of migration 146. Before it is applied a weekly-style
// repeat (every day / weekdays / weekly) still saves — the row simply goes
// without them; any other kind can't be stored and says so by name.
const REPEAT_COLUMNS = ['repeat_kind', 'repeat_interval', 'repeat_unit', 'repeat_dates'] as const
export const REPEAT_NOT_MIGRATED = 'Repeating monthly, every N days/weeks/months or on picked dates needs migration 146 — migration 146 not applied yet.'

/** The row without the 146 columns, or a named error when its repeat needs them. */
function withoutRepeatColumns(row: Record<string, unknown>): Record<string, unknown> {
  if (row.repeat_kind != null && row.repeat_kind !== 'weekly') throw new Error(REPEAT_NOT_MIGRATED)
  const out = { ...row }
  for (const c of REPEAT_COLUMNS) delete out[c]
  return out
}

// effective_from is the template's first day: the start the planner picked,
// else the client's own LOCAL today — never the column's CURRENT_DATE default,
// which is the SERVER's UTC day and lands on yesterday for Oslo between 00:00
// and 02:00. It is never retroactive by accident (081). Falls back without the
// 146 columns (see withoutRepeatColumns) and then without effective_from
// (before 081), the established 42703/PGRST204 pattern.
export async function createScheduleBlock(input: CreateScheduleBlockInput): Promise<ScheduleBlock> {
  const user = await requireUser()
  let row: Record<string, unknown> = {
    ...input, user_id: user.id, effective_from: input.effective_from ?? todayStr(),
  }
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.from('schedule_blocks').insert(row).select().single()
    if (!error) return data
    if (!isMissingColumn(error) || attempt >= 2) throw error
    if (REPEAT_COLUMNS.some(c => c in row)) row = withoutRepeatColumns(row)
    else if ('effective_from' in row) { row = { ...row }; delete row.effective_from }
    else throw error
  }
}

// A plain DB update. Its Google Calendar series (147) is pushed by the hook
// (useUpdateScheduleBlock → calendar/api/scheduleSeriesCalendar.ts), which
// reads the row this returns.
export async function updateScheduleBlock(id: string, patch: UpdateScheduleBlockInput): Promise<ScheduleBlock> {
  const write = (p: Record<string, unknown>) => supabase
    .from('schedule_blocks')
    .update({ ...p, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  const { data, error } = await write({ ...patch })
  if (!error) return data
  if (!isMissingColumn(error) || !REPEAT_COLUMNS.some(c => c in patch)) throw error
  const retry = await write(withoutRepeatColumns({ ...patch }))
  if (retry.error) throw retry.error
  return retry.data
}

/** One repeating plan, read fresh (never cached): the Calendar series code
 *  decides "create an event or not" off it. `.single()` — a missing row is an
 *  error there, not "no event yet". */
export async function fetchScheduleBlock(id: string): Promise<ScheduleBlock> {
  const { data, error } = await supabase.from('schedule_blocks').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export const SERIES_NOT_MIGRATED = 'Adding a repeating plan to Google Calendar needs migration 147 — migration 147 not applied yet.'

/** Whether the database has 147's link column (a fresh row read with `*` carries it, null or not). */
export function hasSeriesColumns(row: object): boolean {
  return 'google_calendar_event_id' in row
}

/** One write of a plan's series link, only while the plan's series is
 *  `only` ('free': none or this one; 'this': still this one). 148's start day
 *  rides along only when given; a database without that column takes the
 *  write without it (the series then starts at effective_from, as before
 *  148). A missing 147 column is the named SERIES_NOT_MIGRATED error.
 *  Answers how many rows it wrote (0: another link won). */
async function writeSeriesLink(id: string, eventId: string, only: 'free' | 'this', patch: Record<string, unknown>): Promise<number> {
  const user = await requireUser()
  const write = (p: Record<string, unknown>) => {
    const q = supabase.from('schedule_blocks')
      .update({ ...p, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
    return (only === 'free'
      ? q.or(`google_calendar_event_id.is.null,google_calendar_event_id.eq.${eventId}`)
      : q.eq('google_calendar_event_id', eventId)
    ).select('id')
  }
  let { data, error } = await write(patch)
  if (error && isMissingColumn(error) && 'google_calendar_from' in patch) {
    const rest = { ...patch }
    delete rest.google_calendar_from
    ;({ data, error } = await write(rest))
  }
  if (error) throw isMissingColumn(error) ? new Error(SERIES_NOT_MIGRATED) : error
  return (data ?? []).length
}

/**
 * Links a repeating plan to its Google Calendar series (147) — only while the
 * plan has no series or already this one (another tab may have linked its
 * own meanwhile; then nothing is written and this answers false). Also keeps
 * how far its RDATE list reaches, the zone it is expanded in and the day it
 * starts from (148; null = effective_from, nothing written). A raw api
 * call: a failure is handled by the caller's compensation, never toasted as
 * a failed save.
 */
export async function setScheduleBlockCalendarLink(
  id: string, eventId: string, horizon: string | null, timeZone: string, from: string | null,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    google_calendar_event_id: eventId, google_calendar_horizon: horizon, google_calendar_time_zone: timeZone,
  }
  if (from) patch.google_calendar_from = from
  return (await writeSeriesLink(id, eventId, 'free', patch)) > 0
}

/** Forgets a plan's series (and its start day: a new link starts from its own
 *  day) — only while it still names `eventId` (the
 *  clear_google_task_id_if_matches rule: a stale clear never drops a newer link). */
export async function clearScheduleBlockCalendarLink(id: string, eventId: string): Promise<void> {
  await writeSeriesLink(id, eventId, 'this',
    { google_calendar_event_id: null, google_calendar_horizon: null, google_calendar_from: null })
}

/** Forgets a slot's event only while it still names `eventId` (the
 *  clear_google_task_id_if_matches rule): Google answered 404/410 for it, so
 *  there is nothing to delete there first. Answers whether it cleared. */
export async function clearTimeBlockCalendarLinkIfMatches(blockId: string, eventId: string): Promise<boolean> {
  const { data, error } = await supabase.from('time_blocks')
    .update({ google_calendar_event_id: null, updated_at: new Date().toISOString() })
    .eq('id', blockId)
    .eq('google_calendar_event_id', eventId)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/** The days of a plan held by a moved instance of its own series: the
 *  Calendar read-back (155) stores `<seriesId>_…` on that day's slot. The
 *  series push leaves them out of its EXDATE list (an EXDATE would cancel
 *  that instance on Google). */
export async function fetchSeriesInstanceDays(planId: string, seriesId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('occurrence_date, google_calendar_event_id')
    .eq('schedule_block_id', planId)
    .not('google_calendar_event_id', 'is', null)
  if (error) {
    if (isMissingColumn(error)) return [] // before 142: no day of a plan has a slot of its own
    throw error
  }
  return (data ?? [])
    .filter(b => typeof b.google_calendar_event_id === 'string' && b.google_calendar_event_id.startsWith(`${seriesId}_`) && !!b.occurrence_date)
    .map(b => b.occurrence_date as string)
}

// A block's task state rides along (not kept as an embed): a training
// session's row shows Done / Skipped from the same facts as its popup
// (training/plan/sessionState).
type TaskEmbed = { task: { status: TimeBlock['task_status']; hevy_workout_id?: string | null; hevy_routine_id?: string | null } | null }
const withTaskState = ({ task, ...b }: TimeBlock & TaskEmbed): TimeBlock =>
  ({ ...b, task_status: task?.status ?? null, task_workout_id: task?.hevy_workout_id ?? null, task_routine_id: task?.hevy_routine_id ?? null })

/** One block with its task's state, read fresh (null when it is gone): the
 *  Calendar carry of a plan's day reads it, so a move or a skip that ran
 *  meanwhile wins. */
export async function fetchTimeBlockWithTask(id: string): Promise<TimeBlock | null> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*, task:tasks(status, hevy_workout_id, hevy_routine_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? withTaskState(data as TimeBlock & TaskEmbed) : null
}

export async function fetchTimeBlocks(dateStr: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*, task:tasks(status, hevy_workout_id, hevy_routine_id)')
    .eq('date', dateStr)
    .order('start_time', { ascending: true, nullsFirst: false })
  if (error) throw error
  return ((data ?? []) as (TimeBlock & TaskEmbed)[]).map(withTaskState)
}

export async function fetchTimeBlock(id: string): Promise<TimeBlock | null> {
  const { data, error } = await supabase.from('time_blocks').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

// At most one block per task (partial unique index, migration 077).
export async function fetchTimeBlockByTaskId(taskId: string): Promise<TimeBlock | null> {
  const { data, error } = await supabase.from('time_blocks').select('*').eq('task_id', taskId).maybeSingle()
  if (error) throw error
  return data
}

// Always a fresh read (never cached): the calendar-link protocol decides
// "create an event or not" off this value. `.single()` on purpose — a missing
// row is an error there, not "no event yet".
export async function fetchTimeBlockCalendarEventId(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('time_blocks').select('google_calendar_event_id').eq('id', id).single()
  if (error) throw error
  return data?.google_calendar_event_id ?? null
}

// Which of these tasks already own a Google Calendar event through their
// linked block (those must never also become Google Tasks).
export async function fetchCalendarLinkedTaskIds(taskIds: string[]): Promise<Set<string>> {
  if (!taskIds.length) return new Set()
  const { data, error } = await supabase
    .from('time_blocks')
    .select('task_id')
    .not('google_calendar_event_id', 'is', null)
    .in('task_id', taskIds)
  if (error) throw error
  return new Set((data ?? []).map(b => b.task_id as string))
}

// All training-category blocks within a date range (inclusive) — used by the
// Training calendar to show planned/future sessions.
export async function fetchTrainingBlocksRange(from: string, to: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*, task:tasks(status, hevy_workout_id, hevy_routine_id)')
    .eq('category', 'training')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw error
  // The linked task's status rides along so a trained session (its task done,
  // migration 141) stops being "next"; the embed itself is not kept.
  return ((data ?? []) as (TimeBlock & TaskEmbed)[]).map(withTaskState)
}

export async function createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('time_blocks')
    .insert({ ...input, user_id: user.id, color: input.color ?? 'accent' })
    .select()
    .single()
  if (error) throw error
  return data
}

// See scheduleSyncRules.ts's TimeBlockCalendarStatus doc comment for the
// three-way meaning ('linked'/'not_linked'/'unknown').
export interface UpdateTimeBlockResult {
  calendarStatus: TimeBlockCalendarStatus
}

// Full Google Calendar lifecycle for a one-off block. calendarStatus is a
// REAL, CONFIRMED answer — never inferred from "the local column happens to
// hold an id" — because a caller (UnifiedPlanModal's needsGoogleTaskDedupe /
// needsGoogleTasksFallback) uses it to decide whether it's safe to touch the
// SAME task's other Google representation (its Google Task). Getting this
// wrong either loses a still-good link or deletes a still-needed Google
// Task, so every branch below is deliberate about what it can and can't
// confirm:
//   - still linked, content changed -> push an update. A CONFIRMED 404
//     clears the stale local id (report 'not_linked') — but only if that
//     clear write itself succeeds; if the write fails, report 'unknown'
//     rather than claim a confirmed answer we couldn't actually persist.
//     Any OTHER failure (network, 401/403, 429, 5xx) leaves the local id
//     untouched and reports 'unknown' — the event is presumably still
//     fine, we simply couldn't confirm it.
//   - no Calendar token at all -> 'unknown', even if a local id exists —
//     without a token nothing here is verified, only assumed.
//   - explicit unlink (patch.google_calendar_event_id === null while a
//     link exists): remote-first. Without a token, the remote event can't
//     be deleted and the local link must NOT be silently dropped either
//     (that would abandon tracking of a link we can no longer act on) —
//     every other patch field is still applied, but the id stays, and this
//     reports 'unknown'. With a token, a non-404 delete failure throws (the
//     remote event would become a permanently untracked orphan otherwise);
//     a confirmed 404 or a successful delete both proceed to clear locally
//     and report 'not_linked'.
export async function updateTimeBlock(id: string, patch: UpdateTimeBlockInput): Promise<UpdateTimeBlockResult> {
  // `*` (not a column list): `busy` exists only since 155, and its task's
  // status decides the "✓ " in the event title.
  const { data: beforeRow, error: beforeError } = await supabase
    .from('time_blocks')
    .select('*, task:tasks(status)')
    .eq('id', id)
    .single()
  if (beforeError) throw beforeError
  const before = beforeRow as (TimeBlock & { task: { status: string } | null }) | null

  const unlinking = patch.google_calendar_event_id === null && !!before?.google_calendar_event_id
  // ensureValidCalendarToken (not calToken()) so a write that lands right
  // after the stored token expired refreshes instead of silently acting as
  // if Calendar were disconnected — real gap fixed: the read-side query
  // hooks (useCalendar.ts) already refresh proactively on a timer, but the
  // write side had nothing of its own and could 401 on an access token the
  // store still happened to be holding, expired.
  const token = await ensureValidCalendarToken()

  if (unlinking) {
    if (!token) {
      // Can't verify or act on the remote side without a token — apply
      // every OTHER field in this patch, but do NOT silently clear the
      // local link (fix: this used to happen unconditionally via the plain
      // `{...patch}` write below, abandoning tracking of a link nothing
      // can now act on). Reported as 'unknown', not 'not_linked' — we
      // genuinely don't know the remote event's fate.
      const rest = { ...patch }
      delete rest.google_calendar_event_id
      const { error } = await supabase.from('time_blocks')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return { calendarStatus: 'unknown' }
    }
    try {
      await deleteCalendarEvent(token, 'primary', before!.google_calendar_event_id!)
    } catch (err) {
      if (!isCalendarNotFound(err)) throw new Error(`Couldn't remove the Google Calendar event: ${(err as Error).message}`, { cause: err })
      // Confirmed 404 = already gone remotely — proceed to clear locally too.
    }
    const { error } = await supabase
      .from('time_blocks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { calendarStatus: 'not_linked' }
  }

  const { error } = await supabase
    .from('time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  const eventId = patch.google_calendar_event_id ?? before?.google_calendar_event_id
  if (!eventId) return { calendarStatus: 'not_linked' }
  // No token -> nothing here is verified. Real bug fixed: this used to
  // report 'linked' (trusting the local column blindly), which is exactly
  // what let a caller safely-but-wrongly dedupe a task's Google Task while
  // Calendar wasn't even connected to confirm anything with.
  if (!token) return { calendarStatus: 'unknown' }

  const relevant = patch.date !== undefined || patch.start_time !== undefined
    || patch.title !== undefined || patch.duration_minutes !== undefined || patch.busy !== undefined
  if (!relevant) return { calendarStatus: 'linked' } // nothing pushed this call; no new reason to doubt it

  // Since 155 a slot with no time is an all-day event (it used to be left
  // as it was), one with no length is Free, and a done task's title has "✓ ".
  const body = blockEventBody({
    date:             patch.date ?? before!.date,
    start_time:       patch.start_time !== undefined ? patch.start_time : before!.start_time,
    duration_minutes: patch.duration_minutes ?? before!.duration_minutes,
    title:            patch.title ?? before!.title,
    busy:             patch.busy ?? before!.busy,
  }, { done: before?.task?.status === 'done', timeZone: LOCAL_TZ })
  if (!body) return { calendarStatus: 'linked' } // no usable day -> nothing coherent to push; existing id stands

  try {
    await updateCalendarEvent(token, 'primary', eventId, { ...eventPatchFor(body, 'all') })
    return { calendarStatus: 'linked' }
  } catch (err) {
    const status = classifyCalendarPushFailure(err)
    if (status === 'not_linked') {
      // Confirmed gone (deleted directly in Google Calendar, outside this
      // app) — clear the stale local id so this block stops claiming a
      // link that doesn't exist, and so a future save creates a fresh
      // event instead of repeatedly failing against a dead one. If THIS
      // write itself fails, we can no longer claim a confirmed answer —
      // downgrade to 'unknown' rather than report 'not_linked' for a
      // clear that never actually landed.
      const { error: clearError } = await supabase.from('time_blocks')
        .update({ google_calendar_event_id: null, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (clearError) {
        logError(`Failed to clear stale calendar link: ${clearError.message}`, { blockId: id })
        return { calendarStatus: 'unknown' }
      }
      return { calendarStatus: 'not_linked' }
    }
    // Transient/unknown failure — leave the local id untouched (the
    // event is presumably still fine).
    logError(`Calendar event update failed: ${(err as Error).message}`, { blockId: id })
    return { calendarStatus: 'unknown' }
  }
}
