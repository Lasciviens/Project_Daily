// ─────────────────────────────────────────────────────────────────────────────
//  Daily brief — a deterministic, rule-based summary of the day (no AI).
//
//  Pure and import-free so it is verifiable with scripts/verify-daily-brief.cjs.
//  useDailyBrief() gathers the inputs from existing hooks; this module only
//  decides what to say. The same data always produces the same brief, and a
//  section with nothing worth saying is left out rather than padded.
//
//  What it covers, in reading order: tasks · schedule · training · weather ·
//  food · watch · money. Wishes were dropped on the owner's call (they have
//  their own page and a Daily row); EUR/USD lives in the Currency widget only.
// ─────────────────────────────────────────────────────────────────────────────

export type BriefTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'

export interface BriefMediaRef { tmdbId: number; mediaType: 'movie' | 'tv' }

export interface BriefLine {
  text: string
  tone?: BriefTone
  /** In-app route the line links to. */
  href?: string
  /** Opens this title's media popup instead of a route. */
  media?: BriefMediaRef
}

export type BriefSectionId = 'day' | 'tasks' | 'schedule' | 'training' | 'nutrition' | 'watch' | 'money'

export interface BriefSection {
  id: BriefSectionId
  title: string
  lines: BriefLine[]
}

export interface DailyBrief {
  greeting: string
  /** One-line headline: the single most useful thing to know right now. */
  headline: BriefLine
  sections: BriefSection[]
}

export interface BriefTask { title: string; priority: 'low' | 'medium' | 'high'; overdue: boolean; dueTime?: string | null }

export interface BriefWeatherHour { time: string; temp: number; precip: number }

export interface BriefWeather {
  tempC: number
  label: string
  /** Rain in the current hour (mm). */
  precipMm: number
  windMs: number
  windDir?: string | null
  /** Rest of today, from the hourly forecast. */
  highC?: number
  lowC?: number
  /** Hourly points still inside today, starting with the current hour ('HH:00'). */
  hours?: BriefWeatherHour[]
  /** The next ~12 hourly points from the current hour, across midnight (the temperature outlook). */
  ahead?: BriefWeatherHour[]
  tomorrow?: { label: string; minC: number; maxC: number; precipMm: number } | null
}

export interface BriefNextEpisode {
  title: string
  tmdbId: number
  season: number | null
  episode: number | null
  episodeTitle?: string | null
  /** yyyy-MM-dd; a future date means it hasn't aired yet. */
  airDate?: string | null
  caughtUp?: boolean
}

export interface BriefWishlistTitle { title: string; tmdbId: number; mediaType: 'movie' | 'tv'; releaseDate: string | null }

export interface BriefInput {
  /** Local wall clock, 0–23 (+ fraction for minutes). */
  hour: number
  /** Local date, yyyy-MM-dd — air dates and the daily wishlist pick read it. */
  today?: string
  weather?: BriefWeather | null
  tasks?: { open: BriefTask[]; doneToday: number } | null
  schedule?: {
    next?: { title: string; startLabel: string; startHour: number; inProgress: boolean } | null
    remainingCount: number
  } | null
  training?: {
    today?: { title: string; startTime: string | null } | null
    next?: { title: string; date: string; dayLabel: string } | null
    daysSinceLastWorkout?: number | null
    weekSessions?: number | null
    weekTarget?: number | null
  } | null
  nutrition?: { kcal: number; kcalTarget: number; proteinG: number; proteinTarget: number; waterMl?: number; waterTarget?: number } | null
  watch?: { next?: BriefNextEpisode | null; wishlist?: BriefWishlistTitle[] } | null
  /** NOK → TRY: lira per krone, and its % move since yesterday. */
  nokTry?: { rate: number; changePct: number } | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const round = (n: number) => Math.round(n)
const deg = (n: number) => `${round(n) === 0 ? 0 : round(n)}°`
const pad2 = (n: number) => String(n).padStart(2, '0')
/** yyyy-MM-dd → DD.MM.YYYY without a Date (no timezone drift). */
const dmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}` }
const grouped = (n: number) => String(round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Winding down'
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

/** Overdue first, then priority, then earliest due time. */
export function pickFocusTask(tasks: BriefTask[]): BriefTask | null {
  if (!tasks.length) return null
  return [...tasks].sort((a, b) =>
    Number(b.overdue) - Number(a.overdue)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'),
  )[0]
}

// ── Weather ──────────────────────────────────────────────────────────────────

/**
 * Feels-like by the wind-chill formula (Environment Canada / MET Norway), only
 * where it applies: ≤ 10 °C with wind ≥ 1.4 m/s (5 km/h). Null otherwise.
 */
export function feelsLike(tempC: number, windMs: number): number | null {
  if (tempC > 10 || windMs < 1.4) return null
  const v = Math.pow(windMs * 3.6, 0.16)
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v
}

const RAIN_MM = 0.3
const DRY_MM = 0.1

/** One sentence about rain for the rest of today, from the hourly points. */
export function rainOutlook(w: BriefWeather): BriefLine | null {
  const hours = w.hours ?? []
  if (w.precipMm > 0.2) {
    const dry = hours.slice(1).find(h => h.precip < DRY_MM)
    return { text: dry ? `Raining now, dry from ${dry.time}.` : 'Raining now and for the rest of the day — take a jacket.', tone: 'info' }
  }
  const start = hours.findIndex(h => h.precip >= RAIN_MM)
  if (start >= 0) {
    let mm = 0
    let end = start
    while (end < hours.length && hours[end].precip >= DRY_MM) { mm += hours[end].precip; end++ }
    const until = end < hours.length ? ` until ${hours[end].time}` : ''
    const amount = mm >= 1 ? ` (about ${round(mm)} mm)` : ''
    return { text: `Rain from ${hours[start].time}${until}${amount} — take a jacket.`, tone: 'info' }
  }
  if (hours.length >= 3) return { text: 'No rain expected for the rest of the day.' }
  return null
}

const span = (a: number, b: number) => (round(a) === round(b) ? deg(a) : `${round(a) === 0 ? 0 : round(a)}–${deg(b)}`)

/**
 * How the temperature goes from here, in one plain sentence: the next few
 * hours as a range, then where it is heading and by when ("13–14° for the
 * next few hours, then cooling to 9° by 23:00."). Null with fewer than four
 * points ahead.
 */
export function temperatureOutlook(w: BriefWeather): string | null {
  const ahead = w.ahead ?? []
  if (ahead.length < 4) return null
  const near = ahead.slice(1, 4)
  const later = ahead.slice(4)
  const nMin = Math.min(...near.map(h => h.temp))
  const nMax = Math.max(...near.map(h => h.temp))
  const first = `${span(nMin, nMax)} for the next few hours`
  if (later.length === 0) return `${first[0].toUpperCase()}${first.slice(1)}.`
  const low = later.reduce((a, h) => (h.temp < a.temp ? h : a), later[0])
  const high = later.reduce((a, h) => (h.temp > a.temp ? h : a), later[0])
  const end = later[later.length - 1]
  let rest: string
  if (round(low.temp) <= round(nMin) - 2) rest = `then cooling to ${deg(low.temp)} by ${low.time}`
  else if (round(high.temp) >= round(nMax) + 2) rest = `then warming to ${deg(high.temp)} by ${high.time}`
  else rest = `then about the same until ${end.time}`
  return `${first[0].toUpperCase()}${first.slice(1)}, ${rest}.`
}

function daySection(i: BriefInput): BriefSection | null {
  const w = i.weather
  if (!w) return null
  const lines: BriefLine[] = []
  const parts = [`${deg(w.tempC)} now, ${w.label.toLowerCase()}`]
  const fl = feelsLike(w.tempC, w.windMs)
  if (fl != null && round(w.tempC) - round(fl) >= 2) parts.push(`feels like ${deg(fl)}`)
  if (w.windMs >= 4) parts.push(`wind ${round(w.windMs)} m/s${w.windDir && w.windDir !== '—' ? ` ${w.windDir}` : ''}`)
  lines.push({ text: parts.join(' · ') })
  const rain = rainOutlook(w)
  const wet = rain && rain.tone === 'info' ? rain : null
  const outlook = temperatureOutlook(w)
  if (outlook) lines.push({ text: wet ? outlook : `${outlook.slice(0, -1)}, and it stays dry.` })
  else if (w.highC != null && w.lowC != null && round(w.highC) !== round(w.lowC) && i.hour < 20) {
    lines.push({ text: `Rest of today ${deg(w.lowC)} to ${deg(w.highC)}.` })
  }
  if (wet) lines.push(wet)
  else if (!outlook && rain) lines.push(rain)
  if (w.tempC <= 0) lines.push({ text: 'Below freezing — watch for ice.', tone: 'warn' })
  if (w.windMs >= 10) lines.push({ text: `Strong wind, ${round(w.windMs)} m/s.`, tone: 'warn' })
  if (i.hour >= 18 && w.tomorrow) {
    const t = w.tomorrow
    const amount = `about ${round(t.precipMm)} mm`
    const wetT = t.precipMm < 1 ? '' : /rain|shower|sleet|drizzle|snow/i.test(t.label) ? ` (${amount})` : `, rain (${amount})`
    lines.push({ text: `Tomorrow ${deg(t.minC)} to ${deg(t.maxC)}, ${t.label.toLowerCase()}${wetT}.` })
  }
  return { id: 'day', title: 'Weather', lines }
}

// ── Tasks / schedule / training / food ──────────────────────────────────────

function tasksSection(i: BriefInput): BriefSection | null {
  const t = i.tasks
  if (!t) return null
  const overdue = t.open.filter(x => x.overdue).length
  const lines: BriefLine[] = []
  if (!t.open.length) {
    lines.push({ text: t.doneToday ? `All clear — ${plural(t.doneToday, 'task')} done today.` : 'Nothing on the list for today.', tone: 'success', href: '/daily' })
    return { id: 'tasks', title: 'Tasks', lines }
  }
  const high = t.open.filter(x => x.priority === 'high').length
  const parts = [`${plural(t.open.length, 'open task')}`]
  if (overdue) parts.push(`${overdue} overdue`)
  if (high) parts.push(`${high} high priority`)
  if (t.doneToday) parts.push(`${t.doneToday} done`)
  // Neutral on purpose: the headline already carries the overdue alert.
  lines.push({ text: parts.join(' · '), href: '/daily' })
  const focus = pickFocusTask(t.open)
  if (focus) lines.push({ text: `Start with “${focus.title}”${focus.overdue ? ' (overdue)' : focus.dueTime ? ` (due ${focus.dueTime.slice(0, 5)})` : ''}.`, href: '/daily' })
  return { id: 'tasks', title: 'Tasks', lines }
}

function scheduleSection(i: BriefInput): BriefSection | null {
  const s = i.schedule
  if (!s) return null
  if (s.next) {
    const after = s.remainingCount > 1 ? ` · ${s.remainingCount - 1} more today` : ''
    const text = s.next.inProgress ? `Now: ${s.next.title}${after}` : `Next: ${s.next.startLabel} ${s.next.title}${after}`
    return { id: 'schedule', title: 'Schedule', lines: [{ text, tone: s.next.inProgress ? 'info' : undefined, href: '/daily' }] }
  }
  if (i.hour < 22) return { id: 'schedule', title: 'Schedule', lines: [{ text: 'Nothing else scheduled today.', href: '/daily' }] }
  return null
}

function trainingSection(i: BriefInput): BriefSection | null {
  const t = i.training
  if (!t) return null
  const lines: BriefLine[] = []
  if (t.today) {
    lines.push({ text: `Training today${t.today.startTime ? ` at ${t.today.startTime.slice(0, 5)}` : ''}: ${t.today.title}`, tone: 'info', href: '/training' })
  } else if (t.daysSinceLastWorkout != null) {
    const d = t.daysSinceLastWorkout
    if (d === 0) lines.push({ text: 'Workout logged today — nice.', tone: 'success', href: '/training' })
    else if (d >= 4) lines.push({ text: `${plural(d, 'day')} since your last workout.`, tone: 'warn', href: '/training' })
    else lines.push({ text: `Rest day — last workout ${d === 1 ? 'yesterday' : `${d} days ago`}.`, href: '/training' })
    if (t.next) lines.push({ text: `Next planned: ${t.next.title}, ${t.next.dayLabel}.`, href: '/training' })
  } else if (t.next) {
    lines.push({ text: `Next planned: ${t.next.title}, ${t.next.dayLabel}.`, href: '/training' })
  }
  if (t.weekSessions != null && t.weekTarget) {
    const left = t.weekTarget - t.weekSessions
    lines.push({ text: left > 0 ? `${t.weekSessions} of ${t.weekTarget} sessions this week.` : `Weekly target reached (${t.weekSessions}/${t.weekTarget}).`, tone: left > 0 ? 'neutral' : 'success' })
  }
  return lines.length ? { id: 'training', title: 'Training', lines } : null
}

function nutritionSection(i: BriefInput): BriefSection | null {
  const n = i.nutrition
  if (!n || n.kcalTarget <= 0) return null
  const lines: BriefLine[] = []
  if (n.kcal === 0) {
    lines.push({ text: i.hour >= 11 ? 'Nothing logged yet today.' : `Target ${round(n.kcalTarget)} kcal · ${round(n.proteinTarget)} g protein.`, tone: i.hour >= 14 ? 'warn' : undefined, href: '/recipes' })
  } else {
    const left = n.kcalTarget - n.kcal
    const kcal = left >= 0 ? `${round(n.kcal)} / ${round(n.kcalTarget)} kcal (${round(left)} left)` : `${round(n.kcal)} kcal (${round(-left)} over target)`
    const pLeft = n.proteinTarget - n.proteinG
    const protein = n.proteinTarget > 0 ? (pLeft > 0 ? ` · protein ${round(pLeft)} g to go` : ' · protein target hit') : ''
    lines.push({ text: `${kcal}${protein}.`, tone: left < 0 ? 'warn' : undefined, href: '/recipes' })
  }
  if (n.waterTarget && n.waterMl != null && i.hour >= 12 && n.waterMl < n.waterTarget * (i.hour / 24)) {
    lines.push({ text: `Water ${(n.waterMl / 1000).toFixed(1)} L of ${(n.waterTarget / 1000).toFixed(1)} L — behind pace.`, tone: 'info' })
  }
  return { id: 'nutrition', title: 'Food', lines }
}

// ── Watch ────────────────────────────────────────────────────────────────────

/** Day of the year (1–366) for a yyyy-MM-dd string, without timezone math. */
export function dayOfYear(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const cum = [0, 31, leap ? 60 : 59, leap ? 91 : 90, leap ? 121 : 120, leap ? 152 : 151, leap ? 182 : 181, leap ? 213 : 212, leap ? 244 : 243, leap ? 274 : 273, leap ? 305 : 304, leap ? 335 : 334]
  return cum[m - 1] + d
}

/**
 * Today's wishlist pick: released titles only, in a stable order (by TMDB id),
 * rotating once a day — the same title all day, a different one tomorrow.
 */
export function pickWishlistTitle(list: BriefWishlistTitle[], today: string): BriefWishlistTitle | null {
  const out = list
    .filter(x => x.releaseDate && x.releaseDate.slice(0, 10) <= today)
    .sort((a, b) => a.tmdbId - b.tmdbId || a.mediaType.localeCompare(b.mediaType))
  if (!out.length) return null
  return out[dayOfYear(today) % out.length]
}

const epCode = (s: number, e: number) => `S${pad2(s)}E${pad2(e)}`

function airLabel(airDate: string, today: string): string {
  if (airDate === today) return 'airs today'
  // Tomorrow without a Date: today's day-of-year + 1 in the same year, else fall back to the date.
  const sameYear = airDate.slice(0, 4) === today.slice(0, 4)
  if (sameYear && dayOfYear(airDate) - dayOfYear(today) === 1) return 'airs tomorrow'
  return `airs ${dmy(airDate)}`
}

function watchSection(i: BriefInput): BriefSection | null {
  const w = i.watch
  if (!w) return null
  const today = i.today ?? ''
  const lines: BriefLine[] = []
  const n = w.next
  if (n && n.title) {
    const media: BriefMediaRef = { tmdbId: n.tmdbId, mediaType: 'tv' }
    if (n.caughtUp || n.season == null || n.episode == null) {
      lines.push({ text: `Caught up on ${n.title} — no new episode yet.`, tone: 'neutral', media })
    } else {
      const code = epCode(n.season, n.episode)
      const name = n.episodeTitle ? ` “${n.episodeTitle}”` : ''
      if (n.airDate && today && n.airDate > today) lines.push({ text: `Next episode: ${n.title} ${code} ${airLabel(n.airDate, today)}.`, media })
      else lines.push({ text: `Continue ${n.title}: ${code}${name}`, media })
    }
  }
  const pick = today ? pickWishlistTitle(w.wishlist ?? [], today) : null
  if (pick) {
    const year = pick.releaseDate ? `${pick.releaseDate.slice(0, 4)}, ` : ''
    lines.push({ text: `From your wishlist: ${pick.title} (${year}${pick.mediaType === 'movie' ? 'film' : 'series'})`, media: { tmdbId: pick.tmdbId, mediaType: pick.mediaType } })
  }
  return lines.length ? { id: 'watch', title: 'Watch', lines } : null
}

// ── Money ────────────────────────────────────────────────────────────────────

/** A plain observation about the NOK→TRY move — never advice. */
export function nokTryComment(changePct: number): BriefLine {
  const a = Math.abs(changePct)
  if (a < 0.1) return { text: 'About the same as yesterday.' }
  const pct = `${a.toFixed(1)}%`
  if (changePct > 0) return { text: `NOK up ${pct} against TRY since yesterday — your krone buys ${a >= 1 ? 'noticeably' : 'a bit'} more lira.`, tone: a >= 1 ? 'success' : undefined }
  return { text: `NOK down ${pct} against TRY since yesterday — your krone buys ${a >= 1 ? 'noticeably' : 'a bit'} less lira.`, tone: a >= 1 ? 'warn' : undefined }
}

function moneySection(i: BriefInput): BriefSection | null {
  const c = i.nokTry
  if (!c || !(c.rate > 0)) return null
  const lines: BriefLine[] = [{ text: `1 NOK = ${c.rate.toFixed(2)} TRY · 1,000 NOK ≈ ${grouped(c.rate * 1000)} TRY` }]
  if (Number.isFinite(c.changePct)) lines.push(nokTryComment(c.changePct))
  return { id: 'money', title: 'NOK → TRY', lines }
}

// ── Headline + assembly ──────────────────────────────────────────────────────

/** The single most useful sentence right now, in priority order. */
function headlineFor(i: BriefInput, sections: BriefSection[]): BriefLine {
  const overdue = i.tasks?.open.filter(t => t.overdue).length ?? 0
  if (overdue) return { text: `${plural(overdue, 'task')} overdue — clear ${overdue === 1 ? 'it' : 'them'} first.`, tone: 'danger', href: '/daily' }
  if (i.schedule?.next?.inProgress) return { text: `In progress: ${i.schedule.next.title}.`, tone: 'info', href: '/daily' }
  if (i.training?.today) return { text: `Training today${i.training.today.startTime ? ` at ${i.training.today.startTime.slice(0, 5)}` : ''}: ${i.training.today.title}.`, tone: 'info', href: '/training' }
  if (i.schedule?.next) return { text: `Next up at ${i.schedule.next.startLabel}: ${i.schedule.next.title}.`, href: '/daily' }
  const open = i.tasks?.open.length ?? 0
  if (open) return { text: `${plural(open, 'open task')} today.`, href: '/daily' }
  if (sections.length) return { text: 'A clear day — nothing urgent.', tone: 'success' }
  return { text: 'Nothing to report yet.', tone: 'neutral' }
}

export function buildDailyBrief(input: BriefInput): DailyBrief {
  const sections = [
    tasksSection(input), scheduleSection(input), trainingSection(input), daySection(input),
    nutritionSection(input), watchSection(input), moneySection(input),
  ].filter((s): s is BriefSection => !!s && s.lines.length > 0)
  const temp = input.weather ? `, ${deg(input.weather.tempC)}` : ''
  return { greeting: `${greetingFor(input.hour)}${temp}`, headline: headlineFor(input, sections), sections }
}
