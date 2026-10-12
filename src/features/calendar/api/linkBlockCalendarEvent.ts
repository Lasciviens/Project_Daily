import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { fetchTimeBlockCalendarEventId, updateTimeBlock } from '../../daily/api/scheduleApi'
import type { TimeBlockCalendarStatus } from '../../daily/api/scheduleSyncRules'
import { LOCAL_TZ } from '../../../shared/components/plan-modal/planModal.config'
import type { CalendarEvent } from '../types'
import {
  blockEventId, createCalendarEvent, deleteCalendarEvent, getCalendarEvent, isCalendarConflict, isCalendarNotFound,
} from './calendarApi'
import { ensureValidCalendarToken } from './calendarTokenSync'

// Moved out of UnifiedPlanModal (12.10.2026) so every path that puts a block
// on Google Calendar uses the same code: the plan editor, and restoring a
// deleted training plan (Undo).

// Create a Google Calendar event for a block and store the event id back on
// the block, so it can be updated/deleted with the block later (prevents
// orphaned/duplicate events). Idempotent BY CONSTRUCTION: it re-reads the
// block first and NEVER creates a second event when one already exists — so
// re-saving (e.g. edit → add-to-calendar) can't duplicate, regardless of what
// the call site checked. Best-effort — never THROWS — but returns the same
// three-way TimeBlockCalendarStatus as updateTimeBlock, so a caller that's
// about to drop (or mint) the task's OTHER Google representation gets a
// real, confirmed answer instead of an assumption.
export async function linkBlockCalendarEvent(blockId: string, dateStr: string, timeHHMM: string, durationMin: number, title: string): Promise<TimeBlockCalendarStatus> {
  // ensureValidCalendarToken (not the reactive `calToken` above) so this
  // still works right after the stored token expired, instead of quietly
  // reporting 'unknown' the way a raw, unrefreshed token would.
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown' // nothing here is verified without a token
  try {
    // A real bug fixed: this read's error was never checked, so a DB
    // failure here (network, RLS, …) looked identical to "no event
    // linked yet" and this function would go on to create a SECOND
    // event for a block that already had one. The api read throws.
    const currentEventId = await fetchTimeBlockCalendarEventId(blockId)
    if (currentEventId) return 'linked'

    const start = new Date(`${dateStr}T${timeHHMM}:00`)
    const end   = new Date(start.getTime() + durationMin * 60_000)
    // A deterministic, client-supplied event id (this block's own uuid,
    // dashes stripped — hex-only, a valid subset of Calendar's base32hex
    // id charset) makes the create itself retry-safe: if a PRIOR attempt's
    // POST actually landed on Google but its response never reached us
    // (a network timeout — Calendar's events.insert offers no other way
    // to tell "did that already happen?"), retrying with the SAME id
    // 409s instead of silently minting a second event for this block.
    // A 409 whose event is 'cancelled' is this block's own event from
    // before an unlink (Google keeps deleted events under their id) —
    // adopting it would link the block to an event nobody sees, so the
    // next id in the block's sequence is tried instead (blockEventId).
    let created: CalendarEvent | null = null
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const eventId = blockEventId(blockId, attempt)
      try {
        created = await createCalendarEvent(token, 'primary', {
          id: eventId,
          summary: title,
          start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
          end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
        })
      } catch (createErr) {
        if (!isCalendarConflict(createErr)) throw createErr
        // Already exists on Google under this id — a previous attempt's
        // create landed after all. Adopt it, unless it is a deleted one.
        try {
          const existing = await getCalendarEvent(token, 'primary', eventId)
          if (existing.status !== 'cancelled') created = existing
        } catch (getErr) {
          if (!isCalendarNotFound(getErr)) throw getErr
        }
      }
    }
    // Five unlinks of one block used every id in its sequence: let Google
    // pick the id (only the lost-response retry safety is given up).
    if (!created) {
      created = await createCalendarEvent(token, 'primary', {
        summary: title,
        start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
        end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
      })
    }

    try {
      // Raw api call on purpose (not useUpdateTimeBlock): a failure here is
      // handled by the compensation below and must not also be toasted as
      // a failed save. handleSave refreshes the task graph afterwards.
      await updateTimeBlock(blockId, { google_calendar_event_id: created.id })
      return 'linked'
    } catch (persistErr) {
      // The remote event was created successfully, but writing its id
      // back locally failed — compensate by deleting the orphan we just
      // created rather than leaving a real Google Calendar event nothing
      // local ever points at.
      logError(`Local link persistence failed after remote create: ${(persistErr as Error).message}`, { action: 'link_calendar_event', blockId })
      try {
        await deleteCalendarEvent(token, 'primary', created.id)
        return 'not_linked' // compensation confirmed the orphan is gone (or a 404 means it already was)
      } catch (compErr) {
        if (isCalendarNotFound(compErr)) return 'not_linked'
        logError(`Compensation delete failed: ${(compErr as Error).message}`, { action: 'link_calendar_event', blockId })
        toast.error('Google Calendar sync is in an uncertain state — please check your calendar.')
        return 'unknown' // can't confirm the orphan is gone; never treat this as a clean answer either way
      }
    }
  } catch (err) {
    // Was a hardcoded generic message with the real cause swallowed —
    // surfacing it (expired token, missing write scope, a malformed
    // date/time producing an Invalid Date before the request is even
    // sent, etc.) so a sync failure is actually diagnosable instead of
    // needing a code change every time to find out why.
    toast.error(`Planned locally, Google Calendar sync failed: ${(err as Error).message}`)
    logError((err as Error).message, { action: 'link_calendar_event', blockId })
    return 'unknown'
  }
}
