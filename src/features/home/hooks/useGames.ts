import { useQuery } from '@tanstack/react-query'
import { fetchGameStats, fetchRecentGames, fetchAllGames, fetchGameDetail } from '../api/gamesApi'
import { rp5 } from '../../../integrations/rp5-library/client'

export function useGameStats() {
  return useQuery({
    queryKey:  ['rp5', 'stats'],
    queryFn:   fetchGameStats,
    enabled:   !!rp5,
    staleTime: 5 * 60_000,
  })
}

export function useRecentGames(limit = 6) {
  return useQuery({
    queryKey:  ['rp5', 'recent', limit],
    queryFn:   () => fetchRecentGames(limit),
    enabled:   !!rp5,
    staleTime: 5 * 60_000,
  })
}

export function useAllGames() {
  return useQuery({
    queryKey:  ['rp5', 'all-games'],
    queryFn:   fetchAllGames,
    enabled:   !!rp5,
    staleTime: 5 * 60_000,
  })
}

export function useGameDetail(id: string | null) {
  return useQuery({
    queryKey:  ['rp5', 'game', id],
    queryFn:   () => fetchGameDetail(id!),
    enabled:   !!rp5 && !!id,
    staleTime: 10 * 60_000,
  })
}
