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

export interface LeagueGroup {
  league: string
  name: string
  /** Shown at once: all of them up to `keep`; past that every match of a followed team, else the first `keep`. */
  matches: FbMatch[]
  /** The rest of that day's competition, folded into one "8 more" line. */
  more: FbMatch[]
}
export interface DayMatches { date: string; leagues: LeagueGroup[] }

/**
 * Matches (in the order given) by Norwegian day, and inside a day by
 * competition in order of first kick-off. A followed team's match is never
 * folded away: a Champions League night has nine matches, and Galatasaray's
 * must not sit behind "Show all" (owner-critic, 19.10.2026). The others of a
 * competition fold behind one line once `keep` are shown — none are when a
 * followed team plays in it.
 */
export function byDayAndLeague(matches: readonly FbMatch[], featured: ReadonlySet<string> = new Set(), keep = 3): DayMatches[] {
  const days: DayMatches[] = []
  for (const m of matches) {
    const date = osloParts(m.kickoff).date
    let day = days.find(d => d.date === date)
    if (!day) days.push(day = { date, leagues: [] })
    const slug = m.league?.slug ?? ''
    let group = day.leagues.find(g => g.league === slug)
    if (!group) day.leagues.push(group = { league: slug, name: m.league?.name ?? 'Other', matches: [], more: [] })
    group.matches.push(m)
  }
  for (const day of days) {
    for (const g of day.leagues) {
      const all = g.matches
      const mine = all.filter(m => featured.has(m.home.team.id) || featured.has(m.away.team.id))
      g.matches = all.length <= keep ? all : mine.length ? mine : all.slice(0, keep)
      g.more = all.filter(m => !g.matches.includes(m))
    }
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

/**
 * The tables the page reads: each followed team's league first, then each
 * followed tournament that has a match in the page's window (`active`) — a
 * finished World Cup or Euro shows its old groups otherwise. Once each.
 */
export function tableLeagues(follows: readonly FootballFollow[], filter: FollowFilter, active: ReadonlySet<string>): string[] {
  const shown = filter ? follows.filter(f => f.kind === filter.kind && f.ref === filter.ref) : follows
  const out: string[] = []
  for (const f of [...shown.filter(f => f.kind === 'team'), ...shown.filter(f => f.kind === 'league' && active.has(f.ref))]) {
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
  // The five big leagues (owner, 25.10.2026: "Add 5 top league"); names and logos as ESPN's scoreboard gave them that day.
  { kind: 'league', ref: 'eng.1', name: 'English Premier League', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', league: 'eng.1' },
  { kind: 'league', ref: 'esp.1', name: 'Spanish LALIGA', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/15.png', league: 'esp.1' },
  { kind: 'league', ref: 'ger.1', name: 'German Bundesliga', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/10.png', league: 'ger.1' },
  { kind: 'league', ref: 'ita.1', name: 'Italian Serie A', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/12.png', league: 'ita.1' },
  { kind: 'league', ref: 'fra.1', name: 'French Ligue 1', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/9.png', league: 'fra.1' },
]

export const isFollowed = (follows: readonly FootballFollow[], kind: 'team' | 'league', ref: string) =>
  follows.some(f => f.kind === kind && f.ref === ref)

/** The score line of a played (or live) match: "2–1"; null before kick-off. */
export function scoreText(m: Pick<FbMatch, 'home' | 'away'>): string | null {
  return m.home.score == null || m.away.score == null ? null : `${m.home.score}–${m.away.score}`
}
