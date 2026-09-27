// Date labels and the "last night" rule for the Health page. PURE and
// import-free on purpose: scripts/verify-health-date-labels.cjs loads it
// through sucrase.
//
// Dates are local calendar days as 'yyyy-MM-dd' strings. The weekday is
// computed on a UTC midnight purely as a day counter, so no timezone or DST
// shift can move a date. Month names follow THEME.md §3 (three letters, en-GB
// day-first: "27 Sep", never "Sept" or "Sep 27").

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Parts { y: number; m: number; d: number }

function parts(date: string): Parts {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

function weekday(date: string): string {
  const { y, m, d } = parts(date)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** "27 Sep", or "27 Sep 2025" with the year. */
function dayMonth(date: string, withYear: boolean): string {
  const { y, m, d } = parts(date)
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

// ── The period navigator ─────────────────────────────────────────────────────

/** One day in the navigator: "Sun 27 Sep" ("Wed 30 Sep 2025" in another year). */
export function dayNavLabel(date: string, today: string): string {
  return `${weekday(date)} ${dayMonth(date, parts(date).y !== parts(today).y)}`
}

/**
 * A window [from, to] as dates only — no "Last 7 days" prefix, the period
 * control already says that. The year appears only when it isn't this year:
 *   same month   "21–27 Sep"            ("21–27 Sep 2025")
 *   same year    "29 Aug – 27 Sep"      ("29 Aug – 27 Sep 2025")
 *   two years    "30 Dec 2025 – 29 Mar 2026"
 */
export function spanLabel(from: string, to: string, today: string): string {
  if (from === to) return dayNavLabel(to, today)
  const f = parts(from), t = parts(to)
  if (f.y !== t.y) return `${dayMonth(from, true)} – ${dayMonth(to, true)}`
  const yr = t.y !== parts(today).y ? ` ${t.y}` : ''
  if (f.m === t.m) return `${f.d}–${t.d} ${MONTHS[t.m - 1]}${yr}`
  return `${dayMonth(from, false)} – ${dayMonth(to, false)}${yr}`
}

// ── Weekly bars ──────────────────────────────────────────────────────────────

/**
 * A Monday–Sunday week as a short range for chart ticks and tooltips —
 * "7–13 Jul", "29 Jun–5 Jul", "29 Dec–4 Jan" — so a weekly bar says which
 * seven days it counts instead of reading like a single date. Pass `today`
 * to add the year when the week isn't in this year (tooltips; ticks stay short).
 */
export function weekRangeLabel(weekStart: string, today?: string): string {
  const end = addDays(weekStart, 6)
  const f = parts(weekStart), t = parts(end)
  const thisYear = today ? parts(today).y : t.y
  if (f.y !== t.y) {
    return today && (f.y !== thisYear || t.y !== thisYear)
      ? `${dayMonth(weekStart, true)}–${dayMonth(end, true)}`
      : `${dayMonth(weekStart, false)}–${dayMonth(end, false)}`
  }
  const yr = t.y !== thisYear ? ` ${t.y}` : ''
  if (f.m === t.m) return `${f.d}–${t.d} ${MONTHS[t.m - 1]}${yr}`
  return `${dayMonth(weekStart, false)}–${dayMonth(end, false)}${yr}`
}

// ── Last night ───────────────────────────────────────────────────────────────

/**
 * The night that ENDED on `day` — nights are filed under the morning you woke
 * up, so the Health page's "last night" for a selected day is exactly the
 * night keyed to that day. Never falls back to an older night: a missing
 * night is reported as missing (nightMissingText), not replaced by whatever
 * was recorded last.
 */
export function nightEndingOn<T extends { date: string }>(nights: readonly T[], day: string): T | null {
  return nights.find(n => n.date === day) ?? null
}

/** "last night" on today, "that night" for a past day. */
export function nightNoun(day: string, today: string): string {
  return day === today ? 'last night' : 'that night'
}

/** "No sleep recorded last night" / "No sleep recorded that night". */
export function nightMissingText(day: string, today: string): string {
  return `No sleep recorded ${nightNoun(day, today)}`
}
