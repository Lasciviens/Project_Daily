import type { CalendarPrefs } from './calendarAreas'

// Settings → Calendar as last read or saved here (2b-2): the Google calls ask it which areas are on Apple without
// waiting on the network each time. Account-bound: sign-out forgets it (security/accountState.ts).
let known: { prefs: CalendarPrefs; at: number } | null = null

export function rememberCalendarPrefs(prefs: CalendarPrefs): void { known = { prefs, at: Date.now() } }
export function forgetCalendarPrefs(): void { known = null }
/** The remembered settings while they are younger than `freshMs`, else null. */
export function rememberedCalendarPrefs(freshMs: number): CalendarPrefs | null {
  return rememberedCalendarPrefsRead(freshMs)?.prefs ?? null
}

/** The remembered settings with the time they were read or saved, while younger than `freshMs`, else null. */
export function rememberedCalendarPrefsRead(freshMs: number): { prefs: CalendarPrefs; at: number } | null {
  return known && Date.now() - known.at < freshMs ? known : null
}
