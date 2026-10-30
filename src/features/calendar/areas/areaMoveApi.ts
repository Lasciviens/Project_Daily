// Switching an area between Google Calendar and Apple Calendar (2b-2, docs/features/calendar-plan.md). The owner's
// rule both ways: the new copy first, confirmed, then the old one goes — never the same event in both.
//   → Apple: the server queues the area's items (icloud-calendar 'move'); its drain puts each one in Apple Calendar,
//     then hands its Google copy to Google's delete queue (migration 175) — google-tasks-sync deletes it; it runs
//     once here at the end so that happens now, not in up to 20 minutes.
//   ← Google: the browser makes each item's Google Calendar copy (the same calls as a save); the drain then removes
//     the Apple copy of each one Google confirmed (175: the Google copy appearing queues it). One Google didn't take
//     keeps its Apple copy.
import { supabase } from '../../../integrations/supabase/client'
import { logError } from '../../../shared/utils/logError'
import { requireUser } from '../../../shared/utils/requireUser'
import { linkBlockCalendarEvent } from '../api/linkBlockCalendarEvent'
import { linkScheduleSeries } from '../api/scheduleSeriesCalendar'
import { drainICloudQueue, moveAreaToApple, setupICloudCalendars } from '../icloud/icloudApi'
import { runGoogleTasksSync } from '../../todo/api/googleTasksSync'
import { saveCalendarPrefsChanges } from './calendarPrefsApi'
import { rememberCalendarPrefs } from './calendarPrefsMemory'
import type { AreaKey, AreaSwitch, CalendarPrefs } from './calendarAreas'

export type MoveFrom = 'today' | 'all'

export interface SwitchPreview extends AreaSwitch {
  slots: number
  plans: number
  /** More items than one move reads (it says so; running it again moves the rest). */
  partial: boolean
}

const PAGE = 1000

/** The ids of an area's items that are in Apple Calendar now. */
async function appleItemIds(area: AreaKey): Promise<{ slots: string[]; plans: string[] }> {
  const read = async (table: 'time_blocks' | 'schedule_blocks') => {
    const ids: string[] = []
    for (let at = 0; ; at += PAGE) {
      const { data, error } = await supabase.from(table).select('id').eq('icloud_area', area).order('id').range(at, at + PAGE - 1)
      if (error) throw error
      ids.push(...(data ?? []).map(r => (r as { id: string }).id))
      if ((data ?? []).length < PAGE) return ids
    }
  }
  return { slots: await read('time_blocks'), plans: await read('schedule_blocks') }
}

/** How many items each switch moves: to Apple, those that want a calendar (from today, or all); back to Google,
 *  everything in that area's Apple calendar. */
export async function previewSwitches(switches: readonly AreaSwitch[], from: MoveFrom): Promise<SwitchPreview[]> {
  const out: SwitchPreview[] = []
  for (const s of switches) {
    if (s.to === 'apple') {
      const r = await moveAreaToApple(s.area, from, true)
      out.push({ ...s, slots: r.slots, plans: r.plans, partial: r.partial })
    } else {
      const ids = await appleItemIds(s.area)
      out.push({ ...s, slots: ids.slots.length, plans: ids.plans.length, partial: false })
    }
  }
  return out
}

/** A plan going back to Google keeps the start it had in Apple Calendar (its past days stay on the calendar). */
async function keepSeriesStart(planId: string): Promise<void> {
  const { id: userId } = await requireUser()
  const { data, error } = await supabase.from('schedule_blocks').select('icloud_from, google_calendar_from, google_calendar_event_id')
    .eq('id', planId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  const row = data as { icloud_from: string | null; google_calendar_from: string | null; google_calendar_event_id: string | null } | null
  if (!row?.icloud_from || row.google_calendar_from || row.google_calendar_event_id) return
  const { error: upError } = await supabase.from('schedule_blocks').update({ google_calendar_from: row.icloud_from })
    .eq('id', planId).eq('user_id', userId).is('google_calendar_event_id', null).is('google_calendar_from', null)
  if (upError) throw upError
}

export interface SwitchProgress { done: number; total: number }

export interface SwitchResult {
  /** In Apple Calendar now (its Google copy, if any, queued for removal). */
  toApple: number
  /** Back in Google Calendar (its Apple copy removed, or about to be). */
  toGoogle: number
  /** Google didn't take it now: it stays in Apple Calendar (saving it puts it in Google Calendar). */
  notOnGoogle: number
  /** Kept a Google Calendar copy the app didn't make: never deleted by the app, so it is in both until deleted there. */
  foreign: number
  /** Couldn't be written now: retried by the timer. */
  failed: number
  /** Still queued when this run stopped (the timer finishes it). */
  waiting: number
  partial: boolean
  /** Why sending stopped early (the timer goes on with the rest). */
  problem: string | null
}

/** Rounds of the drain one switch runs at most (each sends up to 25 items); the timer finishes anything left. */
const MAX_ROUNDS = 40
const BUSY_WAIT_MS = 3000
const message = (err: unknown) => (err as Error)?.message ?? String(err)

/**
 * Saves the settings, brings the area calendars up to date, then moves each switched area's items and sends the queue
 * until it is empty (or stops moving). Whatever fails before the first item moved puts the settings back as they were,
 * so an area is never left switched with nothing moved; after that, a problem stops the run and is reported (the
 * timer goes on). Never leaves an item in neither calendar.
 */
export async function switchAreas(previous: CalendarPrefs, next: CalendarPrefs, switches: readonly AreaSwitch[], from: MoveFrom,
  icloudConnected: boolean, onProgress: (p: SwitchProgress) => void): Promise<SwitchResult> {
  const toApple = switches.filter(x => x.to === 'apple')
  const toGoogle = switches.filter(x => x.to === 'google')
  const saved = await saveCalendarPrefsChanges(previous, next)
  // The Google calls read this, so an area back on Google is let through at once.
  rememberCalendarPrefs(saved)
  const result: SwitchResult = { toApple: 0, toGoogle: 0, notOnGoogle: 0, foreign: 0, failed: 0, waiting: 0, partial: false, problem: null }
  const putBack = async (err: unknown): Promise<never> => {
    try {
      rememberCalendarPrefs(await saveCalendarPrefsChanges(next, previous))
    } catch (undoErr) {
      logError(`Calendar: the settings could not be put back after a failed move: ${message(undoErr)}`, { action: 'calendar_switch' })
      throw new Error(`${message(err)} — and the settings could not be put back: set "Shows in" again`, { cause: undoErr })
    }
    throw new Error(`${message(err)} — nothing was moved; the settings are as before`, { cause: err })
  }
  let total = 0
  let done = 0
  let googleIds: { area: AreaKey; slots: string[]; plans: string[] }[]

  try {
    // The calendars must exist before an event can go in (a missing one keeps its items waiting); names and colours
    // edited with the switch reach Apple too. Moving back to Google never waits on iCloud.
    if (icloudConnected) {
      try {
        const setup = await setupICloudCalendars()
        const missing = setup.areas.filter(a => a.state === 'failed' && toApple.some(s => s.area === a.area))
        if (missing.length) throw new Error(`Apple Calendar didn't make ${missing.map(a => a.name).join(', ')} (${missing[0].detail ?? 'try again'})`)
      } catch (err) {
        if (toApple.length) throw err
        result.problem = `Apple Calendar not updated: ${message(err)}`
      }
    }
    for (const s of toApple) {
      const queued = await moveAreaToApple(s.area, from, false)
      total += queued.slots + queued.plans
      result.partial ||= queued.partial
    }
    googleIds = await Promise.all(toGoogle.map(async s => ({ area: s.area, ...(await appleItemIds(s.area)) })))
  } catch (err) {
    return putBack(err)
  }
  total += googleIds.reduce((sum, g) => sum + g.slots.length + g.plans.length, 0)
  onProgress({ done, total })

  for (const g of googleIds) {
    for (const id of g.slots) {
      const status = await linkBlockCalendarEvent(id)
      if (status === 'linked') result.toGoogle++
      else result.notOnGoogle++
      onProgress({ done: ++done, total })
    }
    for (const id of g.plans) {
      await keepSeriesStart(id).catch(err => logError(`Calendar: a series' start not kept: ${message(err)}`, { planId: id }))
      const status = await linkScheduleSeries(id, { fromEditor: false })
      if (status === 'linked') result.toGoogle++
      else result.notOnGoogle++
      onProgress({ done: ++done, total })
    }
  }

  // The queue: each Apple copy written (→ Apple) or removed once its Google copy is there (← Google).
  let moved = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let r: Awaited<ReturnType<typeof drainICloudQueue>>
    try {
      r = await drainICloudQueue()
    } catch (err) {
      // Nothing reached Apple yet (the password refused, iCloud down): the switch to Apple is undone, nothing moved.
      if (toApple.length && !toGoogle.length && result.toApple === 0) return putBack(err)
      result.problem = message(err)
      break
    }
    if ('busy' in r) { await new Promise(res => setTimeout(res, BUSY_WAIT_MS)); continue }
    const handled = r.put + r.moved + r.foreign + r.kept + r.removed + r.none
    result.toApple += r.put + r.moved + r.foreign
    result.foreign += r.foreign
    result.failed += r.failed
    result.waiting = r.waiting
    moved += r.moved
    if (toApple.length) onProgress({ done: Math.min(total, done + result.toApple), total })
    if (r.waiting === 0 || handled === 0) break
  }

  // Google's copies of what moved go now (the server's delete queue), not on its next 20-minute run.
  if (moved) await runGoogleTasksSync().catch(err => logError(`Calendar: Google's copies not removed yet (the timer does it): ${message(err)}`, { action: 'calendar_switch' }))
  return result
}
