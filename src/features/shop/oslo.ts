// The Oslo day of a time — in a module of its own so the price words and the store rows read it without the grocery
// model (the Shop page's first download stays within its budget). Kassalapp's prices are Norway's, so their days are
// Oslo's, whatever zone the phone is in.
import { wallClockIn } from '../calendar/calendarEventRules'

const PRICE_ZONE = 'Europe/Oslo'

// Each check time is read once: a zone-aware read is slow, and a row's chip and
// the basket read the same prices on every render.
const checkDays = new Map<string, string | null>()

/** The Oslo day (yyyy-mm-dd) of a check time, or null for a missing or unreadable one. */
export function osloDay(at: string | null | undefined): string | null {
  if (typeof at !== 'string' || !at) return null
  let day = checkDays.get(at)
  if (day === undefined) {
    if (checkDays.size >= 1000) checkDays.clear()
    day = wallClockIn(at, PRICE_ZONE)?.date ?? null
    checkDays.set(at, day)
  }
  return day
}
