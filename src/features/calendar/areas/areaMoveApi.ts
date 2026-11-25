// An area turned on in Settings → Calendar (2b-2, docs/features/calendar-plan.md; Apple Calendar only since 208): the
// server queues the area's items that want a calendar (icloud-calendar 'move') and its drain puts each one in the
// area's Apple calendar. An area turned off moves nothing: its events already in Apple Calendar stay there.
import { supabase } from '../../../integrations/supabase/client'
import { logError } from '../../../shared/utils/logError'
import { drainICloudQueue, moveAreaToApple, setupICloudCalendars } from '../icloud/icloudApi'
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

/** Whether any item of these areas is in Apple Calendar now; when it can't be read, yes (never undo a switch that may
 *  have moved something). */
async function anyInApple(areas: AreaKey[]): Promise<boolean> {
  for (const table of ['time_blocks', 'schedule_blocks'] as const) {
    const { data, error } = await supabase.from(table).select('id').in('icloud_area', areas).limit(1)
    if (error || (data ?? []).length) return true
  }
  return false
}

/** How many items each area turned on moves into Apple Calendar: those that want a calendar (from today, or all). */
export async function previewSwitches(switches: readonly AreaSwitch[], from: MoveFrom): Promise<SwitchPreview[]> {
  const out: SwitchPreview[] = []
  for (const s of switches) {
    const r = await moveAreaToApple(s.area, from, true)
    out.push({ ...s, slots: r.slots, plans: r.plans, partial: r.partial })
  }
  return out
}

export interface SwitchProgress { done: number; total: number }

export interface SwitchResult {
  /** In Apple Calendar now. */
  toApple: number
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
 * Saves the settings, brings the area calendars up to date, then queues each area turned on and sends the queue until
 * it is empty (or stops moving). Whatever fails before the first item moved puts the settings back as they were, so
 * an area is never left on with nothing moved; after that, a problem stops the run and is reported (the timer goes on).
 */
export async function switchAreas(previous: CalendarPrefs, next: CalendarPrefs, switches: readonly AreaSwitch[], from: MoveFrom,
  icloudConnected: boolean, onProgress: (p: SwitchProgress) => void): Promise<SwitchResult> {
  const saved = await saveCalendarPrefsChanges(previous, next)
  rememberCalendarPrefs(saved)
  const result: SwitchResult = { toApple: 0, failed: 0, waiting: 0, partial: false, problem: null }
  const putBack = async (err: unknown): Promise<never> => {
    try {
      rememberCalendarPrefs(await saveCalendarPrefsChanges(next, previous))
    } catch (undoErr) {
      logError(`Calendar: the settings could not be put back after a failed move: ${message(undoErr)}`, { action: 'calendar_switch' })
      throw new Error(`${message(err)} — and the settings could not be put back: turn the area off again`, { cause: undoErr })
    }
    throw new Error(`${message(err)} — nothing was moved; the settings are as before`, { cause: err })
  }
  let total = 0

  try {
    // The calendars must exist before an event can go in (a missing one keeps its items waiting); names and colours
    // edited with the switch reach Apple too.
    if (icloudConnected) {
      const setup = await setupICloudCalendars()
      const missing = setup.areas.filter(a => a.state === 'failed' && switches.some(s => s.area === a.area))
      if (missing.length) throw new Error(`Apple Calendar didn't make ${missing.map(a => a.name).join(', ')} (${missing[0].detail ?? 'try again'})`)
    }
    for (const s of switches) {
      const queued = await moveAreaToApple(s.area, from, false)
      total += queued.slots + queued.plans
      result.partial ||= queued.partial
    }
  } catch (err) {
    return putBack(err)
  }
  onProgress({ done: 0, total })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let r: Awaited<ReturnType<typeof drainICloudQueue>>
    try {
      r = await drainICloudQueue()
    } catch (err) {
      // Nothing reached Apple yet (the password refused, iCloud down): the switch is undone, nothing moved. A first run
      // that stopped part-way (iCloud's rate limit) may have moved some: then the switch stays, the timer sends the
      // rest, and the problem is said.
      if (result.toApple === 0 && !(await anyInApple(switches.map(s => s.area)))) return putBack(err)
      result.problem = message(err)
      break
    }
    if ('busy' in r) { await new Promise(res => setTimeout(res, BUSY_WAIT_MS)); continue }
    const handled = r.put + r.kept + r.removed + r.none
    result.toApple += r.put
    result.failed += r.failed
    result.waiting = r.waiting
    onProgress({ done: Math.min(total, result.toApple), total })
    if (r.waiting === 0 || handled === 0) break
  }
  return result
}
