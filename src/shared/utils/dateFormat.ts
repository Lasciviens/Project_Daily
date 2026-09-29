// The ONE user-visible date format (owner rule, 2026-09-29): DD.MM.YYYY
// ("29.09.2026"), times HH:MM (24h), ranges "21.09.2026 – 27.09.2026". A
// weekday word may lead a date ("Mon 29.09.2026"). Only chart axis ticks may
// drop the year ("29.09", `formatDayMonth`). Import-free on purpose so the
// sucrase verify scripts can require it.
//
// A bare 'yyyy-MM-dd' string is parsed as LOCAL midnight — `new Date('2026-09-29')`
// would be UTC midnight, i.e. the 28th west of UTC.

export type DateValue = Date | string | number

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n: number) => String(n).padStart(2, '0')

/** Parse a date value; 'yyyy-MM-dd' is local. Null when it isn't a real date. */
export function toLocalDate(d: DateValue | null | undefined): Date | null {
  if (d == null || d === '') return null
  let out: Date
  if (d instanceof Date) out = d
  else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    out = new Date(y, m - 1, day)
  } else out = new Date(d)
  return Number.isNaN(out.getTime()) ? null : out
}

/** "29.09.2026" ('' for a missing or invalid value). */
export function formatDate(d: DateValue | null | undefined): string {
  const x = toLocalDate(d)
  return x ? `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.${x.getFullYear()}` : ''
}

/** "14:05" (24h). */
export function formatTime(d: DateValue | null | undefined): string {
  const x = toLocalDate(d)
  return x ? `${pad(x.getHours())}:${pad(x.getMinutes())}` : ''
}

/** "29.09.2026 14:05". */
export function formatDateTime(d: DateValue | null | undefined): string {
  const x = toLocalDate(d)
  return x ? `${formatDate(x)} ${formatTime(x)}` : ''
}

/** "21.09.2026 – 27.09.2026"; one end alone when the other is missing or equal. */
export function formatDateRange(a: DateValue | null | undefined, b: DateValue | null | undefined): string {
  const from = formatDate(a)
  const to = formatDate(b)
  if (!from || !to || from === to) return from || to
  return `${from} – ${to}`
}

/** "Mon" / "Monday". */
export function formatWeekday(d: DateValue | null | undefined, style: 'short' | 'long' = 'short'): string {
  const x = toLocalDate(d)
  return x ? (style === 'long' ? WEEKDAY_LONG : WEEKDAY_SHORT)[x.getDay()] : ''
}

/** "Mon 29.09.2026" / "Monday 29.09.2026". */
export function formatWeekdayDate(d: DateValue | null | undefined, style: 'short' | 'long' = 'short'): string {
  const x = toLocalDate(d)
  return x ? `${formatWeekday(x, style)} ${formatDate(x)}` : ''
}

/** "29.09" — chart axis ticks ONLY, where there is no room for the year. */
export function formatDayMonth(d: DateValue | null | undefined): string {
  const x = toLocalDate(d)
  return x ? `${pad(x.getDate())}.${pad(x.getMonth() + 1)}` : ''
}

/** Monday → Sunday of a week, for weekly chart tooltips: "21.09.2026 – 27.09.2026". */
export function formatWeekRange(weekStart: DateValue): string {
  const s = toLocalDate(weekStart)
  if (!s) return ''
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)
  return formatDateRange(s, e)
}

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "September 2026" — a MONTH heading (calendar title), not a date. */
export function formatMonthYear(d: DateValue | null | undefined): string {
  const x = toLocalDate(d)
  return x ? `${MONTH_LONG[x.getMonth()]} ${x.getFullYear()}` : ''
}
