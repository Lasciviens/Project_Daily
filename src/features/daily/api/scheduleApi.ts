import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore } from '../../../app/store'
import { updateCalendarEvent, deleteCalendarEvent } from '../../calendar/api/calendarApi'
import { logError } from '../../../shared/utils/logError'
import type { ScheduleBlock, TimeBlock, TimeBlockCategory, CreateTimeBlockInput, CreateScheduleBlockInput } from '../types'

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('schedule_blocks')
    .insert({ ...input, user_id: user.id })
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('time_blocks')
    .insert({ ...input, user_id: user.id, color: input.color ?? 'accent' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTimeBlock(id: string, patch: { start_time?: string; date?: string; title?: string; duration_minutes?: number; category?: TimeBlockCategory; color?: string; google_calendar_event_id?: string | null }): Promise<void> {
  const { error } = await supabase
    .from('time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  // Keep the linked Google Calendar event in sync when the block actually moved
  // (time/date changed). Skip when we only wrote the event id back, or when
  // there's no connected calendar. Non-fatal — a sync failure never breaks the
  // local write.
  if (patch.start_time === undefined && patch.date === undefined) return
  const token = calToken()
  if (!token) return
  try {
    const { data: row } = await supabase
      .from('time_blocks')
      .select('date, start_time, duration_minutes, title, google_calendar_event_id')
      .eq('id', id)
      .single()
    if (!row?.google_calendar_event_id || !row.start_time) return
    const start = new Date(`${row.date}T${row.start_time}`)
    const end   = new Date(start.getTime() + (row.duration_minutes ?? 60) * 60_000)
    await updateCalendarEvent(token, 'primary', row.google_calendar_event_id, {
      summary: row.title,
      start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
      end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
    })
  } catch (err) {
    logError(`Calendar event update failed: ${(err as Error).message}`, { blockId: id })
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
