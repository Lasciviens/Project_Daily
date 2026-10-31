// THE football rules — ESPN's answers turned into our own shapes, the day
// agenda, tables and what the subscription puts in your day. Pure, checked by
// scripts/verify-football-model.cjs against real ESPN answers
// (scripts/fixtures/espn/, docs/integrations/espn.md).
//
// ESPN's endpoints are unofficial: every parser takes `unknown` and turns
// anything odd into "nothing" (an empty list, a null field) — never a throw.

import { defaultGoogleTarget } from '../items/itemRules'
import type { ItemInput } from '../items/itemTypes'

// ── Our shapes ──────────────────────────────────────────────────────────────

export interface FbTeamRef {
  id:    string
  name:  string
  short: string
  abbr:  string
  logo:  string | null
}

export type MatchState = 'pre' | 'in' | 'post' | 'postponed' | 'canceled'

export interface FbSide {
  team:   FbTeamRef
  score:  number | null
  winner: boolean | null
}

export interface FbGoal {
  minute: string
  player: string
  teamId: string
  kind:   'goal' | 'penalty' | 'own goal'
}

export interface FbMatch {
  id:        string
  league:    { slug: string; name: string } | null
  /** UTC, as ESPN gives it. */
  kickoff:   string
  /** False while ESPN has no fixed kick-off time yet (far-ahead fixtures). */
  timeValid: boolean
  state:     MatchState
  /** "FT", "67'", "HT"; empty before kick-off. */
  clock:     string
  home:      FbSide
  away:      FbSide
  venue:     string | null
  city:      string | null
  round:     string | null
  goals:     FbGoal[]
}

export interface FbStandingRow {
  rank:   number
  team:   FbTeamRef
  played: number
  won:    number
  drawn:  number
  lost:   number
  gf:     number
  ga:     number
  gd:     number
  points: number
  /** Qualification place ("Qualifies for round of 16") and its colour. */
  note:   { color: string; text: string } | null
}

export interface FbTable { name: string; rows: FbStandingRow[] }

export type PositionGroup = 'Goalkeepers' | 'Defenders' | 'Midfielders' | 'Forwards' | 'Others'

export interface FbPlayer {
  id:          string
  name:        string
  number:      string | null
  position:    string | null
  group:       PositionGroup
  age:         number | null
  /** YYYY-MM-DD */
  born:        string | null
  nationality: string | null
  flag:        string | null
  heightCm:    number | null
  weightKg:    number | null
}

export interface FbTeamInfo {
  id:            string
  name:          string
  logo:          string | null
  color:         string | null
  standing:      string | null
  /** W-D-L this season, "6-1-1". */
  record:        string | null
  defaultLeague: string | null
  espnUrl:       string | null
}

export interface FbLineup {
  side:      'home' | 'away'
  formation: string | null
  starters:  Array<{ name: string; number: string | null; position: string | null }>
  bench:     Array<{ name: string; number: string | null; position: string | null }>
}

export interface FbMatchDetail {
  match:      FbMatch
  attendance: number | null
  lineups:    FbLineup[]
}

export interface FbSearchHit {
  kind:     'team' | 'league'
  /** A team's ESPN id, or a league's slug. */
  ref:      string
  name:     string
  subtitle: string | null
  logo:     string | null
  /** A team's own league (its table). */
  league:   string | null
}

// ── Reading ESPN's answers ──────────────────────────────────────────────────

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const https = (v: unknown): string | null => {
  const s = str(v)
  return s && /^https:\/\//i.test(s) ? s : null
}

/** A score as either shape ESPN uses: the scoreboard's "2", a schedule's { value, displayValue }. */
export function scoreOf(raw: unknown): number | null {
  const o = obj(raw)
  if (o) return num(o.value) ?? num(o.displayValue)
  return num(raw)
}

export function teamRefOf(raw: unknown): FbTeamRef | null {
  const t = obj(raw)
  const id = str(t?.id)
  const name = str(t?.displayName) ?? str(t?.name)
  if (!t || !id || !name) return null
  const logos = arr(t.logos).map(obj)
  return {
    id,
    name,
    short: str(t.shortDisplayName) ?? name,
    abbr: str(t.abbreviation) ?? name.slice(0, 3).toUpperCase(),
    logo: https(t.logo) ?? https(logos[0]?.href),
  }
}

function stateOf(status: Obj | null): MatchState {
  const type = obj(status?.type)
  const name = str(type?.name) ?? ''
  if (/POSTPONED|SUSPENDED|DELAYED/.test(name)) return 'postponed'
  if (/CANCEL|ABANDON|FORFEIT/.test(name)) return 'canceled'
  const state = str(type?.state)
  return state === 'in' ? 'in' : state === 'post' ? 'post' : 'pre'
}

function goalsOf(raw: unknown): FbGoal[] {
  const out: FbGoal[] = []
  for (const d of arr(raw).map(obj)) {
    if (!d || d.scoringPlay !== true) continue
    const athlete = obj(arr(d.athletesInvolved)[0])
    out.push({
      minute: str(obj(d.clock)?.displayValue) ?? '',
      player: str(athlete?.displayName) ?? '',
      teamId: str(obj(d.team)?.id) ?? '',
      kind: d.ownGoal === true ? 'own goal' : d.penaltyKick === true ? 'penalty' : 'goal',
    })
  }
  return out
}

/** One match from an event of a schedule, a scoreboard or a summary's header. */
export function matchOf(rawEvent: unknown, leagueHint: { slug: string; name: string } | null = null): FbMatch | null {
  const e = obj(rawEvent)
  const c = obj(arr(e?.competitions)[0])
  const id = str(e?.id) ?? str(c?.id)
  const kickoff = str(e?.date) ?? str(c?.date)
  if (!e || !c || !id || !kickoff || Number.isNaN(Date.parse(kickoff))) return null
  const status = obj(c.status) ?? obj(e.status)
  const state = stateOf(status)
  const sides = arr(c.competitors).map(obj)
  const sideOf = (where: 'home' | 'away'): FbSide | null => {
    const s = sides.find(x => x?.homeAway === where)
    const team = teamRefOf(s?.team)
    if (!s || !team) return null
    // A scoreboard says "0" before kick-off: no score until the match starts.
    return { team, score: state === 'in' || state === 'post' ? scoreOf(s.score) : null, winner: typeof s.winner === 'boolean' ? s.winner : null }
  }
  const home = sideOf('home')
  const away = sideOf('away')
  if (!home || !away) return null
  const league = obj(e.league)
  const venue = obj(c.venue)
  return {
    id,
    league: league && str(league.slug) && str(league.name) ? { slug: str(league.slug)!, name: str(league.name)! } : leagueHint,
    kickoff,
    timeValid: (e.timeValid ?? c.timeValid) !== false,
    state,
    clock: state === 'pre' ? '' : state === 'in' ? (str(obj(status?.type)?.shortDetail) === 'HT' ? 'HT' : str(status?.displayClock) ?? '') : str(obj(status?.type)?.shortDetail) ?? '',
    home,
    away,
    venue: str(venue?.fullName),
    city: str(obj(venue?.address)?.city),
    round: str(obj(e.seasonType)?.name),
    goals: goalsOf(c.details),
  }
}

/** A team's schedule (fixtures or results) or a scoreboard: its matches, ESPN's order kept. */
export function parseMatches(raw: unknown): FbMatch[] {
  const d = obj(raw)
  const l = obj(arr(d?.leagues)[0])
  const hint = l && str(l.slug) && str(l.name) ? { slug: str(l.slug)!, name: str(l.name)! } : null
  return arr(d?.events).map(e => matchOf(e, hint)).filter((m): m is FbMatch => m !== null)
}

export function parseStandings(raw: unknown): FbTable[] {
  const d = obj(raw)
  const groups = arr(d?.children).length ? arr(d?.children) : d?.standings ? [d] : []
  const out: FbTable[] = []
  for (const g of groups.map(obj)) {
    const rows: FbStandingRow[] = []
    for (const e of arr(obj(g?.standings)?.entries).map(obj)) {
      const team = teamRefOf(e?.team)
      if (!e || !team) continue
      const stat = (name: string) => {
        const s = arr(e.stats).map(obj).find(x => x?.name === name)
        return num(s?.value) ?? num(s?.displayValue) ?? 0
      }
      const note = obj(e.note)
      rows.push({
        rank: stat('rank') || num(note?.rank) || rows.length + 1,
        team,
        played: stat('gamesPlayed'), won: stat('wins'), drawn: stat('ties'), lost: stat('losses'),
        gf: stat('pointsFor'), ga: stat('pointsAgainst'), gd: stat('pointDifferential'), points: stat('points'),
        note: note && str(note.description) ? { color: /^#[0-9a-f]{6}$/i.test(str(note.color) ?? '') ? str(note.color)! : '#888888', text: str(note.description)! } : null,
      })
    }
    if (rows.length) out.push({ name: str(g?.name) ?? '', rows: rows.sort((a, b) => a.rank - b.rank) })
  }
  return out
}

export interface FbStandings { name: string; tables: FbTable[] }

/** A tournament's name ("UEFA Champions League") with its tables ("League Phase"). */
export function parseLeagueStandings(raw: unknown): FbStandings {
  return { name: str(obj(raw)?.name) ?? '', tables: parseStandings(raw) }
}

const GROUPS: Record<string, PositionGroup> = { G: 'Goalkeepers', D: 'Defenders', M: 'Midfielders', F: 'Forwards' }
export const GROUP_ORDER: readonly PositionGroup[] = ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Others']

export function playerOf(raw: unknown): FbPlayer | null {
  const a = obj(raw)
  const id = str(a?.id)
  const name = str(a?.displayName) ?? str(a?.fullName)
  if (!a || !id || !name) return null
  const pos = obj(a.position)
  const abbr = str(pos?.abbreviation)?.[0]?.toUpperCase() ?? ''
  const inches = num(a.height)
  const lbs = num(a.weight)
  const born = str(a.dateOfBirth)?.slice(0, 10) ?? null
  return {
    id, name,
    number: str(a.jersey),
    position: str(pos?.displayName) ?? str(pos?.name),
    group: GROUPS[abbr] ?? 'Others',
    age: num(a.age),
    born: born && /^\d{4}-\d{2}-\d{2}$/.test(born) ? born : null,
    nationality: str(a.citizenship),
    flag: https(obj(a.flag)?.href),
    heightCm: inches && inches > 40 && inches < 100 ? Math.round(inches * 2.54) : null,
    weightKg: lbs && lbs > 70 && lbs < 400 ? Math.round(lbs * 0.4536) : null,
  }
}

export function parseRoster(raw: unknown): FbPlayer[] {
  return arr(obj(raw)?.athletes).map(playerOf).filter((p): p is FbPlayer => p !== null)
}

/** The squad by position group, each by shirt number. */
export function squadGroups(players: readonly FbPlayer[]): Array<{ group: PositionGroup; players: FbPlayer[] }> {
  const byNumber = (a: FbPlayer, b: FbPlayer) => (num(a.number) ?? 999) - (num(b.number) ?? 999) || a.name.localeCompare(b.name)
  return GROUP_ORDER
    .map(group => ({ group, players: players.filter(p => p.group === group).sort(byNumber) }))
    .filter(g => g.players.length > 0)
}

/**
 * A club from its schedule answer (`all/teams/{id}/schedule`, the one its results come from). ESPN's own club
 * address (`/teams/{id}`) stopped sending the header a browser needs to read it (checked 31.10.2026), so the club
 * popup said "Couldn't load this club"; the schedule answer carries the same club fields and still sends it.
 */
export function parseScheduleTeam(raw: unknown): FbTeamInfo | null {
  const d = obj(raw)
  const t = obj(d?.team)
  const ref = teamRefOf(t)
  if (!d || !t || !ref) return null
  const color = str(t.color)
  return {
    id: ref.id, name: ref.name, logo: ref.logo,
    color: color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null,
    standing: str(t.standingSummary),
    record: str(t.recordSummary),
    defaultLeague: scheduleLeague(d),
    espnUrl: https(t.clubhouse),
  }
}

/** "2026-27 Turkish Super Lig" → "turkish super lig": a season's or a league's name without its years. */
const leagueWords = (v: string | null) => (v ?? '').toLowerCase().replace(/^\d{4}(?:[-/]\d{2,4})?\s+/, '').trim()

/**
 * The club's own league from its schedule: the league its season is named after ("2026-27 LALIGA" is
 * "Spanish LALIGA"'s), else the one it played most in, friendlies aside. Null when nothing fits — the squad,
 * which needs a real league, then says ESPN has none.
 */
function scheduleLeague(d: Obj): string | null {
  const leagues = arr(d.events).map(e => obj(obj(e)?.league)).filter((l): l is Obj => !!l && !!str(l.slug))
  const season = leagueWords(str(obj(d.season)?.name) ?? str(obj(d.requestedSeason)?.name))
  const named = season ? leagues.find(l => {
    const name = leagueWords(str(l.name))
    return !!name && (name === season || name.endsWith(` ${season}`) || season.endsWith(` ${name}`))
  }) : undefined
  if (named) return str(named.slug)
  const count = new Map<string, number>()
  for (const l of leagues) {
    const slug = str(l.slug)!
    if (!/friendly/.test(slug)) count.set(slug, (count.get(slug) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function parseMatchDetail(raw: unknown, leagueHint: { slug: string; name: string } | null = null): FbMatchDetail | null {
  const d = obj(raw)
  const header = obj(d?.header)
  const match = matchOf(header ? { ...header, competitions: arr(header.competitions), league: header.league } : null, leagueHint)
  if (!d || !match) return null
  const info = obj(d.gameInfo)
  const venue = obj(info?.venue)
  if (!match.venue && venue) {
    match.venue = str(venue.fullName)
    match.city = str(obj(venue.address)?.city)
  }
  const lineups: FbLineup[] = []
  for (const r of arr(d.rosters).map(obj)) {
    const side = r?.homeAway === 'home' || r?.homeAway === 'away' ? r.homeAway : null
    if (!r || !side) continue
    const people = arr(r.roster).map(obj).filter((p): p is Obj => !!p && !!str(obj(p.athlete)?.displayName))
    const person = (p: Obj) => ({
      name: str(obj(p.athlete)?.displayName)!,
      number: str(p.jersey),
      position: str(obj(p.position)?.abbreviation),
    })
    lineups.push({
      side,
      formation: str(r.formation),
      starters: people.filter(p => p.starter === true).map(person),
      bench: people.filter(p => p.starter !== true).map(person),
    })
  }
  return { match, attendance: num(info?.attendance) || null, lineups }
}

/** Search hits that are football teams or tournaments. */
export function parseSearch(raw: unknown): FbSearchHit[] {
  const out: FbSearchHit[] = []
  for (const r of arr(obj(raw)?.results).map(obj)) {
    const kind = r?.type === 'team' ? 'team' : r?.type === 'league' ? 'league' : null
    if (!r || !kind) continue
    for (const c of arr(r.contents).map(obj)) {
      if (!c || c.sport !== 'soccer') continue
      const name = str(c.displayName)
      const leagueSlug = str(c.defaultLeagueSlug)
      const ref = kind === 'team' ? /~t:(\d+)$/.exec(str(c.uid) ?? '')?.[1] ?? null : leagueSlug
      if (!name || !ref) continue
      out.push({ kind, ref, name, subtitle: str(c.subtitle), logo: https(obj(c.image)?.default), league: kind === 'team' ? leagueSlug : ref })
    }
  }
  return out
}

// ── Time ────────────────────────────────────────────────────────────────────

const OSLO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** A kick-off's day and time in Norway: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function osloParts(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(OSLO.formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// ── The page: what's live, what's next, what happened ───────────────────────

export interface DayGroup { date: string; matches: FbMatch[] }

export interface Agenda {
  live:     FbMatch[]
  upcoming: DayGroup[]
  /** Newest first. */
  results:  FbMatch[]
}

const byKickoff = (a: FbMatch, b: FbMatch) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id)

/** Matches from every followed team and tournament → one agenda: no match twice,
 *  upcoming grouped by Norwegian day, results of the last `resultDays` days. */
export function buildAgenda(matches: readonly FbMatch[], nowIso: string, opts: { aheadDays?: number; resultDays?: number } = {}): Agenda {
  const now = Date.parse(nowIso)
  const ahead = now + (opts.aheadDays ?? 30) * 86_400_000
  const since = now - (opts.resultDays ?? 10) * 86_400_000
  const seen = new Map<string, FbMatch>()
  for (const m of matches) {
    const had = seen.get(m.id)
    // The same match from two sources: keep the one that knows more (a score, a live clock).
    if (!had || (had.state === 'pre' && m.state !== 'pre') || (had.home.score == null && m.home.score != null)) seen.set(m.id, m)
  }
  const all = [...seen.values()]
  const live = all.filter(m => m.state === 'in').sort(byKickoff)
  const upcoming = all.filter(m => (m.state === 'pre' || m.state === 'postponed') && Date.parse(m.kickoff) <= ahead && Date.parse(m.kickoff) >= now - 3 * 3_600_000)
    .sort(byKickoff)
  const groups: DayGroup[] = []
  for (const m of upcoming) {
    const date = osloParts(m.kickoff).date
    const g = groups[groups.length - 1]
    if (g && g.date === date) g.matches.push(m)
    else groups.push({ date, matches: [m] })
  }
  const results = all.filter(m => m.state === 'post' && Date.parse(m.kickoff) >= since).sort((a, b) => byKickoff(b, a))
  return { live, upcoming: groups, results }
}

/** "W", "D" or "L" for a team in a finished match (null when it didn't play or isn't finished). */
export function outcomeFor(m: FbMatch, teamId: string): 'W' | 'D' | 'L' | null {
  if (m.state !== 'post' || m.home.score == null || m.away.score == null) return null
  const mine = m.home.team.id === teamId ? m.home : m.away.team.id === teamId ? m.away : null
  if (!mine) return null
  const other = mine === m.home ? m.away : m.home
  if (mine.winner === true) return 'W'
  if (other.winner === true) return 'L'
  return mine.score! > other.score! ? 'W' : mine.score! < other.score! ? 'L' : 'D'
}

/** Whether a match involves one of these teams. */
export function involves(m: FbMatch, teamIds: ReadonlySet<string>): boolean {
  return teamIds.has(m.home.team.id) || teamIds.has(m.away.team.id)
}

/** The rows of a long table worth showing: the top `top`, and `around` either side of each
 *  highlighted team; `null` marks a gap. A short table (≤ top + 4) is shown whole. */
export function tableSlice(rows: readonly FbStandingRow[], highlight: ReadonlySet<string>, top = 4, around = 2): Array<FbStandingRow | null> {
  if (rows.length <= top + 4) return [...rows]
  const keep = new Set<number>()
  for (let i = 0; i < Math.min(top, rows.length); i++) keep.add(i)
  rows.forEach((r, i) => {
    if (!highlight.has(r.team.id)) return
    for (let j = Math.max(0, i - around); j <= Math.min(rows.length - 1, i + around); j++) keep.add(j)
  })
  const out: Array<FbStandingRow | null> = []
  let last = -1
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (last >= 0 && i > last + 1) out.push(null)
    out.push(rows[i])
    last = i
  }
  if (last < rows.length - 1) out.push(null)
  return out
}

// ── Into your day ───────────────────────────────────────────────────────────

/** How long a planned match blocks: 90 minutes, half time and a little either side. */
export const MATCH_MINUTES = 120
/** How far ahead the subscription plans (fixtures further out rarely have a fixed time). */
export const PLAN_AHEAD_DAYS = 45

/** "⚽ Lille – Galatasaray" — home first, as football writes it. */
export function matchTitle(m: Pick<FbMatch, 'home' | 'away'>): string {
  return `⚽ ${m.home.team.short} – ${m.away.team.short}`
}

export interface MatchItem {
  title:           string
  notes:           string | null
  date:            string
  /** Null while ESPN has no fixed kick-off. */
  time:            string | null
  durationMinutes: number | null
}

/** A match as an item in your day: its title, Norwegian day and kick-off, two hours, the competition and stadium as notes. */
export function matchItem(m: FbMatch): MatchItem {
  const { date, time } = osloParts(m.kickoff)
  const notes = [m.league?.name, m.round, m.venue && (m.city ? `${m.venue}, ${m.city}` : m.venue)].filter(Boolean).join(' · ')
  return {
    title: matchTitle(m),
    notes: notes || null,
    date,
    time: m.timeValid ? time : null,
    durationMinutes: m.timeValid ? MATCH_MINUTES : null,
  }
}

export interface PlanRow {
  event_id:   string
  /** Null once you deleted the item: never planned again. */
  task_id:    string | null
  kickoff_at: string
  time_valid: boolean
}

export interface SyncPlan<P extends PlanRow = PlanRow> {
  /** Subscribed matches not in your day yet. */
  add:  FbMatch[]
  /** Planned matches whose kick-off ESPN moved (or fixed): the item follows. */
  move: Array<{ match: FbMatch; plan: P }>
}

/**
 * What the subscription changes: every match of a subscribed team with a fixed
 * kick-off in the next PLAN_AHEAD_DAYS is added once (a match whose item you
 * deleted is never added again); a planned match — subscribed or planned by
 * hand — whose kick-off moved follows it. A finished, cancelled or postponed
 * match is left as it is.
 */
export function syncPlan<P extends PlanRow>(matches: readonly FbMatch[], subscribedTeamIds: ReadonlySet<string>, plans: readonly P[], nowIso: string): SyncPlan<P> {
  const now = Date.parse(nowIso)
  const until = now + PLAN_AHEAD_DAYS * 86_400_000
  const planOf = new Map(plans.map(p => [p.event_id, p]))
  const seen = new Set<string>()
  const add: FbMatch[] = []
  const move: SyncPlan<P>['move'] = []
  for (const m of [...matches].sort(byKickoff)) {
    if (seen.has(m.id) || m.state !== 'pre') continue
    seen.add(m.id)
    const at = Date.parse(m.kickoff)
    const plan = planOf.get(m.id)
    if (plan) {
      if (plan.task_id && at > now && (Date.parse(plan.kickoff_at) !== at || plan.time_valid !== m.timeValid)) move.push({ match: m, plan })
      continue
    }
    if (m.timeValid && at > now && at <= until && involves(m, subscribedTeamIds)) add.push(m)
  }
  return { add, move }
}

/**
 * What leaves your day when a team's subscription stops (Unsubscribe, or
 * Unfollow of a subscribed team — owner, 25.10.2026: "When unsubscribed from a
 * team it does not remove the events"): the plans the subscription added for
 * that team's coming fixtures, still in the day, not kicked off. A match you
 * planned yourself (Plan it) stays, and so does one another subscribed team
 * plays in. The caller also keeps done items (they are yours).
 */
export function subscriptionLeavers<P extends PlanRow & { origin: string }>(
  teamId: string, fixtures: readonly FbMatch[], plans: readonly P[], otherSubscribed: ReadonlySet<string>, nowIso: string,
): P[] {
  const now = Date.parse(nowIso)
  const team = new Set([teamId])
  const theirs = new Set(fixtures.filter(m => involves(m, team) && !involves(m, otherSubscribed)).map(m => m.id))
  return plans.filter(p => p.origin === 'subscription' && !!p.task_id && theirs.has(p.event_id) && Date.parse(p.kickoff_at) > now)
}

/** A match's slot category (165; owner, 16.10.2026: "should mark as football not personal" — the area stays Personal). */
export const MATCH_CATEGORY = 'football'

/** A subscribed match as a new item: personal, its slot a Football one, Google as for any item (a time → Calendar). */
export function newMatchItem(m: FbMatch): ItemInput {
  const mi = matchItem(m)
  return {
    title: mi.title, notes: mi.notes, domain: 'personal', priority: 'medium', category: MATCH_CATEGORY,
    date: mi.date, time: mi.time, durationMinutes: mi.durationMinutes,
    google: defaultGoogleTarget({ time: mi.time, repeat: null }),
  }
}

/**
 * Whether a planned item still sits where its match was planned — its day,
 * and its time when the kick-off was fixed. Only then does a new kick-off
 * move it: an item the owner moved (a replay at 22:00) stays theirs.
 */
export function itemAtKickoff(item: Pick<ItemInput, 'date' | 'time'>, plan: Pick<PlanRow, 'kickoff_at' | 'time_valid'>): boolean {
  const { date, time } = osloParts(plan.kickoff_at)
  return item.date === date && (!plan.time_valid || item.time === time)
}

/** A planned match's item at ESPN's new kick-off: its title, notes, Google choice and length are the owner's and stay
 *  (an item that blocks no time keeps blocking none; one that had no time yet gets two hours). */
export function movedMatchItem(item: ItemInput, m: FbMatch): ItemInput {
  const mi = matchItem(m)
  return {
    ...item, scope: 'item', section: null, deadline: null,
    date: mi.date, time: mi.time,
    durationMinutes: !mi.time ? null : item.time ? item.durationMinutes : MATCH_MINUTES,
  }
}

/** The months of a tournament's matches the page reads (`YYYYMM`, Norway's calendar): this one and
 *  the next, and the last one while the last `resultDays` reach into it. */
export function leagueMonths(nowIso: string, resultDays = 10): string[] {
  const ym = (iso: string) => osloParts(iso).date.slice(0, 7).replace('-', '')
  const now = ym(nowIso)
  const y = Number(now.slice(0, 4))
  const m = Number(now.slice(4))
  const next = m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`
  const back = ym(new Date(Date.parse(nowIso) - resultDays * 86_400_000).toISOString())
  return back !== now ? [back, now, next] : [now, next]
}
