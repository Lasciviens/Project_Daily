import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { useCalendarStore } from '../../../app/store'
import { updateCalendarEvent, deleteCalendarEvent } from '../../calendar/api/calendarApi'
import { logError } from '../../../shared/utils/logError'
import { classifyCalendarPushFailure } from './scheduleSyncRules'
import type {
  ScheduleBlock, TimeBlock, CreateTimeBlockInput, UpdateTimeBlockInput,
  CreateScheduleBlockInput, UpdateScheduleBlockInput,
} from '../types'
import type { TimeBlockCalendarStatus } from './scheduleSyncRules'

export type { TimeBlockCalendarStatus }

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

// Google Calendar token lives in the (vanilla-accessible) Zustand store.
function calToken(): string | null {
  return useCalendarStore.getState().accessToken
}

export async function fetchScheduleBlocks(): Promise<ScheduleBlock[]> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .select('*')
    .order('start_time', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createScheduleBlock(input: CreateScheduleBlockInput): Promise<ScheduleBlock> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('schedule_blocks')
    .insert({ ...input, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
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

// Full Google Calendar lifecycle for a one-off block (migration 077's fix —
// the old version only pushed a remote update when date/start_time changed,
// silently leaving a renamed or re-durationed block's event stale):
//   - still linked, content changed (date/start_time/title/duration_minutes)
//     -> push an update. Local write happens first (edits feel instant, same
//     convention as every other mutation here); the remote push is
//     best-effort/logged, matching this function's pre-existing behavior.
//   - explicit unlink (patch.google_calendar_event_id === null while a link
//     exists) -> remote-first, mirroring deleteTimeBlock's own ordering: a
//     network failure here must NOT silently drop the local linkage (the
//     remote event would become a permanently untracked orphan with nothing
//     left pointing at it) — surfaced as a real thrown error instead.
//
// Real bug fixed: a caller (UnifiedPlanModal's syncTaskSchedule) used to
// treat "the block's OWN google_calendar_event_id column is non-null" as
// proof the calendar link is still good, even right after THIS function
// silently swallowed a failed push to that exact event. If the remote event
// had been deleted directly in Google Calendar (a 404 on the push below),
// the caller would still report "confirmed linked" and go on to delete the
// task's Google Task (needsGoogleTaskDedupe) — leaving NEITHER Google
// representation. Returning a real, honest calendarStatus (and clearing
// the local id specifically on a CONFIRMED 404, never on an unconfirmed
// failure) is what lets callers make that decision correctly.
export async function updateTimeBlock(id: string, patch: UpdateTimeBlockInput): Promise<UpdateTimeBlockResult> {
  const { data: before, error: beforeError } = await supabase
    .from('time_blocks')
    .select('date, start_time, duration_minutes, title, google_calendar_event_id')
    .eq('id', id)
    .single()
  if (beforeError) throw beforeError

  const unlinking = patch.google_calendar_event_id === null && !!before?.google_calendar_event_id
  const token = calToken()

  if (unlinking && token) {
    try {
      await deleteCalendarEvent(token, 'primary', before!.google_calendar_event_id!)
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('404')) throw new Error(`Couldn't remove the Google Calendar event: ${msg}`)
      // 404 = already gone remotely — proceed to clear the local link too.
    }
  }

  const { error } = await supabase
    .from('time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  if (unlinking) return { calendarStatus: 'not_linked' }

  const eventId = patch.google_calendar_event_id ?? before?.google_calendar_event_id
  if (!eventId) return { calendarStatus: 'not_linked' }
  if (!token) return { calendarStatus: 'linked' } // can't verify without a token; trust the existing record as before

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
    const msg = (err as Error).message
    const status = classifyCalendarPushFailure(msg)
    if (status === 'not_linked') {
      // Confirmed gone (deleted directly in Google Calendar, outside this
      // app) — clear the stale local id so this block stops claiming a
      // link that doesn't exist, and so a future save creates a fresh
      // event instead of repeatedly failing against a dead one.
      await supabase.from('time_blocks')
        .update({ google_calendar_event_id: null, updated_at: new Date().toISOString() })
        .eq('id', id)
    } else {
      // Transient/unknown failure — leave the local id untouched (the
      // event is presumably still fine).
      logError(`Calendar event update failed: ${msg}`, { blockId: id })
    }
    return { calendarStatus: status }
  }
}

export async function deleteTimeBlock(id: string): Promise<void> {
  // Remove the linked Google Calendar event first (best-effort) so deleting a
  // block/task doesn't leave an orphaned event behind.
  const token = calToken()
  if (token) {
    try {
      const { data: row } = await supabase
        .from('time_blocks')
        .select('google_calendar_event_id')
        .eq('id', id)
        .single()
      if (row?.google_calendar_event_id) {
        await deleteCalendarEvent(token, 'primary', row.google_calendar_event_id)
      }
    } catch (err) {
      logError(`Calendar event delete failed: ${(err as Error).message}`, { blockId: id })
    }
  }
  const { error } = await supabase.from('time_blocks').delete().eq('id', id)
  if (error) throw error
}
