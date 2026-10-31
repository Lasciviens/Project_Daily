// ESPN's football answers, read by the browser (no key; every answer carries
// access-control-allow-origin: *). Unofficial endpoints — what each is for, the
// fields read and the traps: docs/integrations/espn.md. Every answer goes
// through footballModel's parsers, which turn anything odd into "nothing".
// The only file that calls ESPN (verify-football-model checks it).
import {
  parseLeagueStandings, parseMatchDetail, parseMatches, parseRoster, parseScheduleTeam, parseSearch,
  type FbMatch, type FbMatchDetail, type FbPlayer, type FbSearchHit, type FbStandings, type FbTeamInfo,
} from '../footballModel'

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer'
const SEARCH = 'https://site.web.api.espn.com/apis/search/v2'
const TIMEOUT_MS = 12_000

export const FOOTBALL_UNAVAILABLE = 'Football data isn\'t available right now'

// What goes into a URL is checked first: an id is ESPN's number, a tournament its slug.
const TEAM_ID = /^[0-9]{1,12}$/
const EVENT_ID = /^[0-9]{1,20}$/
const SLUG = /^[a-z0-9][a-z0-9._-]{0,59}$/
export const isTeamId = (v: string) => TEAM_ID.test(v)
export const isLeagueSlug = (v: string) => SLUG.test(v)

function checked(value: string, re: RegExp, what: string): string {
  if (!re.test(value)) throw new Error(`Not a valid ESPN ${what}: ${value}`)
  return value
}

async function getJson(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new Error(`${FOOTBALL_UNAVAILABLE} (${(err as Error).name === 'TimeoutError' ? 'ESPN took too long' : 'no connection to ESPN'})`, { cause: err })
  }
  if (!res.ok) throw new Error(`${FOOTBALL_UNAVAILABLE} (ESPN answered ${res.status})`)
  try {
    return await res.json()
  } catch (err) {
    throw new Error(`${FOOTBALL_UNAVAILABLE} (ESPN's answer couldn't be read)`, { cause: err })
  }
}

/** A team's coming matches in every competition, oldest first. */
export async function fetchTeamFixtures(teamId: string): Promise<FbMatch[]> {
  return parseMatches(await getJson(`${SITE}/all/teams/${checked(teamId, TEAM_ID, 'team id')}/schedule?fixture=true`))
}

/** A team's results this season, newest first. */
export async function fetchTeamResults(teamId: string): Promise<FbMatch[]> {
  return parseMatches(await getJson(`${SITE}/all/teams/${checked(teamId, TEAM_ID, 'team id')}/schedule`))
}

/** A tournament's matches in one month (`YYYYMM` — a day range answers 400 for some). */
export async function fetchLeagueMonth(league: string, month: string): Promise<FbMatch[]> {
  if (!/^\d{6}$/.test(month)) throw new Error(`Not a month: ${month}`)
  return parseMatches(await getJson(`${SITE}/${checked(league, SLUG, 'tournament')}/scoreboard?dates=${month}`))
}

export async function fetchStandings(league: string): Promise<FbStandings> {
  return parseLeagueStandings(await getJson(`${STANDINGS}/${checked(league, SLUG, 'tournament')}/standings`))
}

/** A club (its table place, W-D-L, own league, ESPN page) from its schedule answer — see parseScheduleTeam. */
export async function fetchTeam(teamId: string): Promise<FbTeamInfo | null> {
  return parseScheduleTeam(await getJson(`${SITE}/all/teams/${checked(teamId, TEAM_ID, 'team id')}/schedule`))
}

export async function fetchRoster(league: string, teamId: string): Promise<FbPlayer[]> {
  return parseRoster(await getJson(`${SITE}/${checked(league, SLUG, 'tournament')}/teams/${checked(teamId, TEAM_ID, 'team id')}/roster`))
}

export async function fetchMatch(league: string, eventId: string): Promise<FbMatchDetail | null> {
  return parseMatchDetail(await getJson(`${SITE}/${checked(league, SLUG, 'tournament')}/summary?event=${checked(eventId, EVENT_ID, 'match id')}`))
}

/** Teams and tournaments for "+ Follow" (football only). */
export async function searchFootball(query: string): Promise<FbSearchHit[]> {
  const q = query.trim().slice(0, 60)
  if (q.length < 2) return []
  return parseSearch(await getJson(`${SEARCH}?query=${encodeURIComponent(q)}&limit=10`))
}
