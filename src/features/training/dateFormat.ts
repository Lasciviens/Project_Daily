import { formatDate, formatTime, formatWeekRange } from '../../shared/utils/dateFormat'
// Training's date/time formatters — thin names over the app-wide DD.MM.YYYY
// / HH:MM formatter (shared/utils/dateFormat.ts).

export function formatTrainingDate(d: Date): string {
  return formatDate(d)
}

export function formatTrainingTime(d: Date): string {
  return formatTime(d)
}

export function fmtTrainingDate(iso: string | null): string {
  return iso ? formatTrainingDate(new Date(iso)) : '—'
}

export function fmtTrainingTime(iso: string | null): string {
  return iso ? formatTrainingTime(new Date(iso)) : ''
}

export function fmtTrainingDateTime(iso: string | null): string {
  return iso ? `${formatTrainingDate(new Date(iso))} · ${formatTrainingTime(new Date(iso))}` : '—'
}

/** Monday→Sunday range for a week chart's tooltip ("03.08.2026 –
 *  09.08.2026") — a single date is ambiguous about what it means for a WEEKLY value (start?
 *  end? the day it was logged?), which real user confusion (2026-09-01)
 *  confirmed: several Progress-tab weekly charts showed a bare Monday date
 *  as the whole tooltip header. Every weekly chart's tooltip should use
 *  this instead of a single date; short single-date labels stay fine on
 *  the X-AXIS itself, where space is tight. */
export function fmtWeekRange(weekStartIso: string): string {
  return formatWeekRange(weekStartIso)
}

/** Current time in ms — the one clock read for render-time "last N days" windows. */
export function nowMs(): number {
  return Date.now()
}
