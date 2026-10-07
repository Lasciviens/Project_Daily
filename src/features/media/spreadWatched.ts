// "Spread watched dates" — mark a run of episodes watched over a period you
// remember roughly (01.04.2020 → 07.06.2026, minus the years you stopped),
// with a believable day-by-day pattern: some days 3, some 1, many 0.
// Pure and import-free (scripts/verify-spread-watched.cjs).
//
// Days are plain yyyy-MM-dd strings stepped with UTC maths, so no time zone
// can move a day. Only the final timestamp (`at`) is built in local time.
//
// The plan, in order:
//   1. active days  = start…end minus breaks, minus weekdays turned off;
//   2. a mean per watch day (μ) from the style, and how many watch days (W);
//   3. which days: first and last active day always, the rest spread evenly
//      (steady/mixed) or at random (binge);
//   4. a count per watch day around μ, then corrected so the total is exact;
//   5. episodes handed out in order, nudged to their air date if needed;
//   6. evening times, one runtime apart.
// One seeded PRNG stream per step, so changing the time of day never moves
// an episode to another day, and the same inputs always give the same plan.

export type SpreadStyle = 'steady' | 'mixed' | 'binge'

export interface SpreadEpisode {
  season: number
  episode: number
  /** yyyy-MM-dd; null = unknown (treated as already aired). */
  airDate?: string | null
  /** Minutes; null = use the input's default runtime. */
  runtime?: number | null
}

export interface SpreadBreak { from: string; to: string }

export interface SpreadInput {
  start: string
  end: string
  breaks: SpreadBreak[]
  /** Monday first; false = never watched on that weekday. */
  weekdays: boolean[]
  style: SpreadStyle
  maxPerDay: number
  /** HH:MM, local time of the first episode of an evening. */
  startTime: string
  /** Default episode length in minutes. */
  runtime: number
  respectAirDates: boolean
  seed: number
}

export interface SpreadItem { season: number; episode: number; day: string; at: string }

export interface SpreadMonth { month: string; count: number; activeDays: number }

export interface SpreadStats {
  episodes: number
  activeDays: number
  watchDays: number
  /** Episodes per day on days with at least one. */
  perWatchDay: number
  /** Episodes per active day (the plain average). */
  perActiveDay: number
  /** Share of active days with at least one episode, 0–1. */
  shareOfDays: number
  /** Days inside the range left out by breaks. */
  breakDays: number
  firstDay: string
  lastDay: string
  /** The end used (an end in the future is today). */
  end: string
  movedToAirDate: number
  /** Most episodes on one day (can pass the cap after an air-date move). */
  busiestDay: number
  months: SpreadMonth[]
}

export type SpreadSuggestion =
  | { kind: 'maxPerDay'; value: number }
  | { kind: 'end'; value: string }

export type SpreadResult =
  | { ok: true; plan: SpreadItem[]; stats: SpreadStats }
  | { ok: false; error: string; suggestions: SpreadSuggestion[] }

export const DEFAULT_SPREAD: Omit<SpreadInput, 'start' | 'end' | 'seed'> = {
  breaks: [],
  weekdays: [true, true, true, true, true, true, true],
  style: 'mixed',
  maxPerDay: 6,
  startTime: '20:00',
  runtime: 45,
  respectAirDates: true,
}

const STYLE: Record<SpreadStyle, { k: number; min: number; spread: number }> = {
  steady: { k: 1, min: 1, spread: 0.35 },
  mixed:  { k: 1.3, min: 1.5, spread: 0.8 },
  binge:  { k: 2.2, min: 3, spread: 1.3 },
}

// ── days ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false
  const ms = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(ms) && toDay(ms) === s
}

function toMs(day: string): number { return Date.parse(`${day}T00:00:00Z`) }
function toDay(ms: number): string { return new Date(ms).toISOString().slice(0, 10) }
export function addDays(day: string, n: number): string { return toDay(toMs(day) + n * DAY_MS) }
export function daysBetween(a: string, b: string): number { return Math.round((toMs(b) - toMs(a)) / DAY_MS) }
/** 0 = Monday … 6 = Sunday. */
function weekday(day: string): number { return (new Date(toMs(day)).getUTCDay() + 6) % 7 }

/** Breaks clipped to [start, end], invalid ones dropped, overlaps merged. */
export function cleanBreaks(breaks: SpreadBreak[], start: string, end: string): SpreadBreak[] {
  const clipped = breaks
    .filter(b => isDay(b.from) && isDay(b.to))
    .map(b => (b.from <= b.to ? b : { from: b.to, to: b.from }))
    .map(b => ({ from: b.from < start ? start : b.from, to: b.to > end ? end : b.to }))
    .filter(b => b.from <= b.to)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const out: SpreadBreak[] = []
  for (const b of clipped) {
    const last = out[out.length - 1]
    if (last && b.from <= addDays(last.to, 1)) { if (b.to > last.to) last.to = b.to }
    else out.push({ ...b })
  }
  return out
}

function inBreak(day: string, breaks: SpreadBreak[]): boolean {
  return breaks.some(b => day >= b.from && day <= b.to)
}

/** Every day you may have watched on: start…end minus breaks and turned-off weekdays. */
export function activeDays(start: string, end: string, breaks: SpreadBreak[], weekdays: boolean[]): string[] {
  const out: string[] = []
  const clean = cleanBreaks(breaks, start, end)
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (weekdays[weekday(d)] === false) continue
    if (inBreak(d, clean)) continue
    out.push(d)
  }
  return out
}

// ── randomness ──────────────────────────────────────────────────────────

/** mulberry32: small, fast, good enough for a believable pattern. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from any text (e.g. a series id). */
export function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// ── the plan ────────────────────────────────────────────────────────────

/**
 * Plan watched dates for `episodes` (already in watching order). `today`
 * (yyyy-MM-dd) caps the end. `localIso` turns a local day + HH:MM into an
 * ISO timestamp; the default uses the runtime's own time zone.
 */
export function planSpread(
  input: SpreadInput,
  episodes: SpreadEpisode[],
  today: string,
  localIso: (day: string, hhmm: string) => string = defaultLocalIso,
): SpreadResult {
  const fail = (error: string, suggestions: SpreadSuggestion[] = []): SpreadResult => ({ ok: false, error, suggestions })
  if (!isDay(input.start) || !isDay(input.end)) return fail('Pick a start and an end date.')
  const end = input.end > today ? today : input.end
  if (input.start > end) return fail(input.start > today ? 'The start is in the future.' : 'The start is after the end.')
  const N = episodes.length
  if (N === 0) return fail('Nothing to mark — every episode in this range is already watched.')

  const cap = clamp(Math.round(input.maxPerDay) || 1, 1, 50)
  const breaks = cleanBreaks(input.breaks, input.start, end)
  const A = activeDays(input.start, end, breaks, input.weekdays)
  const D = A.length
  if (D === 0) return fail('No watching days left — check the dates, breaks and weekdays.')

  if (N > D * cap) {
    const suggestions: SpreadSuggestion[] = []
    const need = Math.ceil(N / D)
    if (need <= 50) suggestions.push({ kind: 'maxPerDay', value: need })
    // The first end date (≤ today) whose active days fit N at this cap.
    const want = Math.ceil(N / cap)
    let count = D
    for (let d = addDays(end, 1); d <= today; d = addDays(d, 1)) {
      if (input.weekdays[weekday(d)] === false || inBreak(d, input.breaks)) continue
      if (++count >= want) { suggestions.push({ kind: 'end', value: d }); break }
    }
    return fail(`${N} episodes don't fit in ${D} watching day${D === 1 ? '' : 's'} at ${cap} a day.`, suggestions)
  }

  const style = STYLE[input.style] ?? STYLE.mixed
  const r = N / D
  const mu = clamp(Math.max(r * style.k, style.min), 1, cap)
  const lo = Math.max(Math.ceil(N / cap), Math.min(2, D, N))
  const hi = Math.min(D, N)
  const W = clamp(Math.round(N / mu), lo, hi)

  // Which days (stream B).
  const randB = rng(input.seed ^ 0xb2)
  let watchIdx: number[]
  if (W === 1) watchIdx = [0]
  else if (W === D) watchIdx = A.map((_, i) => i)
  else {
    const inner = D - 2 // indices 1 … D-2
    const k = W - 2
    const picks: number[] = []
    if (input.style === 'binge') {
      const pool = Array.from({ length: inner }, (_, i) => i + 1)
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(randB() * (pool.length - i))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
        picks.push(pool[i])
      }
    } else {
      const size = inner / k
      for (let j = 0; j < k; j++) {
        const from = Math.floor(j * size)
        const to = Math.max(from, Math.floor((j + 1) * size) - 1)
        const span = to - from
        const u = input.style === 'steady' ? 0.5 + (randB() - 0.5) * 0.5 : randB()
        picks.push(1 + from + Math.round(u * span))
      }
    }
    watchIdx = [0, ...picks, D - 1].sort((a, b) => a - b)
  }

  // Counts per day (stream C), then exact total.
  const randC = rng(input.seed ^ 0xc3)
  const sigma = style.spread * Math.sqrt(mu)
  const counts = watchIdx.map(() => {
    const g = (randC() + randC() + randC() - 1.5) * 2
    return clamp(Math.round(mu + sigma * g), 1, cap)
  })
  let delta = N - counts.reduce((s, c) => s + c, 0)
  while (delta !== 0) {
    const pool: number[] = []
    for (let i = 0; i < counts.length; i++) if (delta > 0 ? counts[i] < cap : counts[i] > 1) pool.push(i)
    const i = pool[Math.floor(randC() * pool.length)]
    counts[i] += delta > 0 ? 1 : -1
    delta += delta > 0 ? -1 : 1
  }

  // Episodes in order; an episode never before its air date.
  const days: string[] = []
  watchIdx.forEach((di, i) => { for (let c = 0; c < counts[i]; c++) days.push(A[di]) })
  let moved = 0
  if (input.respectAirDates) {
    let floor = ''
    for (let i = 0; i < N; i++) {
      const air = episodes[i].airDate
      let d = days[i]
      if (air && isDay(air) && d < air) { d = air > today ? today : air; moved++ }
      if (d < floor) d = floor
      days[i] = d
      floor = d
    }
  }

  // Times (stream D): an evening start ± jitter, one runtime (+5 min) apart.
  const randD = rng(input.seed ^ 0xd4)
  const [h0, m0] = parseTime(input.startTime)
  const jitter = input.style === 'binge' ? 60 : 20
  const plan: SpreadItem[] = []
  let i = 0
  let busiest = 0
  while (i < N) {
    const day = days[i]
    let j = i
    while (j < N && days[j] === day) j++
    const slots: number[] = []
    let t = 0
    for (let x = i; x < j; x++) { slots.push(t); t += Math.max(1, episodes[x].runtime ?? input.runtime) + 5 }
    let startMin = h0 * 60 + m0 + Math.round((randD() * 2 - 1) * jitter)
    if (input.style === 'binge' && j - i > 2) startMin -= 60 * Math.min(4, j - i - 2)
    const lastStart = startMin + slots[slots.length - 1]
    if (lastStart > 23 * 60 + 59) startMin -= lastStart - (23 * 60 + 59)
    startMin = Math.max(0, startMin)
    for (let x = i; x < j; x++) {
      const m = Math.min(23 * 60 + 59, startMin + slots[x - i])
      plan.push({ season: episodes[x].season, episode: episodes[x].episode, day, at: localIso(day, hhmm(m)) })
    }
    busiest = Math.max(busiest, j - i)
    i = j
  }
  // Two episodes that ended on 23:59 must still be apart: keep `at` increasing.
  for (let x = 1; x < plan.length; x++) {
    if (plan[x].at <= plan[x - 1].at) plan[x].at = new Date(Date.parse(plan[x - 1].at) + 60_000).toISOString()
  }

  const usedDays = new Set(plan.map(p => p.day))
  const rangeDays = daysBetween(input.start, end) + 1
  const breakDays = breaks.reduce((s, b) => s + daysBetween(b.from, b.to) + 1, 0)
  return {
    ok: true,
    plan,
    stats: {
      episodes: N,
      activeDays: D,
      watchDays: usedDays.size,
      perWatchDay: N / usedDays.size,
      perActiveDay: r,
      shareOfDays: Math.min(1, usedDays.size / D),
      breakDays: Math.min(breakDays, rangeDays),
      firstDay: plan[0].day,
      lastDay: plan[plan.length - 1].day,
      end,
      movedToAirDate: moved,
      busiestDay: busiest,
      months: monthStrip(input.start, end, A, plan),
    },
  }
}

function monthStrip(start: string, end: string, active: string[], plan: SpreadItem[]): SpreadMonth[] {
  const months: SpreadMonth[] = []
  const at = new Map<string, SpreadMonth>()
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); ) {
    const row = { month: m, count: 0, activeDays: 0 }
    months.push(row)
    at.set(m, row)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  for (const d of active) { const row = at.get(d.slice(0, 7)); if (row) row.activeDays++ }
  for (const p of plan) { const row = at.get(p.day.slice(0, 7)); if (row) row.count++ }
  return months
}

function parseTime(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return [20, 0]
  return [clamp(Number(m[1]), 0, 23), clamp(Number(m[2]), 0, 59)]
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Local day + HH:MM → ISO. A time a DST change skips is moved forward by Date itself. */
export function defaultLocalIso(day: string, time: string): string {
  const [h, m] = parseTime(time)
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m).toISOString()
}

// ── words ───────────────────────────────────────────────────────────────

/** The big line: "About 2 episodes a day" / "About one episode every 12 days". */
export function spreadHeadline(s: SpreadStats): string {
  if (s.perActiveDay >= 1) {
    const n = Math.round(s.perActiveDay * 10) / 10
    return `About ${fmt(n)} episode${n === 1 ? '' : 's'} a day`
  }
  const every = Math.round(1 / s.perActiveDay)
  return every <= 1 ? 'About one episode a day' : `About one episode every ${every} days`
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
