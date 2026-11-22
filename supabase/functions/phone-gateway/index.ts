// phone-gateway — the single durable entry point for the iPhone (Shortcuts /
// Scriptable widgets). Authenticates by a static, revocable device secret
// (x-phone-secret === PHONE_GATEWAY_SECRET), acts as the single user
// (HEVY_USER_ID) SERVER-SIDE via the service-role key, and takes a flat
// { action, ... } body so the shortcuts stay simple (no nested JSON, no
// expiring JWT). Deterministic actions run directly here; the AI actions (ask,
// brief, sleep) call the `claude` function's phone jobs with the service key.
//
// Deploy with "Enforce JWT Verification" OFF (config.toml) — the secret is not a
// Supabase JWT, same pattern as hevy-sync/health-export-webhook. The
// service-role key NEVER leaves the server. Self-contained (no _shared imports).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-phone-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose outside JSON, read field by field all through this function
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d }
// The user's own calendar day (Europe/Oslo), never UTC: a log between 00:00
// and 01:00/02:00 local time used to land on yesterday.
const HOME_TZ = 'Europe/Oslo'
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: HOME_TZ })

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  serviceKey(),
)

// Insert a diary row as the single user. Handles the pre-061 schema (no status
// column) the same way the client does, so it never hard-fails on old schema.
// A 'status' column missing = pre-061 schema; callers fall back to the old
// (no-status) query shape so nothing breaks on an un-migrated DB.
const statusMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204') && /status/i.test(e.message ?? '')

async function insertFoodLog(userId: string, row: AnyRecord) {
  let { error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId, status: 'eaten' })
  if (statusMissing(error)) {
    ;({ error } = await supabase.from('food_log_entries').insert({ ...row, user_id: userId }))
  }
  return error
}

// <brief-shared>
// GENERATED from src/features/home/briefRules.ts by scripts/sync-brief-shared.mjs.
// Do not edit here — edit the source and re-run the script.
/* eslint-disable @typescript-eslint/no-unused-vars -- the function uses only part of this module (linted in src/) */

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

type BriefTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'

interface BriefMediaRef { tmdbId: number; mediaType: 'movie' | 'tv' }

interface BriefLine {
  text: string
  tone?: BriefTone
  /** In-app route the line links to. */
  href?: string
  /** Opens this title's media popup instead of a route. */
  media?: BriefMediaRef
}

type BriefSectionId = 'day' | 'tasks' | 'schedule' | 'training' | 'nutrition' | 'watch' | 'money'

/** The sections in reading order — `day` is the weather. */
const BRIEF_SECTION_ORDER: readonly BriefSectionId[] = ['tasks', 'schedule', 'training', 'day', 'nutrition', 'watch', 'money']

/** Each section's label (also on a section whose read failed). */
const BRIEF_SECTION_TITLE: Record<BriefSectionId, string> = {
  tasks: 'Tasks', schedule: 'Schedule', training: 'Training', day: 'Weather', nutrition: 'Food', watch: 'Watch', money: 'NOK → TRY',
}

interface BriefSection {
  id: BriefSectionId
  title: string
  lines: BriefLine[]
}

interface DailyBrief {
  greeting: string
  /** One-line headline: the single most useful thing to know right now. */
  headline: BriefLine
  sections: BriefSection[]
}

interface BriefTask { title: string; priority: 'low' | 'medium' | 'high'; overdue: boolean; dueTime?: string | null }

interface BriefWeatherHour { time: string; temp: number; precip: number }

interface BriefWeather {
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

interface BriefNextEpisode {
  title: string
  tmdbId: number
  season: number | null
  episode: number | null
  episodeTitle?: string | null
  /** yyyy-MM-dd; a future date means it hasn't aired yet. */
  airDate?: string | null
  caughtUp?: boolean
}

interface BriefWishlistTitle { title: string; tmdbId: number; mediaType: 'movie' | 'tv'; releaseDate: string | null }

interface BriefInput {
  /** Local wall clock, 0–23 (+ fraction for minutes). */
  hour: number
  /** Local date, yyyy-MM-dd — air dates and the daily wishlist pick read it. */
  today?: string
  weather?: BriefWeather | null
  tasks?: { open: BriefTask[]; doneToday: number } | null
  /** Reads that failed (not ones still on the way): the headline names them rather than "Nothing to report yet". */
  failedReads?: readonly ('tasks' | 'schedule')[]
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
const briefDmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}` }

function greetingFor(hour: number): string {
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Winding down'
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

/** Overdue first, then priority, then earliest due time. */
function pickFocusTask(tasks: BriefTask[]): BriefTask | null {
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
function feelsLike(tempC: number, windMs: number): number | null {
  if (tempC > 10 || windMs < 1.4) return null
  const v = Math.pow(windMs * 3.6, 0.16)
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v
}

const RAIN_MM = 0.3
const DRY_MM = 0.1

const hourOf = (time: string) => Number(time.slice(0, 2))
/** Rain that starts at or after this hour (and not within NEAR_HOURS) is evening rain: it says when, not "take a jacket". */
const EVENING_HOUR = 19
const NEAR_HOURS = 3
/** Overnight rain worth a word: after midnight, up to this hour of tomorrow morning. */
const MORNING_END = 9

/**
 * The first rain after midnight (up to 09:00), from the hourly points ahead —
 * they run past midnight, today's `hours` stop at it.
 */
function overnightRain(w: BriefWeather): BriefWeatherHour | null {
  const ahead = w.ahead ?? []
  let prev = -1
  let tomorrow = false
  for (const h of ahead) {
    const hr = hourOf(h.time)
    if (hr < prev) tomorrow = true
    prev = hr
    if (tomorrow && hr <= MORNING_END && h.precip >= RAIN_MM) return h
    if (tomorrow && hr > MORNING_END) break
  }
  return null
}

/**
 * One sentence about rain, matched to WHEN it falls (hours[0] is the current
 * hour): rain now → when it stops; rain within three hours or in the daytime →
 * take a jacket; rain that only starts in the evening (19:00+) → it stays dry
 * until then; no rain today but some overnight → a word about the morning.
 */
function rainOutlook(w: BriefWeather): BriefLine | null {
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
    const from = hours[start].time
    const to = end < hours.length ? hours[end].time : null
    const amount = mm >= 1 ? ` (about ${round(mm)} mm)` : ''
    if (start <= NEAR_HOURS) return { text: `Rain from ${from}${to ? ` until ${to}` : ''}${amount} — take a jacket.`, tone: 'info' }
    if (hourOf(from) >= EVENING_HOUR) {
      return { text: `${to ? `Rain ${from}–${to}` : `Rain from ${from}`}${amount} — dry until then.`, tone: 'info' }
    }
    return { text: `Rain from ${from}${to ? ` until ${to}` : ''}${amount} — take a jacket if you're out then.`, tone: 'info' }
  }
  const night = overnightRain(w)
  if (night) {
    const text = hourOf(night.time) >= 6
      ? `Dry for the rest of today; rain tomorrow morning from ${night.time} — a jacket for the morning.`
      : `Dry for the rest of today; rain overnight from ${night.time}, so expect wet streets in the morning.`
    return { text, tone: 'info' }
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
function temperatureOutlook(w: BriefWeather): string | null {
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
  return { id: 'day', title: BRIEF_SECTION_TITLE.day, lines }
}

// ── Tasks / schedule / training / food ──────────────────────────────────────

function tasksSection(i: BriefInput): BriefSection | null {
  const t = i.tasks
  if (!t) return null
  const overdue = t.open.filter(x => x.overdue).length
  const lines: BriefLine[] = []
  if (!t.open.length) {
    lines.push({ text: t.doneToday ? `All clear — ${plural(t.doneToday, 'task')} done today.` : 'Nothing on the list for today.', tone: 'success', href: '/daily' })
    return { id: 'tasks', title: BRIEF_SECTION_TITLE.tasks, lines }
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
  return { id: 'tasks', title: BRIEF_SECTION_TITLE.tasks, lines }
}

/** From this hour an empty schedule is left out: the line shows only with something still to come. */
const SCHEDULE_QUIET_FROM = 22

function scheduleSection(i: BriefInput): BriefSection | null {
  const s = i.schedule
  if (!s) return null
  if (s.next) {
    const after = s.remainingCount > 1 ? ` · ${s.remainingCount - 1} more today` : ''
    const text = s.next.inProgress ? `Now: ${s.next.title}${after}` : `Next: ${s.next.startLabel} ${s.next.title}${after}`
    return { id: 'schedule', title: BRIEF_SECTION_TITLE.schedule, lines: [{ text, tone: s.next.inProgress ? 'info' : undefined, href: '/daily' }] }
  }
  if (i.hour < SCHEDULE_QUIET_FROM) return { id: 'schedule', title: BRIEF_SECTION_TITLE.schedule, lines: [{ text: 'Nothing else scheduled today.', href: '/daily' }] }
  return null
}

/**
 * The sections every account's brief shows at this hour, whatever its data — what a first visit keeps room for
 * (THEME.md §5): the tasks (an empty list says so), food (the calorie target has a default) and, until 22:00, the
 * schedule ("Nothing else scheduled today."; after that only with something still to come).
 */
function alwaysShown(hour: number): ReadonlySet<BriefSectionId> {
  return new Set<BriefSectionId>(hour < SCHEDULE_QUIET_FROM ? ['tasks', 'schedule', 'nutrition'] : ['tasks', 'nutrition'])
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
  return lines.length ? { id: 'training', title: BRIEF_SECTION_TITLE.training, lines } : null
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
  return { id: 'nutrition', title: BRIEF_SECTION_TITLE.nutrition, lines }
}

// ── Watch ────────────────────────────────────────────────────────────────────

/** Day of the year (1–366) for a yyyy-MM-dd string, without timezone math. */
function dayOfYear(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const cum = [0, 31, leap ? 60 : 59, leap ? 91 : 90, leap ? 121 : 120, leap ? 152 : 151, leap ? 182 : 181, leap ? 213 : 212, leap ? 244 : 243, leap ? 274 : 273, leap ? 305 : 304, leap ? 335 : 334]
  return cum[m - 1] + d
}

/**
 * Today's wishlist pick: released titles only, in a stable order (by TMDB id),
 * rotating once a day — the same title all day, a different one tomorrow.
 */
function pickWishlistTitle(list: BriefWishlistTitle[], today: string): BriefWishlistTitle | null {
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
  return `airs ${briefDmy(airDate)}`
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
  return lines.length ? { id: 'watch', title: BRIEF_SECTION_TITLE.watch, lines } : null
}

// ── Money ────────────────────────────────────────────────────────────────────

/** A daily move under this (in %) is noise and is not mentioned. */
const NOK_TRY_NOTABLE_PCT = 1

/** A plain observation about a notable NOK→TRY move — never advice; null for an ordinary day. */
function nokTryComment(changePct: number): BriefLine | null {
  if (!Number.isFinite(changePct)) return null
  const a = Math.abs(changePct)
  if (a < NOK_TRY_NOTABLE_PCT) return null
  const pct = `${a.toFixed(1)}%`
  if (changePct > 0) return { text: `NOK up ${pct} against TRY since yesterday — your krone buys noticeably more lira.`, tone: 'success' }
  return { text: `NOK down ${pct} against TRY since yesterday — your krone buys noticeably less lira.`, tone: 'warn' }
}

function moneySection(i: BriefInput): BriefSection | null {
  const c = i.nokTry
  if (!c || !(c.rate > 0)) return null
  const lines: BriefLine[] = [{ text: `1 NOK = ${c.rate.toFixed(2)} TRY` }]
  const move = nokTryComment(c.changePct)
  if (move) lines.push(move)
  return { id: 'money', title: BRIEF_SECTION_TITLE.money, lines }
}

// ── Headline + assembly ──────────────────────────────────────────────────────

/**
 * The single most useful sentence right now, in priority order. "A clear day" only when both the tasks and the
 * schedule were read: without one (its read failed) it claims nothing about them, and says which one failed.
 */
function headlineFor(i: BriefInput, sections: BriefSection[]): BriefLine {
  const overdue = i.tasks?.open.filter(t => t.overdue).length ?? 0
  if (overdue) return { text: `${plural(overdue, 'task')} overdue — clear ${overdue === 1 ? 'it' : 'them'} first.`, tone: 'danger', href: '/daily' }
  if (i.schedule?.next?.inProgress) return { text: `In progress: ${i.schedule.next.title}.`, tone: 'info', href: '/daily' }
  if (i.training?.today) return { text: `Training today${i.training.today.startTime ? ` at ${i.training.today.startTime.slice(0, 5)}` : ''}: ${i.training.today.title}.`, tone: 'info', href: '/training' }
  if (i.schedule?.next) return { text: `Next up at ${i.schedule.next.startLabel}: ${i.schedule.next.title}.`, href: '/daily' }
  const open = i.tasks?.open.length ?? 0
  if (open) return { text: `${plural(open, 'open task')} today.`, href: '/daily' }
  if (sections.length && i.tasks && i.schedule) return { text: 'A clear day — nothing urgent.', tone: 'success' }
  if (i.failedReads?.includes('tasks')) return { text: 'Today\'s tasks couldn\'t be read.', tone: 'neutral' }
  if (i.failedReads?.includes('schedule')) return { text: 'Today\'s schedule couldn\'t be read.', tone: 'neutral' }
  return { text: 'Nothing to report yet.', tone: 'neutral' }
}

function buildDailyBrief(input: BriefInput): DailyBrief {
  const sections = [
    tasksSection(input), scheduleSection(input), trainingSection(input), daySection(input),
    nutritionSection(input), watchSection(input), moneySection(input),
  ].filter((s): s is BriefSection => !!s && s.lines.length > 0)
  const temp = input.weather ? `, ${deg(input.weather.tempC)}` : ''
  return { greeting: `${greetingFor(input.hour)}${temp}`, headline: headlineFor(input, sections), sections }
}

/* eslint-enable @typescript-eslint/no-unused-vars */
// </brief-shared>

// Latency design (iOS Shortcuts "Get Contents of URL" times out at ~25s):
// - every AI action is ONE model call with no tools: the context (today's
//   tasks, schedule, training, or last nights' sleep) is looked up HERE by
//   code and handed over as data, so there is no 2-4 turn tool loop.
// - the `claude` function gives the model 18s (its phone jobs' own limit) and
//   a 22s AbortController here returns a clean error BEFORE the ~25s client
//   cutoff instead of a silent hang.
// Each AI action goes to a job that only the phone may run (phone_ask); the function checks that, not this file.
// The brief is no AI job: fixed rules (buildPhoneBrief).

// yyyy-MM-dd, `days` from today (local calendar day, calendar-safe arithmetic).
function dateFromToday(days: number): string {
  const [y, m, d] = todayLocal().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// The `claude` function takes a context of at most 4000 characters (PHONE_LIMITS.context) and refuses a longer one,
// so the gateway keeps its own context under it: whole lines, the first ones (the date, the tasks, then the schedule
// and the training), never a line cut in half. Tasks and blocks are each limited to 20 rows, so this only bites on
// very long titles.
const BRIEF_CONTEXT_MAX = 3900
// A date for the model's context as the app shows it: DD.MM.YYYY (the stored form is yyyy-MM-dd).
function dmy(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso)
}
function capLines(lines: string[], max: number): string {
  const kept: string[] = []
  let size = 0
  for (const line of lines.join('\n').split('\n')) {
    const next = size + line.length + (kept.length ? 1 : 0)
    if (next > max) break
    kept.push(line)
    size = next
  }
  return kept.join('\n')
}
// The longest question `claude`'s phone_ask takes (PHONE_LIMITS.question).
const ASK_QUESTION_MAX = 1000

// Build a COMPACT brief context server-side (today's tasks + schedule + upcoming
// training) so the AI answers in ONE shot with no tool loop — mirrors the web
// daily-briefing's pre-built-context approach. Service role bypasses RLS, so
// every query is user-scoped EXPLICITLY. Best-effort: a failing section is
// omitted, never breaks the brief. Column names mirror briefingApi.ts.
async function buildBriefContext(userId: string): Promise<string> {
  const today = todayLocal()
  const lines: string[] = [`DATE: ${dmy(today)}`]
  try {
    const { data: tasks } = await supabase.from('tasks')
      .select('title, status, priority, domain, due_time')
      .eq('user_id', userId).or(`section.eq.today,due_date.eq.${today}`)
      .neq('status', 'cancelled').neq('status', 'done')
      .order('due_time', { ascending: true }).limit(20)
    if (tasks?.length) {
      lines.push(`\nTODAY'S TASKS (${tasks.length} open):`)
      for (const t of tasks as AnyRecord[]) {
        lines.push(`  - ${t.title} [${t.priority}${t.domain ? `, ${t.domain}` : ''}]${t.due_time ? ` @${String(t.due_time).slice(0, 5)}` : ''}`)
      }
    } else { lines.push('\nTODAY\'S TASKS: none') }
  } catch { /* omit section */ }
  try {
    // A skipped session (its task cancelled, migration 142) is not on today's program.
    // A slot with no length (busy false, 155: "do it at 14:00") shows no "(N min)" —
    // its stored minutes are nominal. Before 155 there is no busy column: read without it.
    const read = (cols: string) => supabase.from('time_blocks')
      .select(cols)
      .eq('user_id', userId).eq('date', today)
      .order('start_time', { ascending: true }).limit(20)
    const first = await read('title, start_time, duration_minutes, busy, task:tasks(status)')
    const blocksError = first.error
    let blocks = first.data
    if (blocksError && (blocksError.code === '42703' || blocksError.code === 'PGRST204')) {
      ;({ data: blocks } = await read('title, start_time, duration_minutes, task:tasks(status)'))
    }
    const withTime = (blocks as AnyRecord[] ?? []).filter(b => b.start_time && b.task?.status !== 'cancelled')
    if (withTime.length) {
      lines.push('\nSCHEDULE:')
      for (const b of withTime) lines.push(`  - ${String(b.start_time).slice(0, 5)} ${b.title}${b.duration_minutes && b.busy !== false ? ` (${b.duration_minutes} min)` : ''}`)
    }
  } catch { /* omit section */ }
  try {
    // Skipped (cancelled) and already trained (done) sessions are not upcoming.
    const { data: rows } = await supabase.from('time_blocks')
      .select('title, date, start_time, task:tasks(status)')
      .eq('user_id', userId).eq('category', 'training')
      .gte('date', today).lte('date', dateFromToday(14))
      .order('date', { ascending: true }).limit(15)
    const tr = (rows as AnyRecord[] ?? []).filter(b => !['cancelled', 'done'].includes(b.task?.status)).slice(0, 5)
    if (tr.length) {
      lines.push('\nUPCOMING TRAINING:')
      for (const s of tr as AnyRecord[]) lines.push(`  - ${dmy(s.date)}${s.start_time ? ` ${String(s.start_time).slice(0, 5)}` : ''} ${s.title}`)
    }
  } catch { /* omit section */ }
  return capLines(lines, BRIEF_CONTEXT_MAX)
}

// The phone's morning brief: the inputs of Home's brief as far as the gateway can read them, then the shared rules
// (buildDailyBrief) and a plain-text form for the Shortcut. A failing read leaves its section out (never a made-up
// line), and the headline then claims nothing about it (`failedReads`).
async function buildPhoneBrief(userId: string): Promise<string> {
  const today = todayLocal()
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: HOME_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const part = (t: string) => Number(clock.find(p => p.type === t)?.value ?? 0)
  const hour = part('hour') + part('minute') / 60
  const input: BriefInput = { hour, today }
  const failedReads: ('tasks' | 'schedule')[] = []
  // Tasks: the same three reads as Home's day list (fetchTasksForDay) and the same rules (taskRules.ts: isOpenTask, closedDay,
  // onDay, isOverdueOn), so the phone and Home agree on what is overdue and what is done today (owner-critic, 22.11.2026).
  try {
    const dayStart = oslo00(today), dayEnd = oslo00(dateFromToday(1))
    const cols = 'id, title, status, priority, due_date, due_time, section, completed_at, sort_order, created_at'
    const [dueToday, closedToday, openLate] = await Promise.all([
      supabase.from('tasks').select(cols).eq('user_id', userId).eq('due_date', today).neq('status', 'cancelled').limit(200),
      supabase.from('tasks').select(cols).eq('user_id', userId).gte('completed_at', dayStart).lt('completed_at', dayEnd).limit(200),
      supabase.from('tasks').select(cols).eq('user_id', userId).in('status', ['open', 'in_progress', 'waiting']).or(`due_date.lt.${today},and(due_date.is.null,section.eq.today)`).limit(200),
    ])
    for (const r of [dueToday, closedToday, openLate]) if (r.error) throw r.error
    const seen = new Set<string>()
    const rows: AnyRecord[] = []
    for (const r of [dueToday, closedToday, openLate]) for (const t of (r.data ?? []) as AnyRecord[]) if (!seen.has(String(t.id))) { seen.add(String(t.id)); rows.push(t) }
    const isOpen = (t: AnyRecord) => ['open', 'in_progress', 'waiting'].includes(t.status)
    const closedDay = (t: AnyRecord) => (t.status === 'done' || t.status === 'cancelled') && t.completed_at ? osloDayOf(String(t.completed_at)) : null
    const onDay = (t: AnyRecord) => t.due_date === today || closedDay(t) === today || (isOpen(t) && (t.due_date ? t.due_date < today : t.section === 'today'))
    const mine = rows.filter(onDay)
    const overdue = (t: AnyRecord) => isOpen(t) && !!t.due_date && t.due_date < today
    input.tasks = {
      open: mine.filter(isOpen)
        .map((t, i) => ({ t, i, late: overdue(t) ? 0 : 1 }))
        .sort((x, y) => x.late - y.late || (num(x.t.sort_order, Number.MAX_SAFE_INTEGER) - num(y.t.sort_order, Number.MAX_SAFE_INTEGER)) || String(y.t.created_at ?? '').localeCompare(String(x.t.created_at ?? '')) || x.i - y.i)
        .map(({ t }) => ({
          title: String(t.title ?? ''), priority: t.priority === 'high' || t.priority === 'low' ? t.priority : 'medium',
          overdue: overdue(t), dueTime: t.due_time ? String(t.due_time).slice(0, 5) : null,
        })),
      doneToday: mine.filter(t => t.status === 'done' && closedDay(t) === today).length,
    }
  } catch { failedReads.push('tasks') }
  // Schedule: today's timed blocks (a skipped session's cancelled task leaves it out).
  let trainingToday: { title: string; startTime: string | null } | null = null
  try {
    const { data, error } = await supabase.from('time_blocks').select('title, category, start_time, duration_minutes, task:tasks(status)')
      .eq('user_id', userId).eq('date', today).order('start_time', { ascending: true }).limit(40)
    if (error) throw error
    const blocks = ((data ?? []) as AnyRecord[]).filter(b => b.start_time && b.task?.status !== 'cancelled')
    const startH = (b: AnyRecord) => { const [h, m] = String(b.start_time).split(':').map(Number); return h + (m || 0) / 60 }
    const endH = (b: AnyRecord) => startH(b) + num(b.duration_minutes, 60) / 60
    const ahead = blocks.filter(b => endH(b) > hour)
    const first = ahead[0]
    input.schedule = {
      next: first ? { title: String(first.title ?? ''), startLabel: String(first.start_time).slice(0, 5), startHour: startH(first), inProgress: startH(first) <= hour } : null,
      remainingCount: ahead.length,
    }
    const tr = blocks.find(b => b.category === 'training' && b.task?.status !== 'done')
    if (tr) trainingToday = { title: String(tr.title ?? ''), startTime: String(tr.start_time).slice(0, 5) }
  } catch { failedReads.push('schedule') }
  // Training, as Home's useDailyBrief gives it: today's session (and then no "next"), else the next planned one within two weeks,
  // the days since the last Hevy workout, the sessions since Monday (Hevy + Strava, as useWeekTrainingStats) and the weekly target.
  try {
    const { data } = await supabase.from('time_blocks').select('title, date, task:tasks(status)')
      .eq('user_id', userId).eq('category', 'training').gte('date', today).lte('date', dateFromToday(14)).order('date', { ascending: true }).limit(15)
    const next = ((data ?? []) as AnyRecord[]).find(b => b.date !== today && !['cancelled', 'done'].includes(b.task?.status))
    const weekAt = oslo00(mondayOfDay(today))
    const [hevyWeek, stravaWeek, lastHevy, profile] = await Promise.all([
      supabase.from('hevy_workouts').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('start_time', weekAt),
      supabase.from('strava_activities').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('start_date', weekAt),
      supabase.from('hevy_workouts').select('start_time, hevy_created_at').eq('user_id', userId).order('start_time', { ascending: false, nullsFirst: false }).limit(1),
      supabase.from('athlete_profile').select('training_days_per_week').eq('user_id', userId).maybeSingle(),
    ])
    const week = (hevyWeek.error || typeof hevyWeek.count !== 'number' ? 0 : hevyWeek.count) + (stravaWeek.error || typeof stravaWeek.count !== 'number' ? 0 : stravaWeek.count)
    const last = ((lastHevy.data ?? []) as AnyRecord[])[0]
    const lastAt = last ? String(last.start_time ?? last.hevy_created_at ?? '') : ''
    const daysSince = lastAt && Number.isFinite(Date.parse(lastAt))
      ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${osloDayOf(lastAt)}T12:00:00Z`)) / 86_400_000) : null
    const days = next ? Math.round((Date.parse(`${next.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : 0
    const dayLabel = days === 1 ? 'tomorrow' : days < 7 ? new Date(`${next?.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) : briefDmy(String(next?.date))
    const target = profile.error ? null : num(profile.data?.training_days_per_week, 0)
    input.training = {
      today: trainingToday,
      next: next && !trainingToday ? { title: String(next.title ?? ''), date: String(next.date), dayLabel } : null,
      daysSinceLastWorkout: daysSince,
      weekSessions: daysSince !== null || week > 0 ? week : null,
      weekTarget: target && target > 0 ? target : null,
    }
  } catch { /* training left out */ }
  // Food: eaten today against the owner's targets (no targets row: the section is left out).
  try {
    const targets = await supabase.from('day_targets').select('calories, protein_g, water_ml').eq('user_id', userId).maybeSingle()
    let eaten = await supabase.from('food_log_entries').select('calories, protein_g').eq('user_id', userId).eq('date', today).eq('status', 'eaten')
    if (statusMissing(eaten.error)) eaten = await supabase.from('food_log_entries').select('calories, protein_g').eq('user_id', userId).eq('date', today)
    const water = await supabase.from('water_log_entries').select('amount_ml').eq('user_id', userId).eq('date', today)
    if (!targets.error && targets.data && !eaten.error) {
      const rows = (eaten.data ?? []) as AnyRecord[]
      input.nutrition = {
        kcal: rows.reduce((a, r) => a + num(r.calories), 0), kcalTarget: num(targets.data.calories),
        proteinG: rows.reduce((a, r) => a + num(r.protein_g), 0), proteinTarget: num(targets.data.protein_g),
        waterMl: water.error ? undefined : ((water.data ?? []) as AnyRecord[]).reduce((a, r) => a + num(r.amount_ml), 0), waterTarget: num(targets.data.water_ml) || undefined,
      }
    }
  } catch { /* food left out */ }
  if (failedReads.length) input.failedReads = failedReads
  const brief = buildDailyBrief(input)
  return [brief.greeting, brief.headline.text, ...brief.sections.flatMap(s => ['', `${s.title}:`, ...s.lines.map(l => `- ${l.text}`)])].join('\n')
}

// The Oslo day (yyyy-MM-dd) an instant falls on.
function osloDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: HOME_TZ })
}

// The Monday of the week a day (yyyy-MM-dd) is in, by calendar arithmetic (progressAggregate.mondayOf).
function mondayOfDay(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return new Date(Date.parse(`${day}T12:00:00Z`) - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
}

// The instant an Oslo day starts: the clocks change at night, never at midnight, so one correction is enough.
function oslo00(day: string): string {
  const offsetMin = (at: Date) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: HOME_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const n = (t: string) => Number(p.find(x => x.type === t)?.value)
    return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
  }
  const guess = new Date(`${day}T00:00:00Z`)
  const first = new Date(guess.getTime() - offsetMin(guess) * 60_000)
  return new Date(guess.getTime() - offsetMin(first) * 60_000).toISOString()
}

// What a device function sends to `claude` instead of the service key itself: HMAC-SHA256 of a fixed label, keyed with
// the service key, as hex. The raw service key would give whoever reads a header (a gateway, a log) the whole database;
// this value proves the sender holds the key and opens nothing else. The same few lines are in kobo-sync, phone-gateway
// and claude's guard.ts (`verify-claude-function` compares them).
async function claudeDeviceCredential(serviceKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('claude-device-v1')))
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Ask one of the `claude` function's phone jobs. Only that function holds the
// Anthropic key: this one proves itself with a value derived from the project's service key
// (claudeDeviceCredential) in the `x-claude-server-key` header (never in the address, never logged) and names
// the job, the caller `phone` and the input. It sends no account: `claude` acts
// as the owner (HEVY_USER_ID) from its own environment. Bounded by a 22s
// AbortController so a slow upstream returns a clean error before the client's
// ~25s timeout. Returns { ok, text, model } or { ok: false, error }.
async function askClaude(job: 'phone_ask', input: AnyRecord): Promise<AnyRecord> {
  const key = serviceKey()
  if (!key) return { ok: false, error: 'AI is not set up on the server.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 22_000)
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/claude`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-claude-server-key': await claudeDeviceCredential(key) },
      body: JSON.stringify({ action: 'run', caller: 'phone', job, input }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null) as AnyRecord | null
    // Only text leaves: the function's own sentence for a stop, never a raw body.
    if (data?.ok === true && typeof data.result?.text === 'string') {
      return { ok: true, text: data.result.text, model: typeof data.call?.served_model === 'string' ? data.call.served_model : undefined }
    }
    return { ok: false, error: typeof data?.message === 'string' ? data.message.slice(0, 300) : `AI answered ${res.status}` }
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError'
      ? 'AI timed out (~22s). Try again in a moment.'
      : 'AI could not be reached.'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

// Deterministic sleep nights, last 7 days. THIRD hand-mirrored copy of
// healthAggregate.ts's SLEEP CONTRACT (the others: the web app's
// computeSleepSummary and ai-proxy's summarizeSleepNights) — CHANGE ONE,
// CHANGE ALL THREE; scripts/verify-ai-sleep-merge.cjs checks the rules:
//   1. A night belongs to the day you WOKE UP: sleepEnd's local date when it
//      carries an offset, else the row's date.
//   2. A night with any manual row uses ONLY its manual rows (a deliberate
//      correction — this copy used to ignore manual rows entirely).
//   3. Pre-aggregated sessions: drop one when >=90% of its window lies inside
//      a better-ranked session, or less than 15 min of it lies outside one (a
//      re-report or a "Since Last Sync" fragment); sum the rest (an
//      interrupted night is two real blocks).
//   4. Raw per-stage rows: Core + REM + Deep + Asleep = total; Awake not added.
async function computeSleepNightsGw(userId: string): Promise<AnyRecord[]> {
  const since = dateFromToday(-7)
  const { data } = await supabase.from('health_metrics')
    .select('value, date, source, recorded_at').eq('user_id', userId).eq('metric_name', 'sleep_analysis').gte('date', since)
  const parse = (s: unknown): number | null => {
    if (typeof s !== 'string') return null
    const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
    let t = Date.parse(iso); if (!Number.isFinite(t)) t = Date.parse(s)
    return Number.isFinite(t) ? t : null
  }
  const nightKey = (r: AnyRecord): string => {
    const end = r.value?.sleepEnd
    if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end) && /[+-]\d{2}:?\d{2}$/.test(end.trim())) return end.slice(0, 10)
    return String(r.date)
  }
  const CONTAINMENT = 0.9
  const MIN_EXTRA_MS = 15 * 60_000
  const byNight = new Map<string, AnyRecord[]>()
  for (const r of (data ?? []) as AnyRecord[]) {
    const k = nightKey(r)
    const arr = byNight.get(k)
    if (arr) arr.push(r); else byNight.set(k, [r])
  }
  const hm = (m: number | null) => m == null ? null : new Date(m).toLocaleTimeString('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' })
  const r2 = (n: number) => Math.round(n * 100) / 100
  const out: AnyRecord[] = []
  for (const [date, pts] of byNight) {
    const manual = pts.filter(p => p.source === 'manual')
    const src = manual.length > 0 ? manual : pts
    const pre = src.filter(p => typeof p.value?.totalSleep === 'number')
    let core = 0, rem = 0, deep = 0, awake = 0, total = 0
    let inBed: number | null = null, startMs: number | null = null, endMs: number | null = null
    if (pre.length > 0) {
      // Rule 3 (mergeSleepSessions): exact re-sends first, then containment.
      interface Sess { v: AnyRecord; start: number; end: number; total: number; order: number }
      const timed: Sess[] = []
      const untimed: AnyRecord[] = []
      const seen = new Set<string>()
      for (const r of pre) {
        const v = r.value ?? {}
        const key = [v.sleepStart ?? r.recorded_at, v.sleepEnd ?? '', v.totalSleep ?? ''].join('|')
        if (seen.has(key)) continue
        seen.add(key)
        const start = parse(v.sleepStart), end = parse(v.sleepEnd)
        if (start != null && end != null && end > start) timed.push({ v, start, end, total: num(v.totalSleep), order: timed.length })
        else untimed.push(v)
      }
      const ranked = [...timed].sort((a, b) => (b.total - a.total) || ((b.end - b.start) - (a.end - a.start)) || (a.order - b.order))
      const kept: Sess[] = []
      for (const s of ranked) {
        const dup = kept.some(k => {
          const overlap = Math.min(s.end, k.end) - Math.max(s.start, k.start)
          const span = s.end - s.start
          return overlap > 0 && span > 0 && (overlap / span >= CONTAINMENT || span - overlap < MIN_EXTRA_MS)
        })
        if (!dup) kept.push(s)
      }
      for (const v of [...untimed, ...kept.map(k => k.v)]) {
        core += num(v.core); rem += num(v.rem); deep += num(v.deep); awake += num(v.awake)
        total += typeof v.totalSleep === 'number' ? v.totalSleep : num(v.core) + num(v.rem) + num(v.deep)
      }
      for (const k of kept) {
        startMs = startMs == null ? k.start : Math.min(startMs, k.start)
        endMs = endMs == null ? k.end : Math.max(endMs, k.end)
        const inS = parse(k.v.inBedStart), inE = parse(k.v.inBedEnd)
        if (inS != null && inE != null && inE > inS) inBed = (inBed ?? 0) + (inE - inS) / 3600000
      }
    } else {
      let asleep = 0
      for (const p of src) {
        const stage = p.value?.value, qty = p.value?.qty
        if (typeof qty !== 'number') continue
        if (stage === 'Core') core += qty
        else if (stage === 'REM') rem += qty
        else if (stage === 'Deep') deep += qty
        else if (stage === 'Awake') awake += qty
        else if (stage === 'Asleep') asleep += qty
      }
      total = core + rem + deep + asleep
      if (!(total > 0 || awake > 0)) continue
    }
    out.push({
      date, hours: r2(total), in_bed_h: inBed == null ? null : r2(inBed),
      deep_h: r2(deep), core_h: r2(core), rem_h: r2(rem), awake_h: r2(awake),
      start: hm(startMs), end: hm(endMs), manual: manual.length > 0,
    })
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

// ── Body composition report import (smart-scale OCR → Shortcut → gateway) ──
// The Shortcut OCRs a fixed-layout "Body composition analysis report" image
// on-device (Apple's own OCR, no LLM involved anywhere in this path) and
// POSTs the 14 extracted numbers + a local measured_at + timezone here.
// Validation is pure numeric sanity (finite, in-range, internally
// consistent) — it never reproduces the device's own High/Normal/Low
// classification bands, which are judgments, not measurements.
// Contract: docs/iphone-examples.md's "import_body_composition" section —
// keep that doc and this handler in sync.
const BODY_COMP_SOURCE = 'movinglife_report'
const DEFAULT_MEASUREMENT_TZ = 'Europe/Oslo'

// Report values print to 1 decimal place, so a cross-field check (weight ×
// bf% vs body_fat_mass_kg, weight − fat mass vs lean_body_mass_kg) can be off
// by a few hundredths of a kg from rounding alone — three independent
// 1-decimal roundings compound to ~0.15 kg worst case. Tolerance is the
// LARGER of that flat floor or 0.5% of the person's own weight, so it scales
// sensibly for a much heavier or lighter person than the flat floor assumes.
const CONSISTENCY_TOL_ABS_KG = 0.15
const CONSISTENCY_TOL_REL = 0.005
function withinTolerance(expected: number, actual: number, weightKg: number): boolean {
  const tol = Math.max(CONSISTENCY_TOL_ABS_KG, CONSISTENCY_TOL_REL * weightKg)
  return Math.abs(expected - actual) <= tol
}

// Re-send comparison (already_exists vs conflict): a genuine re-delivery of
// the SAME report should match near-exactly. Deliberately tighter than the
// cross-field tolerance above, which exists for rounding drift BETWEEN
// different fields, not for comparing one field to its own earlier value.
const RESEND_TOL = 0.05
function sameValue(a: number, b: number): boolean { return Math.abs(a - b) <= RESEND_TOL }

interface BodyCompField { key: string; min: number; max: number; integer?: boolean }
// Sanity bounds only — generous enough to admit any real human report, tight
// enough to catch a genuinely broken OCR read (a negative weight, a 300%
// body-fat reading). Never the device's own classification thresholds.
const BODY_COMP_FIELDS: BodyCompField[] = [
  { key: 'weight_kg',               min: 1,   max: 500 },
  { key: 'body_fat_percent',        min: 0,   max: 100 },
  { key: 'body_fat_mass_kg',        min: 0,   max: 500 },
  { key: 'lean_body_mass_kg',       min: 0,   max: 500 },
  { key: 'body_water_percent',      min: 0,   max: 100 },
  { key: 'protein_percent',         min: 0,   max: 100 },
  { key: 'muscle_percent',          min: 0,   max: 100 },
  { key: 'skeletal_muscle_percent', min: 0,   max: 100 },
  { key: 'skeletal_muscle_index',   min: 0,   max: 50  },
  { key: 'bmi',                     min: 5,   max: 100 },
  { key: 'visceral_fat_index',      min: 0,   max: 100, integer: true },
  { key: 'subcutaneous_fat_kg',     min: 0,   max: 200 },
  { key: 'bmr_kcal',                min: 200, max: 6000, integer: true },
  { key: 'body_score',              min: 0,   max: 100, integer: true },
]

// Resolves a NAIVE local wall-clock time ("2026-09-06T08:23:00", no offset —
// the report never carries one) in `timeZone` to a real UTC instant. Never a
// hardcoded +02:00/+01:00 — DST-safe via the standard two-pass IANA-offset
// technique: guess the instant assuming UTC, read what wall-clock time THAT
// instant maps to in the target zone via Intl (Deno ships full tzdata), then
// correct by the difference and repeat once more (the offset at the
// corrected instant can differ from the offset at the guess on either side
// of a DST transition). Two passes converge for every ordinary spring-
// forward/fall-back case; the true edge case — a wall-clock time that falls
// in the one-hour gap skipped forward, or repeated twice on fall-back — has
// no single correct answer by construction, and is out of scope here.
function zonedWallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, se: number, timeZone: string): number {
  const offsetMsAt = (utcMs: number): number => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts: AnyRecord = {}
    for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = p.value
    let hour = Number(parts.hour); if (hour === 24) hour = 0
    const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
    return asIfUTC - utcMs
  }
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, se)
  const utc1 = guessUtc - offsetMsAt(guessUtc)
  return guessUtc - offsetMsAt(utc1)
}

// Parses "YYYY-MM-DD[T ]HH:mm[:ss]" only — deliberately rejects a trailing Z
// or numeric offset (the report never has one, so one arriving here would be
// ambiguous — whose offset? — rather than helpful). Returns null on mismatch.
function parseNaiveLocalDateTime(s: string): { y: number; mo: number; d: number; h: number; mi: number; se: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return { y: Number(y), mo: Number(mo), d: Number(d), h: Number(h), mi: Number(mi), se: Number(se ?? '0') }
}

function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

// Validates the full import_body_composition body: required/finite/in-range
// per field, then the two cross-field consistency checks. Returns either the
// clean numeric values + a resolved measured_at (UTC ISO string), or a
// field-keyed error map — never a partial write either way.
function validateBodyComposition(body: AnyRecord): { ok: true; values: AnyRecord; measuredAtIso: string } | { ok: false; errors: AnyRecord } {
  const errors: AnyRecord = {}

  let measuredAtIso: string | null = null
  const rawMeasuredAt = body.measured_at
  if (typeof rawMeasuredAt !== 'string' || !rawMeasuredAt.trim()) {
    errors.measured_at = 'required — local datetime, e.g. "2026-09-06T08:23:00", no UTC offset'
  } else {
    const parsed = parseNaiveLocalDateTime(rawMeasuredAt)
    if (!parsed) {
      errors.measured_at = 'must be "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss", local time, no Z/offset'
    } else {
      const tz = (typeof body.measurement_timezone === 'string' && body.measurement_timezone.trim())
        ? body.measurement_timezone.trim() : DEFAULT_MEASUREMENT_TZ
      if (!isValidTimeZone(tz)) {
        errors.measurement_timezone = `not a recognized IANA timezone: "${tz}"`
      } else {
        const utcMs = zonedWallTimeToUtcMs(parsed.y, parsed.mo, parsed.d, parsed.h, parsed.mi, parsed.se, tz)
        if (!Number.isFinite(utcMs)) errors.measured_at = 'could not be resolved to a real instant'
        else measuredAtIso = new Date(utcMs).toISOString()
      }
    }
  }

  const values: AnyRecord = {}
  for (const f of BODY_COMP_FIELDS) {
    const raw = body[f.key]
    if (raw === undefined || raw === null || raw === '') { errors[f.key] = 'required'; continue }
    const n = Number(raw)
    if (!Number.isFinite(n)) { errors[f.key] = 'must be a finite number'; continue }
    if (f.integer && !Number.isInteger(n)) { errors[f.key] = 'must be a whole number'; continue }
    if (n < f.min || n > f.max) { errors[f.key] = `out of expected range [${f.min}, ${f.max}]`; continue }
    values[f.key] = n
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // Cross-field consistency — weight_kg/body_fat_percent/body_fat_mass_kg/
  // lean_body_mass_kg are all guaranteed present and range-valid at this point.
  const expectedFatMass = values.weight_kg * values.body_fat_percent / 100
  if (!withinTolerance(expectedFatMass, values.body_fat_mass_kg, values.weight_kg)) {
    errors.body_fat_mass_kg = `inconsistent with weight_kg × body_fat_percent (expected ≈${expectedFatMass.toFixed(2)})`
  }
  const expectedLean = values.weight_kg - values.body_fat_mass_kg
  if (!withinTolerance(expectedLean, values.lean_body_mass_kg, values.weight_kg)) {
    errors.lean_body_mass_kg = `inconsistent with weight_kg − body_fat_mass_kg (expected ≈${expectedLean.toFixed(2)})`
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return { ok: true, values, measuredAtIso: measuredAtIso! }
}

// Constant-time secret check (security review 26.10.2026): both sides are
// hashed to the same length first, so the answer time shows neither the
// secret's length nor how much of it matched. Never log either value.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  // ── Auth: device secret ──
  const secret = Deno.env.get('PHONE_GATEWAY_SECRET')
  const given = req.headers.get('x-phone-secret')
  if (!secret || !(await sameSecret(given ?? '', secret))) return json({ error: 'Unauthorized' }, 401)
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) return json({ error: 'Server not configured (HEVY_USER_ID)' }, 503)

  const body = await req.json().catch(() => ({})) as AnyRecord
  const action = String(body.action ?? '')

  try {
    switch (action) {
      // ── Deterministic: log a supplement (default creatine) ──
      // A scheduled supplement (migration 160): the log takes today's open
      // dose of the schedule it names (`schedule_id`) or the one its title
      // names best — the schedule's own name, its linked food's or recipe's
      // (160's supplement_log_rank) — its own diary line, linked to the dose, so the dose
      // reads Taken and its reminders stop. No such dose (no schedule, all
      // taken, or before 160): the plain line as before.
      case 'log_supplement': {
        const title = (typeof body.title === 'string' && body.title.trim()) || 'Kreatin 5 g'
        if (!body.date || body.date === todayLocal()) {
          const scheduleId = typeof body.schedule_id === 'string' && body.schedule_id ? body.schedule_id : null
          const match = await supabase.rpc('supplement_dose_for_log', { p_user: userId, p_title: title, p_schedule: scheduleId })
          const dose = !match.error ? (match.data as AnyRecord[] | null)?.[0] : null
          if (dose) {
            const took = await supabase.rpc('supplement_take', {
              p_schedule: dose.schedule_id, p_date: dose.dose_date, p_time: dose.dose_time, p_user_id: userId,
            })
            if (!took.error) {
              return json({ ok: true, logged: `${dose.title} ${dose.dose_label}`, dose: String(dose.dose_time).slice(0, 5) })
            }
          }
        }
        const err = await insertFoodLog(userId, {
          date: body.date ?? todayLocal(), meal_slot: 'supplement',
          custom_title: title, calories: num(body.calories, 0),
        })
        return err ? json({ ok: false, error: err.message }, 400) : json({ ok: true, logged: title })
      }

      // ── Deterministic: log any food line ──
      case 'log_food': {
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        if (!title) return json({ ok: false, error: 'title required' }, 400)
        const err = await insertFoodLog(userId, {
          date: body.date ?? todayLocal(), meal_slot: body.meal_slot ?? 'snack', custom_title: title,
          calories: num(body.calories, 0), protein_g: num(body.protein_g, 0),
          carbs_g: num(body.carbs_g, 0), fat_g: num(body.fat_g, 0),
        })
        return err ? json({ ok: false, error: err.message }, 400) : json({ ok: true, logged: title })
      }

      // ── Deterministic: today's eaten totals (for the widget) ──
      case 'nutrition_today': {
        const date = body.date ?? todayLocal()
        let { data, error } = await supabase.from('food_log_entries')
          .select('calories, protein_g').eq('user_id', userId).eq('date', date).eq('status', 'eaten')
        if (error && (error.code === '42703' || error.code === 'PGRST204') && /status/i.test(error.message ?? '')) {
          ;({ data, error } = await supabase.from('food_log_entries')
            .select('calories, protein_g').eq('user_id', userId).eq('date', date))
        }
        if (error) return json({ ok: false, error: error.message }, 400)
        const rows = data ?? []
        // Water total (its own table; missing pre-067 → 0, never errors the widget).
        let waterMl = 0
        const w = await supabase.from('water_log_entries')
          .select('amount_ml').eq('user_id', userId).eq('date', date)
        if (!w.error && w.data) waterMl = (w.data as AnyRecord[]).reduce((a, r) => a + num(r.amount_ml), 0)
        return json({
          ok: true, date,
          kcal: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.calories), 0)),
          protein_g: Math.round(rows.reduce((a: number, r: AnyRecord) => a + num(r.protein_g), 0)),
          water_ml: Math.round(waterMl),
          entries: rows.length,
        })
      }

      // ── Deterministic: log water (default 250 ml — e.g. an NFC bottle tap) ──
      case 'log_water': {
        const amount = num(body.amount_ml, 250)
        // A device secret is all a caller needs here, so no single log may be
        // absurd (security audit 10.10.2026): at most 5 L at once.
        if (amount <= 0 || amount > 5000) return json({ ok: false, error: 'amount_ml must be between 1 and 5000' }, 400)
        const { error } = await supabase.from('water_log_entries')
          .insert({ user_id: userId, date: body.date ?? todayLocal(), amount_ml: Math.round(amount) })
        return error ? json({ ok: false, error: error.message }, 400) : json({ ok: true, logged_ml: Math.round(amount) })
      }

      // ── Deterministic: recently-eaten foods (dedup, snapshot macros) — for
      //    the phone logger's "re-log" chips. Mirrors the client's fetchRecentFoods. ──
      case 'recent_foods': {
        const fromDate = body.from ?? dateFromToday(-30)
        const cols = 'meal_slot, custom_title, calories, protein_g, carbs_g, fat_g, ingredient:recipe_ingredient_library(name), recipe:recipes(title)'
        const base = () => {
          let q = supabase.from('food_log_entries').select(cols)
            .eq('user_id', userId).gte('date', fromDate)
            .order('created_at', { ascending: false }).limit(80)
          if (typeof body.slot === 'string' && body.slot) q = q.eq('meal_slot', body.slot)
          return q
        }
        let { data, error } = await base().eq('status', 'eaten')
        if (statusMissing(error)) ({ data, error } = await base())
        if (error) return json({ ok: false, error: error.message }, 400)
        const seen = new Set<string>()
        const foods: AnyRecord[] = []
        for (const r of (data ?? []) as AnyRecord[]) {
          const title = r.ingredient?.name ?? r.recipe?.title ?? r.custom_title
          if (!title) continue
          const key = title.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          foods.push({
            title, meal_slot: r.meal_slot,
            calories: num(r.calories), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
          })
          if (foods.length >= 15) break
        }
        return json({ ok: true, foods })
      }

      // ── Deterministic: search the user's own ingredient library (per-100g). ──
      case 'search_library': {
        const q = String(body.q ?? '').replace(/[%,()]/g, ' ').trim()
        if (!q) return json({ ok: false, error: 'q required' }, 400)
        const { data, error } = await supabase.from('recipe_ingredient_library')
          .select('name, calories, protein_g, carbs_g, fat_g, serving_label, serving_grams')
          .eq('user_id', userId).ilike('name', `%${q}%`).order('name', { ascending: true }).limit(25)
        if (error) return json({ ok: false, error: error.message }, 400)
        const items = ((data ?? []) as AnyRecord[]).map(r => ({
          name: r.name,
          // Library macros are ALWAYS per 100 g.
          per100: { kcal: num(r.calories), p: num(r.protein_g), c: num(r.carbs_g), f: num(r.fat_g) },
          serving_label: r.serving_label ?? null, serving_grams: r.serving_grams ?? null,
        }))
        return json({ ok: true, items })
      }

      // ── AI: free-form question — one answer, no tools; today's context is
      //    looked up here by code and handed over as data ──
      case 'ask': {
        const q = String(body.q ?? '').trim()
        if (!q) return json({ ok: false, error: 'q required for action "ask"' }, 400)
        if (q.length > ASK_QUESTION_MAX) return json({ ok: false, error: `That question is too long (${q.length} characters): at most ${ASK_QUESTION_MAX}. Shorten it and ask again.` }, 400)
        return json(await askClaude('phone_ask', { question: q, context: await buildBriefContext(userId) }))
      }

      // ── Morning brief — built by the SAME fixed rules as Home's brief (briefRules.ts, the <brief-shared> copy),
      //    no AI and no cost (owner, 22.11.2026). The phone has no weather, rates or Watch source, so those sections
      //    are left out; tasks, schedule, training and food are read here, each section best-effort. ──
      case 'brief': {
        return json({ ok: true, text: await buildPhoneBrief(userId), source: 'rules' })
      }

      // ── AI: sleep — last nights computed here (source-aware, overlap-merged),
      //    then a short comment on them ──
      case 'sleep': {
        const nights = await computeSleepNightsGw(userId)
        if (!nights.length) return json({ ok: false, error: 'No sleep data in the last 7 days.' })
        const lines = nights.map(n => `${dmy(n.date)}: ${n.hours} h asleep (deep ${n.deep_h} h, core ${n.core_h} h, REM ${n.rem_h} h, awake ${n.awake_h} h)${n.start ? `, ${n.start}–${n.end}` : ''}`)
        const context = `SLEEP, last ${nights.length} nights (the date is the day woken up), oldest first:\n${lines.join('\n')}`
        return json(await askClaude('phone_ask', { question: 'How did I sleep last night? Compare it with the average of the nights given and comment shortly.', context }))
      }

      // ── Deterministic: full sleep stats (last night + 7d) — for the NON-AI
      //    "Uyku İstatistikleri" shortcut. Overlap-merged, source-resolved. ──
      case 'sleep_stats': {
        const nights = await computeSleepNightsGw(userId)
        const last = nights.length ? { ...nights[nights.length - 1] } : null
        if (last) {
          // Sleep-adjacent metrics for that wake day (best-effort; omit if absent).
          const { data: m } = await supabase.from('health_metrics')
            .select('metric_name, value').eq('user_id', userId).eq('date', last.date)
            .in('metric_name', ['sleeping_heart_rate', 'heart_rate_variability', 'oxygen_saturation', 'respiratory_rate'])
          for (const r of (m ?? []) as AnyRecord[]) {
            const v = r.value ?? {}
            const val = Number(v.qty ?? v.Avg ?? v.avg)
            if (!Number.isFinite(val)) continue
            if (r.metric_name === 'sleeping_heart_rate')       last.sleeping_hr = Math.round(val)
            else if (r.metric_name === 'heart_rate_variability') last.hrv_ms = Math.round(val)
            else if (r.metric_name === 'oxygen_saturation')      last.spo2_pct = Math.round(val * 10) / 10
            else if (r.metric_name === 'respiratory_rate')       last.resp_rate = Math.round(val * 10) / 10
          }
        }
        return json({ ok: true, last_night: last, nights })
      }

      // ── Deterministic: today's open tasks + schedule — for "Bugünün Taskları". ──
      case 'tasks_today': {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
        const tasks: AnyRecord[] = [], schedule: AnyRecord[] = []
        try {
          const { data } = await supabase.from('tasks')
            .select('title, priority, due_time')
            .eq('user_id', userId).or(`section.eq.today,due_date.eq.${today}`)
            .neq('status', 'cancelled').neq('status', 'done')
            .order('due_time', { ascending: true }).limit(30)
          for (const t of (data ?? []) as AnyRecord[]) tasks.push({ title: t.title, priority: t.priority, due_time: t.due_time ? String(t.due_time).slice(0, 5) : null })
        } catch { /* omit */ }
        try {
          const { data } = await supabase.from('time_blocks')
            .select('title, start_time').eq('user_id', userId).eq('date', today)
            .order('start_time', { ascending: true }).limit(30)
          for (const b of (data ?? []) as AnyRecord[]) if (b.start_time) schedule.push({ time: String(b.start_time).slice(0, 5), title: b.title })
        } catch { /* omit */ }
        return json({ ok: true, date: today, tasks, schedule })
      }

      // ── Deterministic: import a smart-scale body composition report,
      //    already OCR'd on-device by the Shortcut (no AI in this path). ──
      case 'import_body_composition': {
        const result = validateBodyComposition(body)
        if (!result.ok) return json({ status: 'validation_error', errors: result.errors }, 400)
        const { values, measuredAtIso } = result

        // A report re-sent verbatim is a silent no-op; re-sent with DIFFERENT
        // numbers for the same (user, source, measured_at) is a conflict —
        // never a silent overwrite (the DB unique index is the real
        // enforcement; this SELECT-first is what lets us answer cleanly
        // instead of surfacing a raw constraint-violation error).
        const sameReport = (existing: AnyRecord): boolean =>
          BODY_COMP_FIELDS.every(f => sameValue(Number(existing[f.key]), values[f.key]))
        const resolveAgainstExisting = (existing: AnyRecord) => sameReport(existing)
          ? json({ status: 'already_exists', id: existing.id }, 200)
          : json({ status: 'conflict', id: existing.id, message: 'A report already exists for this measured_at with different values.' }, 409)

        const { data: existing, error: selErr } = await supabase
          .from('body_composition_reports').select('*')
          .eq('user_id', userId).eq('source', BODY_COMP_SOURCE).eq('measured_at', measuredAtIso)
          .maybeSingle()
        if (selErr) return json({ status: 'server_error', error: selErr.message }, 500)
        if (existing) return resolveAgainstExisting(existing)

        const { data: inserted, error: insErr } = await supabase
          .from('body_composition_reports')
          .insert({ ...values, measured_at: measuredAtIso, source: BODY_COMP_SOURCE, user_id: userId })
          .select('id').single()

        if (insErr) {
          // Concurrent duplicate: another request inserted the identical
          // (user, source, measured_at) between our SELECT and this INSERT.
          // Re-resolve exactly like the non-race path above rather than
          // surfacing a raw DB error to the phone.
          if (insErr.code === '23505') {
            const { data: raced, error: raceErr } = await supabase
              .from('body_composition_reports').select('*')
              .eq('user_id', userId).eq('source', BODY_COMP_SOURCE).eq('measured_at', measuredAtIso)
              .maybeSingle()
            if (raceErr || !raced) return json({ status: 'server_error', error: raceErr?.message ?? 'concurrent write could not be resolved' }, 500)
            return resolveAgainstExisting(raced)
          }
          return json({ status: 'server_error', error: insErr.message }, 500)
        }
        return json({ status: 'created', id: inserted!.id }, 201)
      }

      default:
        return json({ ok: false, error: `Unknown action "${action}" (use log_supplement | log_food | log_water | nutrition_today | recent_foods | search_library | sleep_stats | tasks_today | import_body_composition | ask | brief | sleep)` }, 400)
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
