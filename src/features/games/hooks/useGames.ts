import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import {
  fetchGameStats, fetchAllGames, fetchGameDetail, fetchPlayQueue,
  createGame, updateGame, reorderQueue, addToQueue, removeFromQueue, removeManyFromQueue,
  addPlatform, updatePlatform, setPrimaryVariant, setPlayStatus,
  fetchLibraryGames, fetchLastPlayed,
} from '../api/gamesApi'
import { qk } from '../../../shared/query'
import { nextQueuePosition, patchGameData, statusPatch } from '../api/gameCachePatch'
import type { Game, GamePatch, CreateGameInput, GamePlatformInput, PlayStatus, GameLibrary } from '../types'

const GAMES_QK  = ['games', 'all']
const QUEUE_QK  = ['games', 'queue']
const STATS_QK  = ['games', 'stats']

// Every mutation below reaches the WHOLE 'games' namespace rather than one
// narrow key — the same reasoning this app applies to schedule mutations
// (.claude/rules/planning.md: "never give a view its own private query key"). One-row edits
// (status, rating, queue) patch every cached read optimistically and mark the
// big lists stale without refetching them (settleRowEdit); create, delete and
// platform changes still refetch everything.

export function useGameStats(enabled = true) {
  return useQuery({ queryKey: STATS_QK, queryFn: fetchGameStats, staleTime: 60_000, enabled })
}

/** How long the big library reads count as fresh. One-row edits patch the
 *  cache directly, so the lists only need a full read for changes made
 *  elsewhere (an ES-DE push, a scrape) — the page's "Refresh library". */
export const LIBRARY_STALE_MS = 10 * 60_000

export function useAllGames() {
  return useQuery({ queryKey: GAMES_QK, queryFn: fetchAllGames, staleTime: LIBRARY_STALE_MS })
}

/** Everything under ['games'] now — the explicit "Refresh library". */
export function useRefreshGames() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['games'] })
}

export function useGameDetail(id: string | null, opts?: { refetchOnMount?: boolean | 'always' }) {
  return useQuery({
    queryKey: ['games', 'detail', id], queryFn: () => fetchGameDetail(id!), enabled: !!id, staleTime: 60_000,
    ...(opts?.refetchOnMount !== undefined && { refetchOnMount: opts.refetchOnMount }),
  })
}

/** The game played last up to `day` (one row). */
export function useLastPlayed(day: string) {
  return useQuery({ queryKey: qk.games.lastPlayed(day), queryFn: () => fetchLastPlayed(day), staleTime: LIBRARY_STALE_MS })
}

export function usePlayQueue(enabled = true) {
  return useQuery({ queryKey: QUEUE_QK, queryFn: fetchPlayQueue, staleTime: 30_000, enabled })
}

const NO_GAMES: Game[] = Object.freeze([]) as unknown as Game[]

type QC = ReturnType<typeof useQueryClient>
type Snapshot = [readonly unknown[], unknown][]
/** What an optimistic edit needs to undo itself, and the reads it interrupted. */
interface EditCtx { snapshot: Snapshot; interrupted: string[] }

function invalidateAllGames(qc: QC) {
  qc.invalidateQueries({ queryKey: ['games'] })
}

/**
 * Patch one row in every cached games read (optimistic), returning what to
 * restore on failure. In-flight reads are cancelled first so a slow refetch
 * cannot land the old value over the patch.
 */
async function beginEdit(qc: QC, apply: () => void): Promise<EditCtx> {
  // Reads cancelled here are re-run when the edit settles — a cancelled
  // first load must never be left stuck without data.
  const interrupted = qc.getQueryCache().findAll({ queryKey: ['games'], fetchStatus: 'fetching' }).map(q => q.queryHash)
  await qc.cancelQueries({ queryKey: ['games'] })
  const snapshot = qc.getQueriesData({ queryKey: ['games'] })
  apply()
  return { snapshot, interrupted }
}

function patchGameCaches(qc: QC, id: string, patch: object): Promise<EditCtx> {
  return beginEdit(qc, () => qc.setQueriesData({ queryKey: ['games'] }, d => patchGameData(d, id, patch)))
}

function restore(qc: QC, ctx: EditCtx | undefined) {
  for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
}

/**
 * After a one-row edit: the big list reads are only marked stale (the patch
 * already shows the change — no multi-megabyte refetch per tap; they refresh
 * on the next focus or visit), while the small reads that derive from many
 * rows — queue, stats, the open detail — refetch now.
 */
function settleRowEdit(qc: QC, ctx: EditCtx | undefined) {
  qc.invalidateQueries({ queryKey: ['games'], refetchType: 'none' })
  qc.invalidateQueries({ queryKey: QUEUE_QK })
  qc.invalidateQueries({ queryKey: STATS_QK })
  qc.invalidateQueries({ queryKey: ['games', 'detail'] })
  const interrupted = new Set(ctx?.interrupted ?? [])
  if (interrupted.size) qc.refetchQueries({ predicate: q => interrupted.has(q.queryHash) })
}

/** The cached row, from whichever read holds it (for the status rule's current dates). */
function cachedRow(qc: QC, id: string): Game | undefined {
  for (const [, d] of qc.getQueriesData<unknown>({ queryKey: ['games'] })) {
    const rows = Array.isArray(d) ? d : null
    const hit = rows?.find(r => (r as Game)?.id === id)
    if (hit) return hit as Game
  }
  return undefined
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

/**
 * A one-row edit (rating, notes, flags, …), shown at once in every cached
 * read. `scopeId` (e.g. `game-<id>`) runs a game's writes one at a time, so
 * rapid taps land in the order they were made.
 */
/** What a one-row edit tells you. */
function gameEditMessage(patch: GamePatch): string {
  const keys = Object.keys(patch)
  if (keys.length === 1) {
    if ('rating' in patch) return patch.rating == null ? 'Rating cleared' : 'Rating saved'
    if ('play_notes' in patch) return 'Notes saved'
    if ('needs_review' in patch) return patch.needs_review ? 'Marked for review' : 'Review mark removed'
    if ('is_iconic' in patch || 'is_coop' in patch) return 'Saved'
  }
  return 'Game saved'
}

export function useUpdateGame(scopeId?: string) {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; patch: GamePatch }, EditCtx>({
    action: 'update_game',
    successMessage: (_d, v) => gameEditMessage(v.patch),
    ...(scopeId && { scope: { id: scopeId } }),
    mutationFn: ({ id, patch }) => updateGame(id, patch),
    onMutate: ({ id, patch }) => patchGameCaches(qc, id, patch),
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
  })
}

export function useSetPlayStatus(scopeId?: string) {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; status: PlayStatus }, EditCtx>({
    action: 'set_play_status',
    ...(scopeId && { scope: { id: scopeId } }),
    successMessage: (_d, v) => `Marked as ${v.status} ✓`,
    mutationFn: ({ id, status }) => setPlayStatus(id, status),
    // The same dates the server stamps (statusPatch), so an auto-promoted
    // Playing that is confirmed leaves the "undecided" group immediately.
    onMutate: ({ id, status }) => patchGameCaches(qc, id, statusPatch(cachedRow(qc, id) ?? null, status, new Date().toISOString())),
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
  })
}

/**
 * Deletes a game with Undo (its platforms come back too). The screens ask
 * with their own dialog (Hide instead / Delete anyway), so the flow does not
 * ask again. ScreenScraper's history of the game can't be written back from
 * here — Undo says so.
 */
export function useDeleteGame() {
  return useRowsDelete({
    table: 'games', action: 'delete_game', invalidates: [['games']],
    names: { scrape_decisions: 'its ScreenScraper history', game_scrape_records: 'its ScreenScraper record' },
  })
}

export function useReorderQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, { id: string; play_order: number }[], EditCtx>({
    action: 'reorder_play_queue',
    successMessage: 'Queue order saved',
    mutationFn: reorderQueue,
    // Every cached read gets the new positions at once (the Library, the
    // provider libraries and the queue all read play_order), then only the
    // small reads refetch — a drag no longer reloads the whole library.
    onMutate: (updates) => beginEdit(qc, () => {
      for (const u of updates) qc.setQueriesData({ queryKey: ['games'] }, d => patchGameData(d, u.id, { play_order: u.play_order }))
    }),
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
  })
}

export function useAddToQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<number, string, EditCtx>({
    action: 'add_to_play_queue',
    successMessage: '🎮 Added to Play Queue ✓',
    mutationFn: addToQueue,
    onMutate: (id) => {
      const next = nextQueuePosition(qc.getQueriesData({ queryKey: ['games'] }).map(([, d]) => d))
      return patchGameCaches(qc, id, { play_order: next })
    },
    // The server's own position (it read the real maximum), over the guess.
    onSuccess: (order, id) => { qc.setQueriesData({ queryKey: ['games'] }, d => patchGameData(d, id, { play_order: order })) },
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
  })
}

export function useRemoveFromQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string, EditCtx>({
    action: 'remove_from_play_queue',
    successMessage: 'Removed from queue',
    mutationFn: removeFromQueue,
    onMutate: (id) => patchGameCaches(qc, id, { play_order: null }),
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
  })
}

/** "Remove N finished" — one write, one toast, every cached row patched at once. */
export function useRemoveManyFromQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, string[], EditCtx>({
    action: 'remove_finished_from_play_queue',
    successMessage: 'Finished games removed from the queue',
    mutationFn: removeManyFromQueue,
    onMutate: (ids) => beginEdit(qc, () => {
      for (const id of ids) qc.setQueriesData({ queryKey: ['games'] }, d => patchGameData(d, id, { play_order: null }))
    }),
    onError: (_e, _v, ctx) => restore(qc, ctx),
    onSettled: (_d, _e, _v, ctx) => settleRowEdit(qc, ctx),
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
    successMessage: 'Platform saved',
    mutationFn: ({ id, patch }) => updatePlatform(id, patch),
    onSuccess: () => invalidateAllGames(qc),
  })
}

/** Removes a platform from a game with Undo (the screen's own dialog asks first). */
export function useDeletePlatform() {
  return useRowsDelete({ table: 'game_platforms', action: 'delete_game_platform', invalidates: [['games']] })
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


/**
 * The library row behind a provider game, if it has been imported.
 *
 * Keyed on `external_ref` — the Steam appid or the PSN store SKU — which is
 * what `importProviderGames` writes. A game that has not been imported simply
 * has no row, and the modal says so rather than inventing one.
 */
/** Every imported row of one provider library, keyed by the provider's own id.
 *
 *  Shares ONE query key with `useLibraryEntry`, so a tab that needs the whole
 *  map and a modal that needs a single row cost one request between them. This
 *  is also what lets the grid render from OUR table while the provider's API
 *  is still being reached. */
export function useLibraryGames(library: GameLibrary) {
  const q = useQuery({
    queryKey: ['games', 'library', library],
    queryFn: () => fetchLibraryGames(library),
    staleTime: LIBRARY_STALE_MS,
  })
  const byRef = useMemo(() => {
    const m = new Map<string, Game>()
    for (const g of q.data ?? []) if (g.external_ref) m.set(g.external_ref, g)
    return m
  }, [q.data])
  return {
    // The SAME empty array on every render while there is no data: a fresh
    // `[]` each time broke every memo downstream for as long as the request
    // was pending or had failed.
    games: q.data ?? NO_GAMES,
    byRef,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  }
}

export function useLibraryEntry(library: GameLibrary, externalRef: string | null | undefined) {
  const q = useQuery({
    queryKey: ['games', 'library', library],
    queryFn: () => fetchLibraryGames(library),
    staleTime: LIBRARY_STALE_MS,
  })
  const entry = externalRef ? (q.data ?? []).find(g => g.external_ref === externalRef) ?? null : null
  return { entry, isLoading: q.isLoading }
}
