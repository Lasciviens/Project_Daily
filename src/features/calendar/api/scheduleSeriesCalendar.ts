import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { todayStr } from '../../../shared/utils/dateUtils'
import { rowsOf, type DeletedRows, type RowOverrides } from '../../../shared/utils/deletedRows'
import { LOCAL_TZ } from '../../../shared/components/plan-modal/planModal.config'
import {
  fetchScheduleBlock, hasSeriesColumns, setScheduleBlockCalendarLink, SERIES_NOT_MIGRATED,
} from '../../daily/api/scheduleApi'
import { classifyCalendarPushFailure, type TimeBlockCalendarStatus } from '../../daily/api/scheduleSyncRules'
import type { ScheduleBlock } from '../../daily/types'
import type { CalendarEvent } from '../types'
import { needsHorizonTopUp, seriesEventFor, type SeriesPlan } from '../calendarSeries'
import {
  blockEventId, createCalendarEvent, deleteCalendarEvent, getCalendarEvent, isCalendarConflict, isCalendarNotFound,
  updateCalendarEvent,
} from './calendarApi'
import { ensureLinkedCalendarEventRemoved, ensureValidCalendarToken } from './calendarTokenSync'
import { linkBlockCalendarEvent } from './linkBlockCalendarEvent'

// ─────────────────────────────────────────────────────────────────────────────
//  A repeating plan's ONE repeating Google Calendar event (migration 147) —
//  the calls. The event itself is calendarSeries.ts's mapping; this file is
//  its lifecycle, built like a one-off block's (linkBlockCalendarEvent /
//  updateTimeBlock / deletedBlockEvents):
//    · every call takes its token from ensureValidCalendarToken();
//    · it answers the typed TimeBlockCalendarStatus ('linked' confirmed this
//      call, 'not_linked' confirmed none, 'unknown' not confirmed either way)
//      from Google's real HTTP status — never a message guess;
//    · a Calendar failure never undoes or blocks the plan's own save: these
//      never throw; the user is told once (toast) and it is logged;
//    · the event lives in 'primary' (the calendar outbox, 135/147, queues it
//      there when the plan is deleted on the server);
//    · the event id is deterministic (the plan's uuid without dashes, then
//      <hex>v1, v2… — blockEventId), so a retry after a lost answer adopts
//      the series it already made instead of making a second one.
// ─────────────────────────────────────────────────────────────────────────────

type SeriesRow = Pick<ScheduleBlock,
  'id' | 'title' | 'start_time' | 'end_time' | 'days_of_week' | 'effective_from' | 'except_dates'
  | 'repeat_kind' | 'repeat_interval' | 'repeat_unit' | 'repeat_dates'
  | 'google_calendar_event_id' | 'google_calendar_horizon'>

const planFor = (row: SeriesRow): SeriesPlan | null => seriesEventFor(row, { today: todayStr(), timeZone: LOCAL_TZ })
const message = (err: unknown) => (err as Error)?.message ?? String(err)

function reportFailure(err: unknown, planId: string, quiet: boolean) {
  if (!quiet) toast.error(`Saved locally, Google Calendar sync failed: ${message(err)}`)
  logError(`Calendar series: ${message(err)}`, { action: 'calendar_series', planId })
}

/** Creates the series under the plan's own id sequence; a 409 is a series an
 *  earlier attempt already made (adopted and brought up to date) unless it is
 *  a deleted one (Google keeps those under their id) — then the next id. */
async function createSeriesEvent(token: string, planId: string, plan: SeriesPlan): Promise<CalendarEvent> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = blockEventId(planId, attempt)
    try {
      return await createCalendarEvent(token, 'primary', { id, ...plan.body })
    } catch (createErr) {
      if (!isCalendarConflict(createErr)) throw createErr
      try {
        const existing = await getCalendarEvent(token, 'primary', id)
        if (existing.status !== 'cancelled') return await updateCalendarEvent(token, 'primary', id, { ...plan.body })
      } catch (getErr) {
        if (!isCalendarNotFound(getErr)) throw getErr
      }
    }
  }
  // Five unlinks of one plan used every id in its sequence: Google picks one.
  return createCalendarEvent(token, 'primary', { ...plan.body })
}

/** Deletes the series on Google (already gone is fine), then forgets it here. */
async function removeSeries(row: SeriesRow, token: string, quiet: boolean): Promise<TimeBlockCalendarStatus> {
  try {
    await deleteCalendarEvent(token, 'primary', row.google_calendar_event_id as string)
  } catch (err) {
    if (!isCalendarNotFound(err)) {
      reportFailure(err, row.id, quiet)
      return 'unknown' // the link stays: the event is still there
    }
  }
  try {
    await setScheduleBlockCalendarLink(row.id, null, null)
    return 'not_linked'
  } catch (err) {
    reportFailure(err, row.id, quiet)
    return 'unknown'
  }
}

/** Brings a linked series up to date with its plan (title, time, rule, the
 *  days taken out, the RDATE horizon). A confirmed 404/410 (deleted in Google
 *  Calendar) forgets the link and answers 'not_linked'; a plan with no day
 *  left removes the series. */
async function pushSeries(row: SeriesRow, token: string, quiet: boolean): Promise<TimeBlockCalendarStatus> {
  const eventId = row.google_calendar_event_id
  if (!eventId) return 'not_linked'
  const plan = planFor(row)
  if (!plan) return removeSeries(row, token, quiet)
  try {
    await updateCalendarEvent(token, 'primary', eventId, { ...plan.body })
  } catch (err) {
    if (classifyCalendarPushFailure(err) === 'not_linked') {
      try {
        await setScheduleBlockCalendarLink(row.id, null, null)
        return 'not_linked'
      } catch (clearErr) {
        logError(`Calendar series: failed to clear a stale link: ${message(clearErr)}`, { planId: row.id })
        return 'unknown'
      }
    }
    reportFailure(err, row.id, quiet)
    return 'unknown'
  }
  if (plan.horizon !== (row.google_calendar_horizon ?? null)) {
    // The event is right; a failed note of how far it reaches only means the
    // next app open pushes it again.
    await setScheduleBlockCalendarLink(row.id, eventId, plan.horizon)
      .catch(err => logError(`Calendar series: horizon not saved: ${message(err)}`, { planId: row.id }))
  }
  return 'linked'
}

/**
 * Puts a repeating plan on Google Calendar as ONE repeating event and stores
 * its id on the plan. Idempotent: it re-reads the plan and only brings an
 * existing series up to date. Never throws.
 */
export async function linkScheduleSeries(planId: string): Promise<TimeBlockCalendarStatus> {
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown'
  let created: CalendarEvent | null = null
  try {
    const row = await fetchScheduleBlock(planId)
    if (!hasSeriesColumns(row)) throw new Error(SERIES_NOT_MIGRATED)
    if (row.google_calendar_event_id) return await pushSeries(row, token, false)
    const plan = planFor(row)
    if (!plan) {
      toast.warning('Not added to Google Calendar: this plan has no day left to show')
      return 'not_linked'
    }
    created = await createSeriesEvent(token, planId, plan)
    await setScheduleBlockCalendarLink(planId, created.id, plan.horizon)
    return 'linked'
  } catch (err) {
    reportFailure(err, planId, false)
    if (!created) return 'unknown'
    // Made on Google but its id couldn't be stored: remove it rather than
    // leave a series nothing here points at.
    try {
      await deleteCalendarEvent(token, 'primary', created.id)
      return 'not_linked'
    } catch (compErr) {
      if (isCalendarNotFound(compErr)) return 'not_linked'
      logError(`Calendar series: compensation delete failed: ${message(compErr)}`, { planId })
      toast.error('Google Calendar sync is in an uncertain state — please check your calendar.')
      return 'unknown'
    }
  }
}

/**
 * After a plan was created or saved: what the planner's "Add to Google
 * Calendar" asks for. `want` true → linked and up to date; false → off Google
 * (deleted there first; without a valid connection the link stays and the
 * answer is 'unknown'); undefined (no connection to ask with) → a linked
 * series is still brought up to date when possible.
 */
export async function syncScheduleSeriesAfterSave(row: SeriesRow, want: boolean | undefined): Promise<TimeBlockCalendarStatus> {
  const linked = !!row.google_calendar_event_id
  if (!linked) return want ? linkScheduleSeries(row.id) : 'not_linked'
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown'
  if (want === false) return removeSeries(row, token, false)
  const status = await pushSeries(row, token, false)
  // Deleted in Google Calendar meanwhile: make it again when it is wanted.
  return status === 'not_linked' && want ? linkScheduleSeries(row.id) : status
}

/**
 * A day of a plan on Google Calendar became a one-off block (142: done,
 * moved or skipped on Training / Daily). The database has already left that
 * day out (except_dates); here the series gets its EXDATE and the block its
 * own event, so whatever happens to that day next changes only that day.
 * Best effort, never throws; without a connection nothing changes on Google.
 */
export async function carryOccurrenceToCalendar(
  planId: string,
  block: { id: string; date: string; startHHMM: string | null; minutes: number; title: string },
): Promise<void> {
  try {
    const row = await fetchScheduleBlock(planId)
    if (!row.google_calendar_event_id) return
    const token = await ensureValidCalendarToken()
    if (!token) return
    await pushSeries(row, token, true)
    if (block.startHHMM) await linkBlockCalendarEvent(block.id, block.date, block.startHHMM.slice(0, 5), block.minutes, block.title)
  } catch (err) {
    logError(`Calendar series: a day of the plan not carried to Google Calendar: ${message(err)}`, { planId, blockId: block.id })
  }
}

/** When the app opens: the monthly kinds' RDATE list is pushed again once
 *  fewer than 90 days of it remain (calendarSeries.needsHorizonTopUp). Quiet. */
export async function topUpSeriesHorizons(rows: readonly ScheduleBlock[]): Promise<void> {
  const due = rows.filter(r => needsHorizonTopUp(r, todayStr()))
  if (!due.length) return
  const token = await ensureValidCalendarToken()
  if (!token) return
  for (const row of due) await pushSeries(row, token, true)
}

// ── Delete and Undo (the one delete flow, useDeleteScheduleBlock) ────────────

const withSeries = (s: DeletedRows | null) =>
  rowsOf<SeriesRow>(s, 'schedule_blocks').filter(r => !!r.google_calendar_event_id)

/** Right after a delete: the plans' series leave Google. Best effort — the
 *  calendar outbox (147's trigger) removes what the browser couldn't reach. */
export async function removeDeletedSeriesEvents(snapshot: DeletedRows | null): Promise<void> {
  const rows = withSeries(snapshot)
  if (!rows.length || !(await ensureValidCalendarToken())) return
  await Promise.all(rows.map(r =>
    ensureLinkedCalendarEventRemoved(r.google_calendar_event_id as string).catch(err => {
      logError(`Calendar series of a deleted plan not removed yet (the calendar outbox retries): ${message(err)}`, { planId: r.id })
    })))
}

/** Undo: Google keeps a deleted event under its id, so a plan put back gets a new series. */
export const SERIES_EVENT_RESET: RowOverrides = { schedule_blocks: { google_calendar_event_id: null, google_calendar_horizon: null } }

/** After Undo: the plans that were on Google Calendar go back on it. Returns a note when one couldn't. */
export async function relinkRestoredSeriesEvents(snapshot: DeletedRows): Promise<string> {
  const results = await Promise.all(withSeries(snapshot).map(r => linkScheduleSeries(r.id)))
  return results.some(r => r !== 'linked') ? 'not back on Google Calendar yet (open it and save to add it again)' : ''
}
