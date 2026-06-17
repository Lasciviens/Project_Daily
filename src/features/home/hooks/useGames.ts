import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchGameStats, fetchRecentGames, fetchAllGames, fetchGameDetail,
  fetchPlayQueue, updateGame, reorderQueue, addToQueue, removeFromQueue,
} from '../api/gamesApi'
import type { Game, GamePatch } from '../api/gamesApi'
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

export function usePlayQueue() {
  return useQuery({
    queryKey:  ['rp5', 'play-queue'],
    queryFn:   fetchPlayQueue,
    enabled:   !!rp5,
    staleTime: 2 * 60_000,
  })
}

export function useUpdateGame() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GamePatch }) => updateGame(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['rp5', 'all-games'] })
      const prev = qc.getQueryData<Game[]>(['rp5', 'all-games'])
      qc.setQueryData<Game[]>(['rp5', 'all-games'],
        old => old?.map(g => g.id === id ? { ...g, ...patch } : g) ?? []
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['rp5', 'all-games'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['rp5'] })
    },
  })
}

export function useReorderQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: reorderQueue,
    onSettled:  () => qc.invalidateQueries({ queryKey: ['rp5', 'play-queue'] }),
  })
}

export function useAddToQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addToQueue,
    onSettled:  () => qc.invalidateQueries({ queryKey: ['rp5', 'play-queue'] }),
  })
}

export function useRemoveFromQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: removeFromQueue,
    onSettled:  () => qc.invalidateQueries({ queryKey: ['rp5', 'play-queue'] }),
  })
}
