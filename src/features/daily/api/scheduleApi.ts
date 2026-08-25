import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { todayStr } from '../../../shared/utils/dateUtils'
import { updateCalendarEvent, deleteCalendarEvent, isCalendarNotFound } from '../../calendar/api/calendarApi'
import { ensureValidCalendarToken, ensureLinkedCalendarEventRemoved } from '../../calendar/api/calendarTokenSync'
import { logError } from '../../../shared/utils/logError'
import { classifyCalendarPushFailure } from './scheduleSyncRules'
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

// effective_from is stamped HERE, not at any call site: "a new recurring
// template starts today, never retroactively" is a property of the entity, so
// every writer gets it for free (and the one existing caller —
// UnifiedPlanModal's saveRecurring — needs no change). The client's own LOCAL
// today is sent rather than relying on the column's CURRENT_DATE default,
// which is the SERVER's UTC day and lands on yesterday for Oslo between 00:00
// and 02:00. Retries once without the column so the app still works before
// migration 081 is applied (the established 42703/PGRST204 fallback pattern).
export async function createScheduleBlock(input: CreateScheduleBlockInput): Promise<ScheduleBlock> {
  const user = await requireUser()
  const row: Record<string, unknown> = {
    ...input, user_id: user.id, effective_from: todayStr(),
  }
  const { data, error } = await supabase.from('schedule_blocks').insert(row).select().single()
  if (!error) return data
  if (error.code !== 'PGRST204' && error.code !== '42703') throw error
  const { effective_from: _drop, ...withoutColumn } = row
  const retry = await supabase.from('schedule_blocks').insert(withoutColumn).select().single()
  if (retry.error) throw retry.error
  return retry.data
}

// Recurring templates have no Google Calendar support (never implemented —
// the modal deliberately hides that checkbox in recurring mode rather than
// show a control that silently does nothing), so this is a plain DB update.
export async function updateScheduleBlock(id: string, patch: UpdateScheduleBlockInput): Promise<ScheduleBlock> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteScheduleBlock(id: string): Promise<void> {
  const { error } = await supabase.from('schedule_blocks').delete().eq('id', id)
  if (error) throw error
}

export async function fetchTimeBlocks(dateStr: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('date', dateStr)
    .order('start_time', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

// All training-category blocks within a date range (inclusive) — used by the
// Training calendar to show planned/future sessions.
export async function fetchTrainingBlocksRange(from: string, to: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('category', 'training')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw error
  return data ?? []
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
  const { data: before, error: beforeError } = await supabase
    .from('time_blocks')
    .select('date, start_time, duration_minutes, title, google_calendar_event_id')
    .eq('id', id)
    .single()
  if (beforeError) throw beforeError

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
      const { google_calendar_event_id: _drop, ...rest } = patch
      const { error } = await supabase.from('time_blocks')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return { calendarStatus: 'unknown' }
    }
    try {
      await deleteCalendarEvent(token, 'primary', before!.google_calendar_event_id!)
    } catch (err) {
      if (!isCalendarNotFound(err)) throw new Error(`Couldn't remove the Google Calendar event: ${(err as Error).message}`)
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
    || patch.title !== undefined || patch.duration_minutes !== undefined
  if (!relevant) return { calendarStatus: 'linked' } // nothing pushed this call; no new reason to doubt it

  const date         = patch.date ?? before!.date
  const startTimeVal = patch.start_time !== undefined ? patch.start_time : before!.start_time
  const title        = patch.title ?? before!.title
  const durationMins = patch.duration_minutes ?? before!.duration_minutes
  if (!startTimeVal) return { calendarStatus: 'linked' } // no time set -> nothing coherent to push; existing id stands

  try {
    const start = new Date(`${date}T${startTimeVal}`)
    const end   = new Date(start.getTime() + durationMins * 60_000)
    await updateCalendarEvent(token, 'primary', eventId, {
      summary: title,
      start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
      end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
    })
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

// Remote-first, mirroring updateTimeBlock's own explicit-unlink ordering —
// AND a second real gap closed on top of that: the block's own
// google_calendar_event_id is now read UNCONDITIONALLY, before ever
// checking for a token. The old code only looked for a linked event AT ALL
// when a token happened to already be present — if there was no token (or
// a stale one calToken() didn't know was expired), a linked event was
// never even considered, and the local row (its only pointer to that
// event) was deleted anyway. Now: no linked event at all → delete locally,
// no token needed. A linked event exists → a token MUST be obtained (via
// ensureValidCalendarToken, which refreshes) and the remote event MUST be
// confirmed gone (a non-404 failure throws) before the local delete is
// even attempted — this can never silently orphan a real Google Calendar
// event again.
export async function deleteTimeBlock(id: string): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from('time_blocks')
    .select('google_calendar_event_id')
    .eq('id', id)
    .single()
  if (readError) throw readError

  if (row?.google_calendar_event_id) {
    await ensureLinkedCalendarEventRemoved(row.google_calendar_event_id)
  }

  const { error } = await supabase.from('time_blocks').delete().eq('id', id)
  if (error) throw error
}
