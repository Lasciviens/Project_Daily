import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { todayStr } from '../../../shared/utils/dateUtils'
import { rowsOf, type DeletedRows, type RowOverrides } from '../../../shared/utils/deletedRows'
import { LOCAL_TZ } from '../../../shared/components/plan-modal/planModal.config'
import {
  clearScheduleBlockCalendarLink, fetchScheduleBlock, fetchSeriesInstanceDays, fetchTimeBlockByTaskId, fetchTimeBlockWithTask,
  hasSeriesColumns, setScheduleBlockCalendarLink, updateTimeBlock, SERIES_NOT_MIGRATED,
} from '../../daily/api/scheduleApi'
import { classifyCalendarPushFailure, type TimeBlockCalendarStatus } from '../../daily/api/scheduleSyncRules'
import type { ScheduleBlock } from '../../daily/types'
import type { CalendarEvent } from '../types'
import {
  addPendingSeries, isBeforeSeriesStart, needsHorizonTopUp, needsSeriesFromDay, parsePendingSeries, plansToAddToCalendar,
  seriesEventForPush, seriesPushZone, SERIES_PENDING_KEY, type PendingSeries, type SeriesPlan,
} from '../calendarSeries'
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
//      the series it already made instead of making a second one;
//    · the link is written only while the plan has no series or this one,
//      and cleared only while it still names this one (scheduleApi);
//    · the zone: a save from the planner uses the device's, every other push
//      the series' own (seriesPushZone);
//    · the start: the plan's first day on or after the day it was added to
//      Google (148, stored with the link) — never its past weeks;
//    · a push Google didn't take from the background (a day carried over,
//      Undo) is retried when the app next opens (the pending list);
//    · since 155 a repeat with no time is an all-day series, Busy / Free
//      follows the plan, and a day held by a moved instance of the series
//      (the Calendar read-back) never gets an EXDATE.
// ─────────────────────────────────────────────────────────────────────────────

type SeriesRow = Pick<ScheduleBlock,
  'id' | 'title' | 'start_time' | 'end_time' | 'days_of_week' | 'effective_from' | 'except_dates'
  | 'repeat_kind' | 'repeat_interval' | 'repeat_unit' | 'repeat_dates'
  | 'google_calendar_event_id' | 'google_calendar_horizon' | 'google_calendar_time_zone' | 'google_calendar_from' | 'busy'>

/** fromEditor: a save from the planner (may change the zone; reports failures).
 *  Every other caller is quiet and keeps the series' zone. */
interface PushMode { fromEditor: boolean }

const zoneFor = (row: SeriesRow, mode: PushMode) => seriesPushZone(row.google_calendar_time_zone, LOCAL_TZ, mode.fromEditor)
const planFor = (row: SeriesRow, zone: string, keepDays: readonly string[] = []): SeriesPlan | null =>
  seriesEventForPush(row, { today: todayStr(), timeZone: zone, keepDays })
const message = (err: unknown) => (err as Error)?.message ?? String(err)

function reportFailure(err: unknown, planId: string, mode: PushMode) {
  if (mode.fromEditor) toast.error(`Saved locally, Google Calendar sync failed: ${message(err)}`)
  logError(`Calendar series: ${message(err)}`, { action: 'calendar_series', planId })
}

// ── The retry list (calendarSeries.ts: SERIES_PENDING_KEY) ───────────────────

function readPending(): PendingSeries[] {
  try { return parsePendingSeries(localStorage.getItem(SERIES_PENDING_KEY)) } catch { return [] }
}
function writePending(list: readonly PendingSeries[]) {
  try {
    if (list.length) localStorage.setItem(SERIES_PENDING_KEY, JSON.stringify(list))
    else localStorage.removeItem(SERIES_PENDING_KEY)
  } catch { /* storage blocked: the push is simply not retried */ }
}

/** Remembers a push Google didn't take, to try again when the app next opens.
 *  Says so once per plan (not again while it waits). */
function deferSeries(planId: string, blockId: string | null, opts: { relink?: boolean; warn: boolean }) {
  const list = readPending()
  const waiting = list.some(p => p.planId === planId)
  writePending(addPendingSeries(list, planId, blockId, opts.relink))
  if (opts.warn && !waiting) toast.warning('Google Calendar didn\'t take that change yet — the app tries again the next time it opens.')
}

// ── Google calls ─────────────────────────────────────────────────────────────

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
async function removeSeries(row: SeriesRow, token: string, mode: PushMode): Promise<TimeBlockCalendarStatus> {
  const eventId = row.google_calendar_event_id as string
  try {
    await deleteCalendarEvent(token, 'primary', eventId)
  } catch (err) {
    if (!isCalendarNotFound(err)) {
      reportFailure(err, row.id, mode)
      return 'unknown' // the link stays: the event is still there
    }
  }
  try {
    await clearScheduleBlockCalendarLink(row.id, eventId)
    return 'not_linked'
  } catch (err) {
    reportFailure(err, row.id, mode)
    return 'unknown'
  }
}

/** Brings a linked series up to date with its plan (title, time, rule, the
 *  days taken out, the RDATE horizon, the zone). A confirmed 404/410 (deleted
 *  in Google Calendar) forgets the link and answers 'not_linked'; a plan with
 *  no day left removes the series. */
async function pushSeries(row: SeriesRow, token: string, mode: PushMode): Promise<TimeBlockCalendarStatus> {
  const eventId = row.google_calendar_event_id
  if (!eventId) return 'not_linked'
  const zone = zoneFor(row, mode)
  let keepDays: string[] = []
  try { keepDays = await fetchSeriesInstanceDays(row.id, eventId) } catch (err) {
    // Without it a moved instance could get an EXDATE: don't push now.
    reportFailure(err, row.id, mode)
    return 'unknown'
  }
  const plan = planFor(row, zone, keepDays)
  if (!plan) return removeSeries(row, token, mode)
  try {
    await updateCalendarEvent(token, 'primary', eventId, { ...plan.body })
  } catch (err) {
    if (classifyCalendarPushFailure(err) === 'not_linked') {
      try {
        await clearScheduleBlockCalendarLink(row.id, eventId)
        return 'not_linked'
      } catch (clearErr) {
        logError(`Calendar series: failed to clear a stale link: ${message(clearErr)}`, { planId: row.id })
        return 'unknown'
      }
    }
    reportFailure(err, row.id, mode)
    return 'unknown'
  }
  if (plan.horizon !== (row.google_calendar_horizon ?? null) || zone !== row.google_calendar_time_zone
      || plan.from !== (row.google_calendar_from ?? null)) {
    // The event is right; a failed note of how far it reaches (its zone, the
    // day it starts from) only means the next app open pushes it again.
    await setScheduleBlockCalendarLink(row.id, eventId, plan.horizon, zone, plan.from)
      .catch(err => logError(`Calendar series: horizon not saved: ${message(err)}`, { planId: row.id }))
  }
  return 'linked'
}

/**
 * Puts a repeating plan on Google Calendar as ONE repeating event and stores
 * its id on the plan. Idempotent: it re-reads the plan and only brings an
 * existing series up to date. Never throws.
 */
export async function linkScheduleSeries(planId: string, mode: PushMode = { fromEditor: true }): Promise<TimeBlockCalendarStatus> {
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown'
  let created: CalendarEvent | null = null
  try {
    const row = await fetchScheduleBlock(planId)
    if (!hasSeriesColumns(row)) throw new Error(SERIES_NOT_MIGRATED)
    if (row.google_calendar_event_id) return await pushSeries(row, token, mode)
    const zone = zoneFor(row, mode)
    const plan = planFor(row, zone)
    if (!plan) {
      if (mode.fromEditor) toast.warning('Not added to Google Calendar: this plan has no day left to show')
      return 'not_linked'
    }
    created = await createSeriesEvent(token, planId, plan)
    if (await setScheduleBlockCalendarLink(planId, created.id, plan.horizon, zone, plan.from)) return 'linked'
    // Another tab linked its own series meanwhile: that one stays, ours goes.
    await deleteCalendarEvent(token, 'primary', created.id).catch(err => {
      if (!isCalendarNotFound(err)) logError(`Calendar series: a second series not removed: ${message(err)}`, { planId })
    })
    return 'linked'
  } catch (err) {
    reportFailure(err, planId, mode)
    if (!created) return 'unknown'
    // Made on Google but its id couldn't be stored: remove it rather than
    // leave a series nothing here points at.
    try {
      await deleteCalendarEvent(token, 'primary', created.id)
      return 'not_linked'
    } catch (compErr) {
      if (isCalendarNotFound(compErr)) return 'not_linked'
      logError(`Calendar series: compensation delete failed: ${message(compErr)}`, { planId })
      if (mode.fromEditor) toast.error('Google Calendar sync is in an uncertain state — please check your calendar.')
      return 'unknown'
    }
  }
}

/**
 * After a plan was created or saved in the planner: what its "Add to Google
 * Calendar" asks for. `want` true → linked and up to date; false → off Google
 * (deleted there first; without a valid connection the link stays and the
 * answer is 'unknown'); undefined (no connection to ask with) → a linked
 * series is still brought up to date when possible.
 */
export async function syncScheduleSeriesAfterSave(row: SeriesRow, want: boolean | undefined): Promise<TimeBlockCalendarStatus> {
  const editor: PushMode = { fromEditor: true }
  const linked = !!row.google_calendar_event_id
  if (!linked) return want ? linkScheduleSeries(row.id, editor) : 'not_linked'
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown'
  if (want === false) return removeSeries(row, token, editor)
  const status = await pushSeries(row, token, editor)
  // Deleted in Google Calendar meanwhile: make it again when it is wanted.
  return status === 'not_linked' && want ? linkScheduleSeries(row.id, editor) : status
}

// ── One day of a plan (142) ──────────────────────────────────────────────────

/**
 * Gives a day of a plan its own Google event, from the block as it is NOW (a
 * move or a skip that ran meanwhile wins): a skipped day stays off Google.
 * Answers false when the event couldn't be confirmed (retry later).
 */
async function linkDayEvent(blockId: string): Promise<boolean> {
  const b = await fetchTimeBlockWithTask(blockId)
  // A day with no time (a repeat with no time, 155) gets an all-day event.
  if (!b || b.google_calendar_event_id || b.task_status === 'cancelled') return true
  const status = await linkBlockCalendarEvent(b.id)
  if (status !== 'linked') return status !== 'unknown'
  // Settle on the block as it is after the link: a move pushes the event, a
  // skip takes it off, a delete removes it (its first id — a new block never
  // had one).
  const now = await fetchTimeBlockWithTask(blockId)
  if (!now) {
    await ensureLinkedCalendarEventRemoved(blockEventId(blockId, 0)).catch(() => {})
  } else if (now.task_status === 'cancelled') {
    await updateTimeBlock(blockId, { google_calendar_event_id: null })
  } else if (now.date !== b.date || now.start_time !== b.start_time || now.duration_minutes !== b.duration_minutes || now.title !== b.title
             || now.busy !== b.busy || now.task_status !== b.task_status) {
    await updateTimeBlock(blockId, {
      date: now.date, start_time: now.start_time, duration_minutes: now.duration_minutes, title: now.title,
      ...(now.busy !== undefined ? { busy: now.busy } : {}),
    })
  }
  return true
}

/** The day this block replaces is before the plan's series starts on Google
 *  (isBeforeSeriesStart): it stays off Google. */
async function beforeSeriesStart(row: SeriesRow, blockId: string): Promise<boolean> {
  return isBeforeSeriesStart(row, (await fetchTimeBlockWithTask(blockId))?.occurrence_date, todayStr())
}

async function carryOccurrence(planId: string, blockId: string): Promise<void> {
  const row = await fetchScheduleBlock(planId)
  if (!row.google_calendar_event_id || await beforeSeriesStart(row, blockId)) return
  const token = await ensureValidCalendarToken()
  const status = token ? await pushSeries(row, token, { fromEditor: false }) : 'unknown'
  // The day's own event only once the series left the day out — else Google
  // would show the session twice.
  if (status === 'unknown') { deferSeries(planId, blockId, { warn: true }); return }
  if (status === 'not_linked') return // the plan left Google: its day stays off it too
  // linkBlockCalendarEvent already said so when it failed: retry quietly.
  if (!(await linkDayEvent(blockId))) deferSeries(planId, blockId, { warn: false })
}

/**
 * A day of a plan on Google Calendar became a one-off block (142: done,
 * moved or skipped on Training / Daily). The database has already left that
 * day out (except_dates); here the series gets its EXDATE and — once Google
 * took it — the block its own event, so whatever happens to that day next
 * changes only that day. Runs in the background: the caller's save never
 * waits for it and a failure never undoes it.
 */
export function carryOccurrenceToCalendar(planId: string, blockId: string): void {
  void carryOccurrence(planId, blockId).catch(err => {
    logError(`Calendar series: a day of the plan not carried to Google Calendar: ${message(err)}`, { planId, blockId })
  })
}

/** A skipped day of a plan comes off Google ("moving or skipping one day
 *  changes only that day there"); the series keeps its EXDATE. Background. */
export function takeSkippedDayOffCalendar(blockId: string): void {
  void (async () => {
    const b = await fetchTimeBlockWithTask(blockId)
    if (!b?.schedule_block_id || !b.google_calendar_event_id) return
    await updateTimeBlock(blockId, { google_calendar_event_id: null })
  })().catch(err => logError(`Calendar: a skipped day's event not removed: ${message(err)}`, { blockId }))
}

/** Undo skip: the day of a plan on Google gets its own event back. Background. */
export function putSkippedDayBackOnCalendar(taskId: string): void {
  void (async () => {
    const b = await fetchTimeBlockByTaskId(taskId)
    if (!b?.schedule_block_id || b.google_calendar_event_id) return
    const plan = await fetchScheduleBlock(b.schedule_block_id)
    if (!plan.google_calendar_event_id || await beforeSeriesStart(plan, b.id)) return
    if (!(await linkDayEvent(b.id))) deferSeries(plan.id, b.id, { warn: false })
  })().catch(err => logError(`Calendar: a day put back not linked again: ${message(err)}`, { taskId }))
}

// ── When the app opens ───────────────────────────────────────────────────────

/** When the app opens with Google connected: the pushes Google didn't take
 *  (any kind) go again, then the monthly kinds whose RDATE list runs out
 *  within 90 days (needsHorizonTopUp) and the series linked before 148 (no
 *  start day stored: needsSeriesFromDay — pushed once from today, so Google
 *  drops the past weeks it was given). Quiet; what fails again waits. */
export async function topUpCalendarSeries(rows: readonly ScheduleBlock[]): Promise<void> {
  const token = await ensureValidCalendarToken()
  if (!token) return
  const quiet: PushMode = { fromEditor: false }
  const pushed = new Set<string>()
  for (const p of readPending()) {
    let keep: PendingSeries | null = null
    try {
      const row = rows.find(r => r.id === p.planId) ?? null
      const status = !row ? 'not_linked'
        : row.google_calendar_event_id ? await pushSeries(row, token, quiet)
        : p.relink ? await linkScheduleSeries(row.id, quiet)
        : 'not_linked'
      if (status === 'unknown') keep = p
      else if (status === 'linked') {
        pushed.add(p.planId)
        const left = []
        for (const b of p.blockIds) if (!(await linkDayEvent(b))) left.push(b)
        if (left.length) keep = { planId: p.planId, blockIds: left }
      }
    } catch (err) {
      keep = p
      logError(`Calendar series: retry failed: ${message(err)}`, { planId: p.planId })
    }
    // Re-read: a push of this run may have added to the list meanwhile.
    const others = readPending().filter(x => x.planId !== p.planId)
    writePending(keep ? [...others, keep] : others)
  }
  const today = todayStr()
  for (const row of rows) {
    if (!pushed.has(row.id) && (needsHorizonTopUp(row, today) || needsSeriesFromDay(row))) await pushSeries(row, token, quiet)
  }
}

// ── Every plan at once (148) ─────────────────────────────────────────────────

export interface AddPlansResult {
  added:  number
  /** Not taken by Google now: on the retry list (the next app open links them). */
  failed: number
}

/**
 * Settings → Subscriptions → Google, "Add plans to Calendar": every repeating
 * plan not on Google Calendar yet gets its series, one after another, with
 * the planner's own code (linkScheduleSeries — the same start rule: from
 * today, never the plan's past weeks). Quiet per plan; the caller reports
 * the counts once. A plan Google doesn't take now goes on the retry list as
 * a re-link (`relink`), so the next app open adds it. Throws only when there
 * is no Google connection to add with.
 */
export async function addPlansToCalendar(rows: readonly ScheduleBlock[]): Promise<AddPlansResult> {
  if (!(await ensureValidCalendarToken())) throw new Error('Google is not connected — connect it on this card first')
  const quiet: PushMode = { fromEditor: false }
  const result: AddPlansResult = { added: 0, failed: 0 }
  for (const row of plansToAddToCalendar(rows, todayStr())) {
    const status = await linkScheduleSeries(row.id, quiet)
    if (status === 'linked') result.added++
    else if (status === 'unknown') {
      result.failed++
      deferSeries(row.id, null, { relink: true, warn: false })
    }
  }
  return result
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

/** Undo: Google keeps a deleted event under its id, so a plan put back gets a
 *  new series (its zone stays). */
export const SERIES_EVENT_RESET: RowOverrides = { schedule_blocks: { google_calendar_event_id: null, google_calendar_horizon: null } }

/** After Undo: the plans that were on Google Calendar go back on it, in the
 *  zone they had. One that Google doesn't take now is retried when the app
 *  next opens (said once) — so Undo itself adds no note. */
export async function relinkRestoredSeriesEvents(snapshot: DeletedRows): Promise<string> {
  await Promise.all(withSeries(snapshot).map(async r => {
    if ((await linkScheduleSeries(r.id, { fromEditor: false })) === 'unknown') deferSeries(r.id, null, { relink: true, warn: true })
  }))
  return ''
}
