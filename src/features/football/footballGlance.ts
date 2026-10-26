// The Personal page's Football card (owner, 26.10.2026: "A new football widget
// for favourite team(s) … how they're doing and the next match"): each
// favourite team at a glance — its place in its table, its form, its next
// match or the one being played. Made only of what the Football page reads
// (the team's table, fixtures and results) and with the page's own rules —
// buildAgenda's one copy of each match and its live and coming-up windows,
// outcomeFor's form as the club popup shows it, Norway's time — so the card
// never says what the page wouldn't. Pure; checked by
// scripts/verify-football-model.cjs against real ESPN answers.
import { buildAgenda, involves, osloParts, outcomeFor, type FbMatch, type FbStandingRow, type FbStandings } from './footballModel'
import { scoreText } from './footballView'
import type { FootballFollow } from './types'

export type Outcome = 'W' | 'D' | 'L'

/** A match from the favourite's side. */
export interface GlanceMatch {
  /** ESPN's match id and its tournament's slug: `useEntityModal().open({ kind: 'football-match', eventId, league })` opens it. */
  eventId: string
  league?: string
  /** The kick-off in UTC, as ESPN gives it. */
  kickoffISO: string
  /** Norway's day of the kick-off, YYYY-MM-DD (shown through dateFormat or footballView.dayLabel). */
  day: string
  /** Norway's kick-off time, HH:MM; null while ESPN has no fixed kick-off (far-ahead fixtures show "time not set"). */
  time: string | null
  /** The other side's short name, as the page's match rows write it. */
  opponent: string
  opponentLogo?: string
  /** The favourite plays at home. */
  home: boolean
  /** The competition's name ("UEFA Champions League"). */
  competition?: string
}

export interface GlanceLive extends GlanceMatch {
  /** Home first, as football writes it and the page shows it ("2–1"); "–" if ESPN gives no score. */
  score: string
  /** ESPN's clock ("67'", "HT"); absent when ESPN gives none (the page then says "Live"). */
  minute?: string
}

export interface FavouriteTeamGlance {
  /** The follow's row (football_follows.id). */
  id: string
  /** ESPN's team id. */
  ref: string
  name: string
  logo: string | null
  /** Its league's slug (its table; its club popup: `open({ kind: 'football-team', teamId: ref, league })`); null when unknown. */
  league: string | null
  /** That league's name as its table gives it ("Turkish Super Lig"). */
  leagueName?: string
  /** Its place, points and matches played in that table; absent while the table has no row for it. */
  position?: number
  points?: number
  played?: number
  /** Its last five results, oldest first: the newest is last. */
  form: Outcome[]
  /** Its next match not yet kicked off (a postponed one is left out). */
  next?: GlanceMatch
  /** Its match being played now. */
  live?: GlanceLive
  /** Its match on the day Personal shows (any state), with the score and the result once it has them. */
  onDay?: GlanceMatch & { state: FbMatch['state']; score?: string; outcome?: Outcome }
}

/** One favourite's share of the Football page's reads. */
export interface GlanceSources {
  /** Its league: the follow's own, or the club's default league from ESPN when the follow has none. */
  league: string | null
  standings?: FbStandings | null
  /** Its fixtures and results — either may be missing while ESPN hasn't answered. */
  matches: readonly FbMatch[]
}

/** How far ahead a next match and how far back a result are looked for: past a summer break or a World Cup. */
const REACH_DAYS = 400
const FORM_LENGTH = 5

/** The favourite teams, in the order of the Following list (a tournament is never one). */
export function favouritesOf<F extends Pick<FootballFollow, 'kind' | 'favourite'>>(follows: readonly F[]): F[] {
  return follows.filter(f => f.kind === 'team' && f.favourite === true)
}

export function teamGlance(follow: Pick<FootballFollow, 'id' | 'ref' | 'name' | 'logo'>, src: GlanceSources, nowIso: string, day?: string): FavouriteTeamGlance {
  const own = new Set([follow.ref])
  const dayMatch = day ? src.matches.find(m => involves(m, own) && osloParts(m.kickoff).date === day) : undefined
  const agenda = buildAgenda(src.matches.filter(m => involves(m, own)), nowIso, { aheadDays: REACH_DAYS, resultDays: REACH_DAYS })
  const row = standingOf(src.standings, follow.ref)
  const next = agenda.upcoming.flatMap(d => d.matches).find(m => m.state === 'pre')
  const live = agenda.live[0]
  return {
    id: follow.id,
    ref: follow.ref,
    name: follow.name,
    logo: follow.logo ?? row?.team.logo ?? null,
    league: src.league,
    leagueName: src.standings?.name || undefined,
    position: row?.rank,
    points: row?.points,
    played: row?.played,
    // Results come newest first: the five newest, turned so the newest is last (as the club popup shows them).
    form: agenda.results.map(m => outcomeFor(m, follow.ref)).filter((o): o is Outcome => o !== null).slice(0, FORM_LENGTH).reverse(),
    next: next ? glanceMatch(next, follow.ref) : undefined,
    live: live ? { ...glanceMatch(live, follow.ref), score: scoreText(live) ?? '–', minute: live.clock || undefined } : undefined,
    onDay: dayMatch ? {
      ...glanceMatch(dayMatch, follow.ref), state: dayMatch.state,
      score: scoreText(dayMatch) ?? undefined, outcome: outcomeFor(dayMatch, follow.ref) ?? undefined,
    } : undefined,
  }
}

/** A team's row in its league's table(s): a group stage has one table per group. */
function standingOf(standings: FbStandings | null | undefined, teamId: string): FbStandingRow | null {
  for (const t of standings?.tables ?? []) {
    const row = t.rows.find(r => r.team.id === teamId)
    if (row) return row
  }
  return null
}

function glanceMatch(m: FbMatch, teamId: string): GlanceMatch {
  const home = m.home.team.id === teamId
  const other = home ? m.away : m.home
  const { date, time } = osloParts(m.kickoff)
  return {
    eventId: m.id,
    league: m.league?.slug,
    kickoffISO: m.kickoff,
    day: date,
    time: m.timeValid ? time : null,
    opponent: other.team.short,
    opponentLogo: other.team.logo ?? undefined,
    home,
    competition: m.league?.name,
  }
}
