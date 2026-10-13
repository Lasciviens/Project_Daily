import { logError } from '../../../shared/utils/logError'
import { rowsOf, type DeletedRows, type RowOverrides } from '../../../shared/utils/deletedRows'
import { ensureLinkedCalendarEventRemoved, ensureValidCalendarToken } from './calendarTokenSync'
import { linkBlockCalendarEvent } from './linkBlockCalendarEvent'

// Schedule slots deleted with something (a task, a project item, a block of
// its own) may each have a Google Calendar event. The server's calendar
// outbox (migration 135) deletes those within ~20 minutes, but until then the
// day agenda would show each one as a plain Google event — so the browser
// removes them right after the delete. Best effort: the outbox is the safety
// net when Google isn't reachable from here.

interface BlockRow {
  id: string
  date: string
  start_time: string | null
  duration_minutes: number
  title: string | null
  google_calendar_event_id?: string | null
}

const withEvent = (s: DeletedRows | null) => rowsOf<BlockRow>(s, 'time_blocks').filter(b => !!b.google_calendar_event_id)

export async function removeDeletedBlockEvents(snapshot: DeletedRows | null): Promise<void> {
  const blocks = withEvent(snapshot)
  // Google not connected here: nothing to try (and nothing to log) — the outbox deletes them.
  if (!blocks.length || !(await ensureValidCalendarToken())) return
  await Promise.all(blocks.map(b =>
    ensureLinkedCalendarEventRemoved(b.google_calendar_event_id as string).catch(err => {
      logError(`Calendar event of a deleted block not removed yet (the calendar outbox retries): ${(err as Error).message}`, { blockId: b.id })
    })))
}

/** Undo: Google keeps a deleted event under its id, so a block put back gets a new event (relinkRestoredBlockEvents). */
export const BLOCK_EVENT_RESET: RowOverrides = { time_blocks: { google_calendar_event_id: null } }

/** After Undo: the blocks that had a Google Calendar event get one again. Returns a note when one couldn't. */
export async function relinkRestoredBlockEvents(snapshot: DeletedRows): Promise<string> {
  const results = await Promise.all(withEvent(snapshot).map(b =>
    linkBlockCalendarEvent(b.id, b.date, (b.start_time ?? '09:00').slice(0, 5), b.duration_minutes, b.title ?? '')))
  return results.some(r => r !== 'linked') ? 'not back on Google Calendar yet (open it and save to add it again)' : ''
}
