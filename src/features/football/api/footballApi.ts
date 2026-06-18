import { supabase } from '../../../integrations/supabase/client'
import type { Fixture, StandingEntry } from '../types'

async function footballFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('football-api', {
    body: { path, params },
  })
  if (error) throw new Error(error.message)
  if (data?.errors && Object.keys(data.errors).length > 0) {
    const msg = Object.values(data.errors).join(', ')
    throw new Error(msg)
  }
  return data?.response as T
}

export async function fetchFixtures(teamId: number, season: number): Promise<Fixture[]> {
  return footballFetch<Fixture[]>('/fixtures', {
    team:   String(teamId),
    season: String(season),
  })
}

export async function fetchTournamentFixtures(leagueId: number, season: number, teamId?: number): Promise<Fixture[]> {
  const params: Record<string, string> = { league: String(leagueId), season: String(season) }
  if (teamId) params.team = String(teamId)
  return footballFetch<Fixture[]>('/fixtures', params)
}

export async function fetchStandings(leagueId: number, season: number): Promise<StandingEntry[]> {
  const res = await footballFetch<Array<{ league: { standings: StandingEntry[][] } }>>('/standings', {
    league: String(leagueId),
    season: String(season),
  })
  return res?.[0]?.league?.standings?.[0] ?? []
}
