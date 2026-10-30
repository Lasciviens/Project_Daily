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

export interface CalendarPrefs { areas: Record<AreaKey, CalendarArea> }

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
  return { areas }
}

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

export const AREA_LABEL: Record<AreaKey, string> = {
  training: 'Training', work: 'Work (with Projects)', personal: 'Personal (tasks, repeats)', media: 'Media (episodes, films)', football: 'Football',
}
