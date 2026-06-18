import { useQuery } from '@tanstack/react-query'
import { fetchFixtures, fetchTournamentFixtures, fetchStandings } from '../api/footballApi'
import { currentClubSeason } from '../types'

export function useTeamFixtures(teamId: number, season = currentClubSeason()) {
  return useQuery({
    queryKey:  ['football', 'fixtures', teamId, season],
    queryFn:   () => fetchFixtures(teamId, season),
    staleTime: 60 * 60_000,
    retry:     false,
  })
}

export function useTournamentFixtures(leagueId: number, season: number, teamId?: number) {
  return useQuery({
    queryKey:  ['football', 'tournament', leagueId, season, teamId ?? null],
    queryFn:   () => fetchTournamentFixtures(leagueId, season, teamId),
    staleTime: 60 * 60_000,
    retry:     false,
  })
}

export function useStandings(leagueId: number, season = currentClubSeason()) {
  return useQuery({
    queryKey:  ['football', 'standings', leagueId, season],
    queryFn:   () => fetchStandings(leagueId, season),
    staleTime: 6 * 60 * 60_000,
    retry:     false,
  })
}
