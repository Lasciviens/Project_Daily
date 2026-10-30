// Which calendar app an item's event lives in (Phase 2b-2, docs/features/calendar-plan.md): its area's choice in
// Settings → Calendar. An area on Apple gets no Google Calendar event from the browser — the server writes its
// Apple one (icloud-calendar's drain, from the queue 173–175's triggers fill) — so every Google Calendar create
// asks here first, and a save sends the queue to Apple at once.
import { supabase } from '../../../integrations/supabase/client'
import { logError } from '../../../shared/utils/logError'
import { AREA_KEYS, onApple, type AreaKey, type CalendarPrefs } from './calendarAreas'
import { fetchCalendarPrefs } from './calendarPrefsApi'
import { rememberCalendarPrefs, rememberedCalendarPrefs } from './calendarPrefsMemory'
import { itemArea, type AreaInput } from './icloudEvents'
import { drainICloudQueue } from '../icloud/icloudApi'

const FRESH_MS = 60_000

async function prefsNow(): Promise<CalendarPrefs> {
  const remembered = rememberedCalendarPrefs(FRESH_MS)
  if (remembered) return remembered
  const prefs = await fetchCalendarPrefs()
  rememberCalendarPrefs(prefs)
  return prefs
}

export const anyAreaOnApple = (prefs: CalendarPrefs) => AREA_KEYS.some(k => onApple(prefs.areas[k]))

/** Whether any area is on Apple now (false when the settings can't be read: Google, as before). */
export async function anyAreaOnAppleNow(): Promise<boolean> {
  try { return anyAreaOnApple(await prefsNow()) } catch { return false }
}

/**
 * The area whose Apple calendar the item belongs in, or null when it goes to Google Calendar. Settings that can't
 * be read answer null (Google, as before): a Google copy made then is handed over by the drain once its Apple copy
 * is in. `input` is a function when reading it costs a request (a slot's task), so nothing is read while every
 * area is on Google.
 */
export async function appleAreaOf(input: AreaInput | (() => Promise<AreaInput>)): Promise<AreaKey | null> {
  try {
    const prefs = await prefsNow()
    if (!anyAreaOnApple(prefs)) return null
    const area = itemArea(typeof input === 'function' ? await input() : input)
    return onApple(prefs.areas[area]) ? area : null
  } catch (err) {
    logError(`Calendar: the item's area could not be read: ${(err as Error).message}`, { action: 'apple_area' })
    return null
  }
}

/** A slot's area input: its own category and origin, and its task's (read only when asked). */
export function slotAreaInput(slot: { category?: string | null; source_type?: string | null; task_id?: string | null }): () => Promise<AreaInput> {
  return async () => {
    if (!slot.task_id) return { category: slot.category, source_type: slot.source_type }
    const { data, error } = await supabase.from('tasks').select('source_type, domain, project_id, hevy_routine_id').eq('id', slot.task_id).maybeSingle()
    if (error) throw error
    return {
      category: slot.category, source_type: slot.source_type, task_source_type: data?.source_type,
      domain: data?.domain, project_id: data?.project_id, hevy_routine_id: data?.hevy_routine_id,
    }
  }
}

/** Where an item's Apple copy is now (its slot's or plan's icloud_area), null when it has none. */
export async function appleAreaNow(table: 'time_blocks' | 'schedule_blocks', id: string): Promise<string | null> {
  const { data, error } = await supabase.from(table).select('icloud_area').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as { icloud_area?: string | null } | null)?.icloud_area ?? null
}

export interface DrainOutcome {
  /** Another run (the timer, another tab) is sending the queue right now. */
  busy: boolean
  /** Why it couldn't be sent (not connected, the password refused, iCloud down); null when it was. */
  problem: string | null
  /** Changes made in Apple Calendar the app took (2c): the lists must be read again. */
  readBackApplied: number
  /** Calendars renamed or recoloured on the iPhone: Settings → Calendar must be read again. */
  calendarsRenamed: number
}

/** Sends what waits for Apple Calendar now; the timer catches whatever this misses within minutes. Quiet: the
 *  caller says what the item needs. */
export async function drainICloudNow(opts: { look?: boolean } = {}): Promise<DrainOutcome> {
  try {
    const r = await drainICloudQueue(opts.look === true)
    if ('busy' in r) return { busy: true, problem: null, readBackApplied: 0, calendarsRenamed: 0 }
    return { busy: false, problem: null, readBackApplied: r.readBack?.applied ?? 0, calendarsRenamed: r.readBack?.calendarsRenamed ?? 0 }
  } catch (err) {
    logError(`Apple Calendar: the queue was not sent: ${(err as Error).message}`, { action: 'icloud_drain' })
    return { busy: false, problem: (err as Error).message, readBackApplied: 0, calendarsRenamed: 0 }
  }
}

let soon: ReturnType<typeof setTimeout> | null = null
/** After a change the server queued (a tick, a repeat's day, a delete): one drain shortly after, when an area is on
 *  Apple. Several changes in a row share it. */
export function drainICloudSoon(): void {
  if (soon) clearTimeout(soon)
  soon = setTimeout(() => {
    soon = null
    void prefsNow().then(prefs => { if (anyAreaOnApple(prefs)) void drainICloudNow() })
      .catch(err => logError(`Apple Calendar: settings not read for the drain: ${(err as Error).message}`, { action: 'icloud_drain' }))
  }, 1500)
}
