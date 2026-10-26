// The Personal page's day summary numbers (owner, 26.10.2026: "a daily summary
// for anything I plan or do … only basic things … easy, understandable and
// clear"). Pure: runtime imports only from progressAggregate (THE session
// count and streak rules), checked by scripts/verify-personal-glance.cjs.
// Every number follows the day the page shows, not only today.

import { currentStreakWeeks, mondayOf, sessionsInWeek, weeklySessionCounts, type DatedSession } from '../training/progressAggregate'

const pad = (n: number) => String(n).padStart(2, '0')
function shift(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** One day of the shown week: trained, still planned, or planned and passed. */
export type WeekDayMark = 'trained' | 'planned' | 'missed' | 'none'

export interface WeekDay {
  date: string
  /** M T W T F S S */
  letter: string
  mark: WeekDayMark
  /** The day the page shows. */
  shown: boolean
}

export interface TrainingWeekGlance {
  week: WeekDay[]
  /** Sessions in the shown day's week (Monday → Sunday). */
  sessions: number
  /** The owner's own weekly target (athlete_profile.training_days_per_week), when set. */
  target: number | null
  /** Sessions a week over the four full weeks before it, one decimal; null with no session in them. */
  average: number | null
  /** Weeks in a row with a session, the shown week counting once it has one. */
  streakWeeks: number
}

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The shown day's training week. `sessions`: every Hevy workout and Strava
 * activity as a dated session (the same ones "N this week" counts on Home and
 * Training — sessionsThisWeek); only those up to the shown day count, so a
 * past day reads as it was then. `plannedDays`: days with a planned session
 * still open (to do, or passed without one).
 */
export function trainingWeekGlance(input: {
  day: string
  today: string
  sessions: readonly DatedSession[]
  plannedDays: ReadonlySet<string>
  target: number | null
}): TrainingWeekGlance {
  const { day, today } = input
  const upTo = input.sessions.filter(s => s.date <= day)
  const trained = new Set(upTo.map(s => s.date))
  const monday = mondayOf(day)
  const week: WeekDay[] = LETTERS.map((letter, i) => {
    const date = shift(monday, i)
    const mark: WeekDayMark = trained.has(date) ? 'trained'
      : input.plannedDays.has(date) ? (date < today ? 'missed' : 'planned')
        : 'none'
    return { date, letter, mark, shown: date === day }
  })
  const before = [1, 2, 3, 4].map(n => sessionsInWeek(upTo, shift(monday, -7 * n)))
  const total = before.reduce((a, b) => a + b, 0)
  return {
    week,
    sessions: sessionsInWeek(upTo, monday),
    target: input.target != null && input.target > 0 ? input.target : null,
    average: total > 0 ? Math.round((total / 4) * 10) / 10 : null,
    streakWeeks: currentStreakWeeks(weeklySessionCounts(upTo, monday), 1, monday),
  }
}

/** "≈ 5 h 10 min" / "≈ 45 min" — a length estimated from runtimes. */
export function aboutMinutes(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `≈ ${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `≈ ${h} h ${rest} min` : `≈ ${h} h`
}

/** The day line: the facts the day has, in a fixed order, the empty ones left out. */
export function dayLineItems(parts: {
  tasks?: { done: number; total: number } | null
  trainedMinutes?: number | null
  steps?: number | null
  kcal?: number | null
  watched?: { episodes: number; films: number } | null
  readMinutes?: number | null
  renewals?: readonly string[]
}): string[] {
  const out: string[] = []
  const t = parts.tasks
  if (t && t.total > 0) out.push(`${t.done} of ${t.total} tasks done`)
  if (parts.trainedMinutes != null && parts.trainedMinutes > 0) out.push(`trained ${Math.round(parts.trainedMinutes)} min`)
  if (parts.steps != null && parts.steps > 0) out.push(`${Math.round(parts.steps).toLocaleString('en-GB')} steps`)
  if (parts.kcal != null && parts.kcal > 0) out.push(`${Math.round(parts.kcal).toLocaleString('en-GB')} kcal`)
  const w = parts.watched
  if (w && w.episodes + w.films > 0) {
    out.push([
      w.episodes ? `${w.episodes} episode${w.episodes === 1 ? '' : 's'}` : null,
      w.films ? `${w.films} film${w.films === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' + '))
  }
  if (parts.readMinutes != null && parts.readMinutes > 0) out.push(`read ${Math.round(parts.readMinutes)} min`)
  for (const name of parts.renewals ?? []) out.push(`${name} renews`)
  return out
}

/** One item picked for the day: the same all day, another after each shuffle
 *  (`seed` = the day and the shuffle count). Null for none. */
export function pickBySeed<T>(items: readonly T[], seed: string): T | null {
  if (items.length === 0) return null
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return items[(h >>> 0) % items.length]
}
