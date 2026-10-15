// ─────────────────────────────────────────────────────────────────────────────
//  Quick add — "Gym 17:30 1h every Mon Wed Fri" read into an item's parts
//  (owner, 15.10.2026). Rule-based, English words and digits, no AI. The Add
//  sheet's title and Home's quick add use this one parser; both show what it
//  read on a "Read as" line, and "Keep text" turns it off for that entry.
//
//  What it reads (each at most once, the first one wins):
//    time    17:30 · 7:05 · at 17:30 · 5pm · 5:30 pm · 17:30-18:30 (also a
//            length) · from 9:00 to 10:30
//    length  1h · 1.5h · 1,5h · 90m · 90min · 1h30 · 1h30m · 45 min · 2 hours
//            (with or without "for")
//    date    today · tomorrow (tmrw, tmr) · a weekday (the next one from
//            today, today included; "next fri" = the next one after today) ·
//            15.10 (this year, next year once it has passed) · 15.10.2026
//            (with or without "on" / "from")
//    repeat  every day · daily · weekdays · every weekday · every weekend ·
//            every week · weekly · every Mon Wed Fri (commas, "and", "/") ·
//            every 2 weeks [on Tue Thu] · every other week · every 3 days ·
//            every month · monthly · every 2 months
//  What it never reads: a bare number ("Buy 3 eggs", "Call 112", "at 5"); a
//  dotted pair with a one-digit month ("version 1.2"); "sun", "sat" and "wed"
//  on their own (English words — "on sat" reads); "daily", "weekly" and
//  "monthly" as the first word ("Weekly report" is a title).
//
//  Pure and import-free (scripts/verify-quick-add.cjs runs it through sucrase).
// ─────────────────────────────────────────────────────────────────────────────

/** A repeat as read: the contract's RepeatInput without its start (the sheet's date is the start). */
export interface QuickRepeat {
  kind: 'weekly' | 'monthly' | 'interval'
  /** 0 = Sunday … 6 = Saturday. Left out when the text named no day ("every week"): the start's weekday. */
  daysOfWeek?: number[]
  interval?: number
  unit?: 'day' | 'week' | 'month'
}

export interface QuickAddResult {
  /** The text with the read words taken out. May be empty ("tomorrow 17:30"). */
  title: string
  /** YYYY-MM-DD */
  date?: string
  /** HH:MM */
  time?: string
  durationMinutes?: number
  repeat?: QuickRepeat
  /** The words read, as typed, in text order. */
  read: string[]
}

const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}
/** Short forms that are also English words: read only after on / next / every. */
const NEEDS_PREFIX = new Set(['sun', 'sat', 'wed', 'weds'])
const LIST_JOINERS = new Set(['and', '&', ',', '/', '+'])
const HOUR_UNITS = new Set(['h', 'hr', 'hrs', 'hour', 'hours'])
const MINUTE_UNITS = new Set(['m', 'min', 'mins', 'minute', 'minutes'])
const MAX_EVERY = 99
const MAX_MINUTES = 1440

const pad = (n: number) => String(n).padStart(2, '0')

/** Lower case, without punctuation that only ends a phrase. */
function norm(word: string): string {
  return word.toLowerCase().replace(/^[("']+/, '').replace(/[)"'!?;:,.]+$/, '')
}

// ── Days ─────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
function dayNumber(iso: string): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS)
}
function isoOf(n: number): string {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function weekdayOf(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7
}
function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** "15.10" / "15.10.2026" / "5.10" — a two-digit month, so "1.2" (a version) stays text. */
function dottedDate(word: string, today: string): string | null {
  const m = /^(\d{1,2})\.(\d{2})(?:\.(\d{4}))?\.?$/.exec(word)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2])
  if (m[3]) return realDate(Number(m[3]), month, day)
  const year = Number(today.slice(0, 4))
  const thisYear = realDate(year, month, day)
  if (thisYear && thisYear >= today) return thisYear
  return realDate(year + 1, month, day) ?? thisYear
}

/** The weekday word, or null. `prefixed`: after on / next / every, where every short form reads. */
function weekdayWord(word: string, prefixed: boolean): number | null {
  const w = norm(word)
  if (!(w in WEEKDAY_WORDS)) return null
  if (!prefixed && NEEDS_PREFIX.has(w)) return null
  return WEEKDAY_WORDS[w]
}

/** "mon,wed,fri" / "mon/wed" in one word. */
function weekdayGlued(word: string): number[] | null {
  const parts = word.toLowerCase().split(/[,/+]/).map(norm).filter(Boolean)
  if (parts.length < 2) return null
  const days = parts.map(p => weekdayWord(p, true))
  return days.every(d => d != null) ? (days as number[]) : null
}

const sortDays = (days: number[]) => [...new Set(days)].sort((a, b) => a - b)

// ── Times and lengths ────────────────────────────────────────────────────────

function clock(h: number, m: number): string | null {
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? `${pad(h)}:${pad(m)}` : null
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** "17:30", "7:05", "5pm", "5:30pm" — one word. A bare number is never a time. */
function timeWord(word: string): string | null {
  const w = norm(word).replace(/\./g, '')
  let m = /^(\d{1,2}):(\d{2})$/.exec(w)
  if (m) return clock(Number(m[1]), Number(m[2]))
  m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(w)
  if (m) return twelveHour(Number(m[1]), Number(m[2] ?? 0), m[3])
  return null
}
function twelveHour(h: number, min: number, half: string): string | null {
  if (h < 1 || h > 12) return null
  return clock(half === 'pm' ? (h % 12) + 12 : h % 12, min)
}

/** "1h", "1.5h", "90m", "90min", "1h30", "1h30m" — one word. */
function lengthWord(word: string): number | null {
  const w = norm(word)
  let m = /^(\d+(?:[.,]\d+)?)(h|hr|hrs|hour|hours)$/.exec(w)
  if (m) return minutesInRange(Number(m[1].replace(',', '.')) * 60)
  m = /^(\d+)(m|min|mins|minute|minutes)$/.exec(w)
  if (m) return minutesInRange(Number(m[1]))
  m = /^(\d+)h(\d{1,2})m?$/.exec(w)
  if (m) return Number(m[2]) < 60 ? minutesInRange(Number(m[1]) * 60 + Number(m[2])) : null
  return null
}
function minutesInRange(n: number): number | null {
  const r = Math.round(n)
  return r >= 1 && r <= MAX_MINUTES ? r : null
}

// ── The scan ─────────────────────────────────────────────────────────────────

interface Hit { take: number; apply: (r: QuickAddResult) => void }
type Matcher = (words: string[], i: number, ctx: { today: string; first: boolean; r: QuickAddResult }) => Hit | null

const isNum = (w: string) => /^\d+$/.test(norm(w))

/** A list of weekdays from words[i]: "mon wed fri", "mon, wed and fri", "mon/wed". */
function dayList(words: string[], i: number): { days: number[]; take: number } | null {
  const glued = words[i] ? weekdayGlued(words[i]) : null
  if (glued) return { days: glued, take: 1 }
  const days: number[] = []
  let j = i
  let end = i
  while (j < words.length) {
    const d = weekdayWord(words[j], true)
    if (d != null) {
      days.push(d)
      j++
      end = j
      // "Mon," ends with a comma: the list goes on.
      continue
    }
    if (days.length > 0 && LIST_JOINERS.has(norm(words[j]) || words[j]) && j + 1 < words.length && weekdayWord(words[j + 1], true) != null) {
      j++
      continue
    }
    break
  }
  return days.length ? { days, take: end - i } : null
}

const repeatMatcher: Matcher = (words, i, { first }) => {
  const w = norm(words[i])
  const days = (d: number[]): QuickRepeat => ({ kind: 'weekly', daysOfWeek: sortDays(d) })
  const single = (repeat: QuickRepeat): Hit => ({ take: 1, apply: r => { r.repeat = repeat } })
  if (w === 'everyday') return single(days([0, 1, 2, 3, 4, 5, 6]))
  if (w === 'weekdays') return single(days([1, 2, 3, 4, 5]))
  if (!first) {
    if (w === 'daily') return single(days([0, 1, 2, 3, 4, 5, 6]))
    if (w === 'weekly') return withDays(words, i, 1, { kind: 'weekly' })
    if (w === 'monthly') return single({ kind: 'monthly' })
  }
  if (w !== 'every' || i + 1 >= words.length) return null
  const next = norm(words[i + 1])
  if (next === 'day') return { take: 2, apply: r => { r.repeat = days([0, 1, 2, 3, 4, 5, 6]) } }
  if (next === 'weekday' || next === 'weekdays') return { take: 2, apply: r => { r.repeat = days([1, 2, 3, 4, 5]) } }
  if (next === 'weekend' || next === 'weekends') return { take: 2, apply: r => { r.repeat = days([0, 6]) } }
  if (next === 'week') return withDays(words, i, 2, { kind: 'weekly' })
  if (next === 'month') return { take: 2, apply: r => { r.repeat = { kind: 'monthly' } } }
  if (next === 'other' && i + 2 < words.length) {
    const unit = unitWord(words[i + 2])
    if (unit) return withDays(words, i, 3, { kind: 'interval', interval: 2, unit })
  }
  if (isNum(words[i + 1]) && i + 2 < words.length) {
    const n = Number(norm(words[i + 1]))
    const unit = unitWord(words[i + 2])
    if (unit && n >= 1 && n <= MAX_EVERY) {
      if (n === 1) {
        if (unit === 'day') return { take: 3, apply: r => { r.repeat = days([0, 1, 2, 3, 4, 5, 6]) } }
        if (unit === 'month') return { take: 3, apply: r => { r.repeat = { kind: 'monthly' } } }
        return withDays(words, i, 3, { kind: 'weekly' })
      }
      return withDays(words, i, 3, { kind: 'interval', interval: n, unit })
    }
  }
  const list = dayList(words, i + 1)
  if (list) return { take: 1 + list.take, apply: r => { r.repeat = days(list.days) } }
  return null
}

function unitWord(word: string): 'day' | 'week' | 'month' | null {
  const w = norm(word)
  if (w === 'day' || w === 'days') return 'day'
  if (w === 'week' || w === 'weeks') return 'week'
  if (w === 'month' || w === 'months') return 'month'
  return null
}

/** A weekly or every-N-weeks repeat may name its days: "every 2 weeks on Tue Thu". */
function withDays(words: string[], i: number, take: number, repeat: QuickRepeat): Hit {
  const weekish = repeat.kind === 'weekly' || repeat.unit === 'week'
  const at = i + take
  if (weekish && at < words.length) {
    const on = norm(words[at]) === 'on' ? 1 : 0
    const list = dayList(words, at + on)
    if (list) return { take: take + on + list.take, apply: r => { r.repeat = { ...repeat, daysOfWeek: sortDays(list.days) } } }
  }
  return { take, apply: r => { r.repeat = repeat } }
}

const rangeMatcher: Matcher = (words, i, { r }) => {
  if (r.durationMinutes !== undefined) return null
  const from = norm(words[i]) === 'from' ? 1 : 0
  const one = /^(\d{1,2}:\d{2})[-–](\d{1,2}:\d{2})$/.exec(norm(words[i + from] ?? ''))
  if (one) {
    const a = timeWord(one[1]), b = timeWord(one[2])
    return a && b ? range(a, b, 1 + from) : null
  }
  const a = words[i + from] ? timeWord(words[i + from]) : null
  const sep = norm(words[i + from + 1] ?? '')
  const b = words[i + from + 2] ? timeWord(words[i + from + 2]) : null
  if (a && b && (sep === '-' || sep === '–' || sep === 'to' || sep === 'until' || sep === 'till')) return range(a, b, 3 + from)
  return null
}
function range(a: string, b: string, take: number): Hit | null {
  const len = (minutesOf(b) - minutesOf(a) + 1440) % 1440
  if (len === 0) return null
  return { take, apply: r => { r.time = a; r.durationMinutes = len } }
}

const timeMatcher: Matcher = (words, i) => {
  const at = norm(words[i]) === 'at' ? 1 : 0
  const word = words[i + at]
  if (!word) return null
  // "5 pm", "5:30 pm" — a bare number reads only with am / pm after it.
  const half = norm(words[i + at + 1] ?? '').replace(/\./g, '')
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(norm(word))
  if (m && (half === 'am' || half === 'pm')) {
    const t2 = twelveHour(Number(m[1]), Number(m[2] ?? 0), half)
    return t2 ? { take: 2 + at, apply: r => { r.time = t2 } } : null
  }
  const t = timeWord(word)
  return t ? { take: 1 + at, apply: r => { r.time = t } } : null
}

const lengthMatcher: Matcher = (words, i) => {
  const lead = norm(words[i]) === 'for' ? 1 : 0
  const word = words[i + lead]
  if (!word) return null
  const one = lengthWord(word)
  if (one != null) return { take: 1 + lead, apply: r => { r.durationMinutes = one } }
  // "45 min", "2 hours" — the number reads only with its unit after it (never "m" alone).
  const unit = norm(words[i + lead + 1] ?? '')
  const n = Number(norm(word).replace(',', '.'))
  if (/^\d+(?:[.,]\d+)?$/.test(norm(word)) && unit !== 'm') {
    const mins = HOUR_UNITS.has(unit) ? minutesInRange(n * 60) : MINUTE_UNITS.has(unit) ? minutesInRange(n) : null
    if (mins != null) return { take: 2 + lead, apply: r => { r.durationMinutes = mins } }
  }
  return null
}

const dateMatcher: Matcher = (words, i, { today }) => {
  const w = norm(words[i])
  const set = (take: number, iso: string): Hit => ({ take, apply: r => { r.date = iso } })
  if (w === 'today' || w === 'tonight') return set(1, today)
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return set(1, isoOf(dayNumber(today) + 1))
  const lead = w === 'on' || w === 'next' || w === 'from' ? 1 : 0
  const word = words[i + lead]
  if (!word) return null
  const day = weekdayWord(word, lead === 1)
  if (day != null) {
    const ahead = (day - weekdayOf(today) + 7) % 7
    return set(1 + lead, isoOf(dayNumber(today) + (w === 'next' && ahead === 0 ? 7 : ahead)))
  }
  if (w === 'next') return null
  const dotted = dottedDate(norm(word), today)
  return dotted ? set(1 + lead, dotted) : null
}

const KINDS: { key: 'repeat' | 'time' | 'durationMinutes' | 'date'; match: Matcher }[] = [
  { key: 'repeat', match: repeatMatcher },
  { key: 'time', match: rangeMatcher },
  { key: 'time', match: timeMatcher },
  { key: 'durationMinutes', match: lengthMatcher },
  { key: 'date', match: dateMatcher },
]

/** What the text says, or null when it reads nothing (the text is all title). */
export function parseQuickAdd(text: string, today: string): QuickAddResult | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const r: QuickAddResult = { title: '', read: [] }
  const used = new Array<boolean>(words.length).fill(false)
  let i = 0
  while (i < words.length) {
    let hit: Hit | null = null
    for (const k of KINDS) {
      if (r[k.key] !== undefined) continue
      hit = k.match(words, i, { today, first: i === 0, r })
      if (hit) break
    }
    if (!hit) { i++; continue }
    hit.apply(r)
    r.read.push(words.slice(i, i + hit.take).join(' '))
    for (let j = i; j < i + hit.take; j++) used[j] = true
    i += hit.take
  }
  if (!r.read.length) return null
  r.title = words.filter((_, j) => !used[j]).join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[,;:\-–]\s*|\s*[,;:\-–]$/g, '').trim()
  return r
}
