// The ESPN reads shared by the page's hooks, the subscription (footballSync) and
// the favourites' glance (useFavouriteTeamsGlance): one cache entry per answer,
// however it is asked for.
import { qk, STALE } from '../../../shared/query'
import { fetchLeagueMonth, fetchMatch, fetchStandings, fetchTeam, fetchTeamFixtures, fetchTeamResults } from '../api/espnApi'
import type { FbMatch } from '../footballModel'

// ESPN answers: one retry (a slow answer isn't worth three), kept while the page is away.
export const ESPN = { retry: 1, gcTime: 30 * 60_000 } as const

/** Read again every minute while a match is played — or should have started (up to three hours past kick-off),
 *  so a page left open moves it from Coming up to Live by itself. */
export const LIVE_EVERY = 60_000
export const needsLive = (m: FbMatch, now = Date.now()) =>
  m.state === 'in' || (m.state === 'pre' && Date.parse(m.kickoff) <= now && now - Date.parse(m.kickoff) < 3 * 3_600_000)

export const teamFixturesQuery = (teamId: string) => ({
  queryKey: qk.football.fixtures(teamId), queryFn: () => fetchTeamFixtures(teamId), staleTime: STALE.default, ...ESPN,
})
export const teamResultsQuery = (teamId: string) => ({
  queryKey: qk.football.results(teamId), queryFn: () => fetchTeamResults(teamId), staleTime: STALE.default, ...ESPN,
})
export const leagueMonthQuery = (league: string, month: string) => ({
  queryKey: qk.football.month(league, month), queryFn: () => fetchLeagueMonth(league, month), staleTime: STALE.default, ...ESPN,
})
export const matchQuery = (league: string, eventId: string) => ({
  queryKey: qk.football.match(league, eventId), queryFn: () => fetchMatch(league, eventId), staleTime: STALE.live, ...ESPN,
})
export const standingsQuery = (league: string) => ({
  queryKey: qk.football.standings(league), queryFn: () => fetchStandings(league), staleTime: STALE.long, ...ESPN,
})
export const teamInfoQuery = (league: string, teamId: string) => ({
  queryKey: qk.football.team(league, teamId), queryFn: () => fetchTeam(league, teamId), staleTime: STALE.long, ...ESPN,
})

