import { useQuery } from '@tanstack/react-query'
import { fetchGameStats, fetchRecentGames } from '../api/gamesApi'
import { rp5 } from '../../../integrations/rp5-library/client'

export function useGameStats() {
  return useQuery({
    queryKey: ['rp5', 'stats'],
    queryFn:  fetchGameStats,
    enabled:  !!rp5,
    staleTime: 5 * 60 * 1000,
  })
}

export function useRecentGames(limit = 3) {
  return useQuery({
    queryKey: ['rp5', 'recent', limit],
    queryFn:  () => fetchRecentGames(limit),
    enabled:  !!rp5,
    staleTime: 5 * 60 * 1000,
  })
}
