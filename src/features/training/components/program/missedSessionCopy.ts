import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { daysBetween } from '../../plan/nextSession'

/** "Fri 25 Sep" (en-GB, THEME §3) — built from two parts, because the
 *  one-call form adds a comma ("Fri, 25 Sep") that reads oddly mid-sentence. */
export function shortDay(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return formatWeekdayDate(d)
}

/** "today" / "tomorrow" / "Tue 29 Sep". */
export function plannedDayText(date: string, today: string): string {
  const d = daysBetween(today, date)
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : shortDay(date)
}
