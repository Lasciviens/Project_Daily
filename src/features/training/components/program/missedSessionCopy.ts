import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { daysBetween } from '../../plan/nextSession'

/** "Fri 25 Sep" (en-GB, THEME §3). */
export function shortDay(date: string): string {
  return fmtDateEnGB(new Date(`${date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "today" / "tomorrow" / "Tue 29 Sep". */
export function plannedDayText(date: string, today: string): string {
  const d = daysBetween(today, date)
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : shortDay(date)
}
