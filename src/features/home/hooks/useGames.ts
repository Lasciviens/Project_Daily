import { useQuery } from '@tanstack/react-query'
import { fetchGameStats, fetchRecentGames, fetchGames } from '../api/gamesApi'
import { rp5 } from '../../../integrations/rp5-library/client'

export function useGameStats() {
  return useQuery({
    queryKey:  ['rp5', 'stats'],
    queryFn:   fetchGameStats,
    enabled:   !!rp5,
    staleTime: 5 * 60 * 1000,
  })
}

export function useRecentGames(limit = 6) {
  return useQuery({
    queryKey:  ['rp5', 'recent', limit],
    queryFn:   () => fetchRecentGames(limit),
    enabled:   !!rp5,
    staleTime: 5 * 60 * 1000,
  })
}

export function useGames(status?: string) {
  return useQuery({
    queryKey:  ['rp5', 'games', status ?? 'all'],
    queryFn:   () => fetchGames(status),
    enabled:   !!rp5,
    staleTime: 5 * 60 * 1000,
  })
}
