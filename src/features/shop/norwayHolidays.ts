// Norway's public holidays (helligdager and the two høytidsdager, 1 and 17 May), computed — never a list of dates:
// Easter by the anonymous Gregorian algorithm (Meeus/Jones/Butcher), the days that hang on it, and the fixed days.
// A working day is Monday–Friday and no holiday; a legal deadline that falls on a Saturday, a Sunday or a holiday
// moves to the next working day (shop_law_rules.to_workday, migration 191). Days are calendar days (yyyy-mm-dd)
// on Oslo's calendar: no clock or zone takes part. Pure — scripts/verify-shop-stores.cjs checks 2026–2030.

export interface NorwayHoliday {
  /** yyyy-mm-dd */
  day: string
  /** English first, the Norwegian name after it. */
  name: string
}

const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** A real yyyy-mm-dd day as UTC midnight in ms, or null. */
function dayMs(day: string): number | null {
  const m = DAY_RE.exec(day)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return iso(ms) === day ? ms : null
}

/** Easter Sunday of a Gregorian year (1583–9999), else null. 2026: 05.04.2026. */
export function easterSunday(year: number): string | null {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) return null
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(Date.UTC(year, month - 1, day))
}

/** The days that hang on Easter: days after Easter Sunday. */
const FROM_EASTER: ReadonlyArray<[number, string]> = [
  [-3, 'Maundy Thursday (skjærtorsdag)'],
  [-2, 'Good Friday (langfredag)'],
  [0, 'Easter Sunday (første påskedag)'],
  [1, 'Easter Monday (andre påskedag)'],
  [39, 'Ascension Day (Kristi himmelfartsdag)'],
  [49, 'Whit Sunday (første pinsedag)'],
  [50, 'Whit Monday (andre pinsedag)'],
]

/** The fixed days: month, day. */
const FIXED: ReadonlyArray<[number, number, string]> = [
  [1, 1, 'New Year\'s Day (første nyttårsdag)'],
  [5, 1, 'Labour Day (arbeidernes dag)'],
  [5, 17, 'Constitution Day (grunnlovsdag)'],
  [12, 25, 'Christmas Day (første juledag)'],
  [12, 26, 'Boxing Day (andre juledag)'],
]

/** Norway's public holidays of a year, in day order ([] outside 1583–9999). */
export function norwayHolidays(year: number): NorwayHoliday[] {
  const easter = easterSunday(year)
  if (!easter) return []
  const e = dayMs(easter) as number
  const out: NorwayHoliday[] = [
    ...FROM_EASTER.map(([n, name]) => ({ day: iso(e + n * DAY_MS), name })),
    ...FIXED.map(([month, day, name]) => ({ day: iso(Date.UTC(year, month - 1, day)), name })),
  ]
  return out.sort((x, y) => x.day.localeCompare(y.day))
}

// Each year's days are worked out once (a deadline asks day after day).
const byYear = new Map<number, ReadonlyMap<string, string>>()
function holidaysOf(year: number): ReadonlyMap<string, string> {
  let map = byYear.get(year)
  if (!map) {
    if (byYear.size >= 200) byYear.clear()
    map = new Map(norwayHolidays(year).map(h => [h.day, h.name]))
    byYear.set(year, map)
  }
  return map
}

/** The holiday's name when `day` is one of Norway's public holidays, else null (also for a day that is no day). */
export function holidayName(day: string): string | null {
  if (dayMs(day) === null) return null
  return holidaysOf(Number(day.slice(0, 4))).get(day) ?? null
}

/** Monday–Friday and no public holiday. False for a day that is no day. */
export function isWorkingDay(day: string): boolean {
  const ms = dayMs(day)
  if (ms === null) return false
  const weekday = new Date(ms).getUTCDay()
  return weekday !== 0 && weekday !== 6 && holidayName(day) === null
}

/** `day` itself when it is a working day, else the next one (Easter: Thursday 02.04.2026 → Tuesday 07.04.2026). */
export function nextWorkingDay(day: string): string {
  let ms = dayMs(day)
  if (ms === null) throw new Error(`Not a day: ${day}`)
  // A week has five working days and no run of holidays and weekends is longer than five days.
  for (let n = 0; n < 14 && !isWorkingDay(iso(ms)); n++) ms += DAY_MS
  return iso(ms)
}
