import type { CalendarSettings } from './calendarAreas'

// Settings → Calendar as last read or saved here (2b-2): the Google calls ask it which areas are on Apple without
// waiting on the network each time. Account-bound: sign-out forgets it (security/accountState.ts).
let known: { prefs: CalendarSettings; at: number } | null = null

export function rememberCalendarPrefs(prefs: CalendarSettings): void { known = { prefs, at: Date.now() } }
export function forgetCalendarPrefs(): void { known = null }
/** The remembered settings while they are younger than `freshMs`, else null. */
export function rememberedCalendarPrefs(freshMs: number): CalendarSettings | null {
  return rememberedCalendarPrefsRead(freshMs)?.prefs ?? null
}

/** The remembered settings with the time they were read or saved, while younger than `freshMs`, else null. */
export function rememberedCalendarPrefsRead(freshMs: number): { prefs: CalendarSettings; at: number } | null {
  return known && Date.now() - known.at < freshMs ? known : null
}
