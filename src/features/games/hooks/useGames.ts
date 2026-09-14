import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  fetchGameStats, fetchAllGames, fetchGameDetail, fetchGamesNeedingReview, fetchPlayQueue,
  createGame, updateGame, deleteGame, reorderQueue, addToQueue, removeFromQueue,
  addPlatform, updatePlatform, deletePlatform, setPrimaryVariant, setPlayStatus,
} from '../api/gamesApi'
import type { Game, GamePatch, CreateGameInput, GamePlatformInput, PlayStatus } from '../types'

const GAMES_QK  = ['games', 'all']
const QUEUE_QK  = ['games', 'queue']
const STATS_QK  = ['games', 'stats']
const REVIEW_QK = ['games', 'needs-review']

// Every mutation below invalidates the WHOLE 'games' namespace rather than
// one narrow key — the same reasoning this app already applies to schedule
// mutations (CLAUDE.md: "never give a view its own private query key"): a
// play_status/tier/rating edit changes what the Library, Queue, Stats AND
// Needs-Review views all show, so a targeted invalidation would just be a
// second bug waiting to happen the next time one of those reads is added.

export function useGameStats() {
  return useQuery({ queryKey: STATS_QK, queryFn: fetchGameStats, staleTime: 60_000 })
}

export function useAllGames() {
  return useQuery({ queryKey: GAMES_QK, queryFn: fetchAllGames, staleTime: 60_000 })
}

export function useGameDetail(id: string | null) {
  return useQuery({ queryKey: ['games', 'detail', id], queryFn: () => fetchGameDetail(id!), enabled: !!id, staleTime: 60_000 })
}

export function useGamesNeedingReview() {
  return useQuery({ queryKey: REVIEW_QK, queryFn: fetchGamesNeedingReview, staleTime: 60_000 })
}

export function usePlayQueue() {
  return useQuery({ queryKey: QUEUE_QK, queryFn: fetchPlayQueue, staleTime: 30_000 })
}

function invalidateAllGames(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['games'] })
}

export function useCreateGame() {
  const qc = useQueryClient()
  return useMutationWithFeedback<Game, CreateGameInput>({
    action: 'create_game',
    successMessage: g => `"${g.title}" added ✓`,
    mutationFn: createGame,
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useUpdateGame() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; patch: GamePatch }>({
    action: 'update_game',
    mutationFn: ({ id, patch }) => updateGame(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: GAMES_QK })
      const prev = qc.getQueryData<Game[]>(GAMES_QK)
      qc.setQueryData<Game[]>(GAMES_QK, old => old?.map(g => g.id === id ? { ...g, ...patch } : g) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      const prev = (ctx as { prev?: Game[] } | undefined)?.prev
      if (prev) qc.setQueryData(GAMES_QK, prev)
    },
    onSettled: () => invalidateAllGames(qc),
  })
}

export function useSetPlayStatus() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; status: PlayStatus }>({
    action: 'set_play_status',
    successMessage: (_d, v) => `Marked as ${v.status} ✓`,
    mutationFn: ({ id, status }) => setPlayStatus(id, status),
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useDeleteGame() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string>({
    action: 'delete_game',
    successMessage: 'Game deleted',
    mutationFn: deleteGame,
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useReorderQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; play_order: number }[]>({
    action: 'reorder_play_queue',
    mutationFn: reorderQueue,
    onSettled: () => qc.invalidateQueries({ queryKey: QUEUE_QK }),
  })
}

export function useAddToQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string>({
    action: 'add_to_play_queue',
    successMessage: '🎮 Added to Play Queue ✓',
    mutationFn: addToQueue,
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useRemoveFromQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string>({
    action: 'remove_from_play_queue',
    successMessage: 'Removed from queue',
    mutationFn: removeFromQueue,
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useAddPlatform() {
  const qc = useQueryClient()
  return useMutationWithFeedback<unknown, { gameId: string; input: GamePlatformInput }>({
    action: 'add_game_platform',
    successMessage: 'Platform added ✓',
    mutationFn: ({ gameId, input }) => addPlatform(gameId, input),
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useUpdatePlatform() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; patch: Partial<GamePlatformInput> }>({
    action: 'update_game_platform',
    mutationFn: ({ id, patch }) => updatePlatform(id, patch),
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useDeletePlatform() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string>({
    action: 'delete_game_platform',
    successMessage: 'Platform removed',
    mutationFn: deletePlatform,
    onSuccess: () => invalidateAllGames(qc),
  })
}

export function useSetPrimaryVariant() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { gameId: string; platformId: string }>({
    action: 'set_primary_variant',
    successMessage: 'Primary platform updated ✓',
    mutationFn: ({ gameId, platformId }) => setPrimaryVariant(gameId, platformId),
    onSuccess: () => invalidateAllGames(qc),
  })
}
