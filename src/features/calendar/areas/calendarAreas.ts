// The app's calendars in Apple Calendar, one per area (owner, 29.10.2026:
// docs/features/calendar-plan.md, Phase 2). Every value here is only a
// default — the owner changes them in Settings → Calendar ("every choice is a
// setting"). The block between the markers is copied verbatim into
// supabase/functions/icloud-calendar (verify-calendar-areas compares them):
// change it here, then copy it there.

// <calendar-areas>
export const AREA_KEYS = ['training', 'work', 'personal', 'media', 'football'] as const
export type AreaKey = typeof AREA_KEYS[number]

export interface CalendarArea {
  /** The calendar's name in Apple Calendar. */
  name:         string
  /** In front of each event's title ("🏋️ Lower B"); '' for none. */
  emoji:        string
  /** The calendar's colour, #RRGGBB. */
  color:        string
  /** The alert every event of the area gets, in minutes before it; null for none. */
  alertMinutes: number | null
  /** Off: the area gets no calendar of its own (one made earlier stays in iCloud). */
  enabled:      boolean
  /** Where the area's events go: Google Calendar (as before) or its Apple Calendar (Phase 2b). */
  app:          'google' | 'apple'
}

/** What an event's notes carry in Apple Calendar: the item's own notes and/or a link back to the app. */
export const NOTES_MODES = ['notes+link', 'notes', 'link', 'none'] as const
export type NotesMode = typeof NOTES_MODES[number]

/** An all-day event's alert: at a time on its day, or the day before (Apple's own "On day of event (9:00)"). */
export interface AllDayAlert { dayBefore: boolean; time: string }

export interface CalendarPrefs {
  areas:       Record<AreaKey, CalendarArea>
  /** For every app event (2b-3). */
  notes:       NotesMode
  /** null: an all-day event gets no alert (as before 2b-3). */
  allDayAlert: AllDayAlert | null
}

/** Quick picks for the default alert (minutes before; null = none); any whole number of minutes up to ALERT_MAX is a choice too. */
export const ALERT_CHOICES: readonly (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 120, 1440]
/** Four weeks: the longest alert the app sets. */
export const ALERT_MAX = 40320

/** A real alert choice: none, or whole minutes from 0 (at the start) to four weeks. */
export const isAlertMinutes = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= ALERT_MAX)

export const DEFAULT_AREAS: Record<AreaKey, CalendarArea> = {
  training: { name: 'Lasci · Training', emoji: '🏋️', color: '#FF9500', alertMinutes: 60, enabled: true, app: 'google' },
  work:     { name: 'Lasci · Work', emoji: '💼', color: '#007AFF', alertMinutes: 10, enabled: true, app: 'google' },
  personal: { name: 'Lasci · Personal', emoji: '🏠', color: '#34C759', alertMinutes: null, enabled: true, app: 'google' },
  media:    { name: 'Lasci · Media', emoji: '📺', color: '#AF52DE', alertMinutes: null, enabled: true, app: 'google' },
  football: { name: 'Lasci · Football', emoji: '⚽', color: '#FF3B30', alertMinutes: 15, enabled: true, app: 'google' },
}

const NAME_MAX = 60
/** Code points: a flag is 2, a family emoji up to about 10. */
const EMOJI_MAX = 12

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The saved settings, checked where they enter: a missing or wrong value falls back to its default. */
export function readCalendarPrefs(raw: unknown): CalendarPrefs {
  const saved = isRecord(raw) && isRecord(raw.areas) ? raw.areas : {}
  const areas = {} as Record<AreaKey, CalendarArea>
  for (const key of AREA_KEYS) {
    const d = DEFAULT_AREAS[key]
    const a = isRecord(saved[key]) ? saved[key] : {}
    const name = typeof a.name === 'string' ? a.name.trim() : ''
    const emoji = typeof a.emoji === 'string' ? a.emoji.trim() : null
    const color = typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.toUpperCase() : d.color
    const alert = 'alertMinutes' in a ? a.alertMinutes : undefined
    areas[key] = {
      name: name && name.length <= NAME_MAX ? name : d.name,
      emoji: emoji !== null && [...emoji].length <= EMOJI_MAX ? emoji : d.emoji,
      color,
      alertMinutes: alert !== undefined && isAlertMinutes(alert) ? alert : d.alertMinutes,
      enabled: typeof a.enabled === 'boolean' ? a.enabled : d.enabled,
      app: a.app === 'apple' || a.app === 'google' ? a.app : d.app,
    }
  }
  const top = isRecord(raw) ? raw : {}
  const notes = (NOTES_MODES as readonly unknown[]).includes(top.notes) ? top.notes as NotesMode : 'notes+link'
  const ada = isRecord(top.allDayAlert) ? top.allDayAlert : null
  const allDayAlert = ada && typeof ada.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(ada.time)
    ? { dayBefore: ada.dayBefore === true, time: ada.time } : null
  return { areas, notes, allDayAlert }
}

/** An area whose events go to Apple Calendar: switched to Apple and in use (an area not in use stays on Google). */
export const onApple = (area: Pick<CalendarArea, 'enabled' | 'app'>) => area.enabled && area.app === 'apple'

/** Where an area's calendar lives under the calendar home: fixed per area, so a rename never makes a second calendar. */
export const areaSlug = (key: AreaKey) => `lasci-${key}/`

/** Apple's calendar colour form, #RRGGBBAA. */
export const appleColor = (hex: string) => `${hex.toUpperCase()}FF`
// </calendar-areas>

/** What a saved choice is checked against in the form (the same limits readCalendarPrefs applies). */
export function areaProblem(a: CalendarArea): string | null {
  if (!a.name.trim()) return 'Give the calendar a name'
  if (a.name.trim().length > NAME_MAX) return `A name is at most ${NAME_MAX} characters`
  if ([...a.emoji.trim()].length > EMOJI_MAX) return 'Use one emoji (or none)'
  if (!/^#[0-9a-f]{6}$/i.test(a.color)) return 'Pick a colour'
  if (!isAlertMinutes(a.alertMinutes)) return `An alert is whole minutes, 0 to ${ALERT_MAX} (four weeks)`
  return null
}

/** "None", "At the start", "10 min before", "1 h 30 min before", "2 days before". */
export function alertLabel(minutes: number | null): string {
  if (minutes === null) return 'None'
  if (minutes === 0) return 'At the start'
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60
  const parts = [days ? `${days} day${days === 1 ? '' : 's'}` : '', hours ? `${hours} h` : '', mins ? `${mins} min` : ''].filter(Boolean)
  return `${parts.join(' ')} before`
}

/** An area whose calendar app the form changes (2b-2): its events move to Apple Calendar, or back to Google. */
export interface AreaSwitch { area: AreaKey; to: 'apple' | 'google' }

/** The areas whose events change app between the saved settings and the form — an area switched on or off counts
 *  too (an area not in use stays on Google). */
export function areaSwitches(saved: CalendarPrefs, next: CalendarPrefs): AreaSwitch[] {
  return AREA_KEYS.filter(k => onApple(saved.areas[k]) !== onApple(next.areas[k]))
    .map(k => ({ area: k, to: onApple(next.areas[k]) ? 'apple' as const : 'google' as const }))
}

/** A save that rewrites events already in Apple Calendar (177's trigger): every event's notes or all-day alert, or an
 *  area's emoji, alert or use. */
export function rewritesEvents(saved: CalendarPrefs, next: CalendarPrefs): boolean {
  return saved.notes !== next.notes || JSON.stringify(saved.allDayAlert) !== JSON.stringify(next.allDayAlert)
    || AREA_KEYS.some(k => (['emoji', 'alertMinutes', 'enabled'] as const).some(f => saved.areas[k][f] !== next.areas[k][f]))
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** What a switch did, in one line: where the items are now, and anything the owner must know. */
export function switchResultText(r: {
  toApple: number; toGoogle: number; notOnGoogle: number; foreign: number; failed: number; waiting: number; partial: boolean; problem?: string | null
}): string {
  const them = (count: number) => (count === 1 ? 'it' : 'them')
  const parts = [
    r.toApple ? `${n(r.toApple, 'item')} in Apple Calendar` : '',
    r.toGoogle ? `${n(r.toGoogle, 'item')} back in Google Calendar` : '',
    r.notOnGoogle ? `${n(r.notOnGoogle, 'item')} stayed in Apple Calendar (Google didn't take ${them(r.notOnGoogle)}; saving one puts it in Google Calendar)` : '',
    r.foreign ? `${n(r.foreign, 'item')} also still in Google Calendar (the app didn't make that copy, so it never deletes it: delete ${them(r.foreign)} there)` : '',
    r.failed ? `${n(r.failed, 'item')} not written yet (tried again within minutes)` : '',
    r.waiting && !r.failed ? `${r.waiting} still to go (within minutes)` : '',
    r.partial ? 'the area has more items than one move takes: the rest stay where they are' : '',
    r.problem ? `stopped: ${r.problem} — the rest goes within minutes` : '',
  ].filter(Boolean)
  return `Calendar settings saved · ${parts.length ? parts.join(' · ') : 'nothing to move'}`
}

/** A switch result the owner must act on or wait for. */
export const switchNeedsAttention = (r: { notOnGoogle: number; foreign: number; failed: number; partial: boolean; problem?: string | null }) =>
  !!(r.notOnGoogle || r.foreign || r.failed || r.partial || r.problem)

export const AREA_LABEL: Record<AreaKey, string> = {
  training: 'Training', work: 'Work (with Projects)', personal: 'Personal (tasks, repeats)', media: 'Media (episodes, films)', football: 'Football',
}
