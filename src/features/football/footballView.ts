// How the Football page shows what footballModel read: day headings, matches
// grouped by competition, a table's qualification zones as tones, the follow
// filter and the "+ Follow" suggestions. Pure; checked by
// scripts/verify-football-model.cjs.
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import type { Tone } from '../../shared/ui'
import { osloParts, type FbMatch, type FbStandingRow, type FbTable } from './footballModel'
import type { FootballFollow, NewFollowInput } from './types'

/** "Today", "Tomorrow", "Yesterday", else "Wed 21.10.2026". `today` is YYYY-MM-DD. */
export function dayLabel(date: string, today: string): string {
  const shift = (d: string, n: number) => {
    const [y, m, day] = d.split('-').map(Number)
    const x = new Date(Date.UTC(y, m - 1, day + n))
    return x.toISOString().slice(0, 10)
  }
  if (date === today) return 'Today'
  if (date === shift(today, 1)) return 'Tomorrow'
  if (date === shift(today, -1)) return 'Yesterday'
  return formatWeekdayDate(date)
}

export interface LeagueGroup { league: string; name: string; matches: FbMatch[] }
export interface DayMatches { date: string; leagues: LeagueGroup[] }

/** Matches (in the order given) by Norwegian day, and inside a day by competition in order of first kick-off. */
export function byDayAndLeague(matches: readonly FbMatch[]): DayMatches[] {
  const days: DayMatches[] = []
  for (const m of matches) {
    const date = osloParts(m.kickoff).date
    let day = days.find(d => d.date === date)
    if (!day) days.push(day = { date, leagues: [] })
    const slug = m.league?.slug ?? ''
    let group = day.leagues.find(g => g.league === slug)
    if (!group) day.leagues.push(group = { league: slug, name: m.league?.name ?? 'Other', matches: [] })
    group.matches.push(m)
  }
  return days
}

/** What the page shows: everything, or one followed team's / tournament's matches. */
export type FollowFilter = { kind: 'team' | 'league'; ref: string } | null

export function filterMatches(matches: readonly FbMatch[], filter: FollowFilter): FbMatch[] {
  if (!filter) return [...matches]
  return matches.filter(m => (filter.kind === 'team'
    ? m.home.team.id === filter.ref || m.away.team.id === filter.ref
    : m.league?.slug === filter.ref))
}

/** The tables the page reads: each followed tournament's, then each followed team's own league — once each. */
export function tableLeagues(follows: readonly FootballFollow[], filter: FollowFilter): string[] {
  const shown = filter ? follows.filter(f => f.kind === filter.kind && f.ref === filter.ref) : follows
  const out: string[] = []
  for (const f of [...shown.filter(f => f.kind === 'league'), ...shown.filter(f => f.kind === 'team')]) {
    if (f.league && !out.includes(f.league)) out.push(f.league)
  }
  return out
}

/** A league's tables worth showing: those with a followed team; else the first (a group stage has many). */
export function tablesToShow(tables: readonly FbTable[], followed: ReadonlySet<string>): { shown: FbTable[]; hidden: number } {
  const mine = tables.filter(t => t.rows.some(r => followed.has(r.team.id)))
  const shown = mine.length ? mine : tables.slice(0, 1)
  return { shown, hidden: tables.length - shown.length }
}

/**
 * A table's zones as tones (ESPN's own colours are left out — THEME's tones
 * only): relegation is danger, the other zones take success, info, highlight
 * and upcoming in the order they first appear going down the table.
 */
export function noteTones(rows: readonly FbStandingRow[]): Map<string, Tone> {
  const out = new Map<string, Tone>()
  const order: Tone[] = ['success', 'info', 'highlight', 'upcoming']
  let i = 0
  for (const r of rows) {
    const text = r.note?.text
    if (!text || out.has(text)) continue
    out.set(text, /relegat/i.test(text) ? 'danger' : order[Math.min(i++, order.length - 1)])
  }
  return out
}

/** "+ Follow" before anything is typed: what the owner said they follow (19.10.2026). */
export const SUGGESTIONS: readonly NewFollowInput[] = [
  { kind: 'team', ref: '432', name: 'Galatasaray', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', league: 'tur.1' },
  { kind: 'league', ref: 'uefa.champions', name: 'UEFA Champions League', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png', league: 'uefa.champions' },
  { kind: 'league', ref: 'fifa.world', name: 'FIFA World Cup', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/4.png', league: 'fifa.world' },
  { kind: 'league', ref: 'uefa.euro', name: 'UEFA European Championship', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/74.png', league: 'uefa.euro' },
]

export const isFollowed = (follows: readonly FootballFollow[], kind: 'team' | 'league', ref: string) =>
  follows.some(f => f.kind === kind && f.ref === ref)

/** The score line of a played (or live) match: "2–1"; null before kick-off. */
export function scoreText(m: Pick<FbMatch, 'home' | 'away'>): string | null {
  return m.home.score == null || m.away.score == null ? null : `${m.home.score}–${m.away.score}`
}
