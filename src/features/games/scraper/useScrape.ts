import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { SsPrefs } from './ssTypes'
import { defaultPrefs } from './ssPlan'
import {
  applyBatch, applyScrape, cleanupStorage, fetchGameScrapeData, fetchKnownNoMatches, fetchRecentRuns, fetchScrapePrefs,
  fetchScraperStatus, fetchSsSystems, fetchStorageUsage, findBatch, refreshSystems, saveScrapePrefs, undoScrape,
  type ApplyRequest, type BatchItem, type UndoResponse,
} from './ssApi'
import { toast } from '../../../app/store'

// Query keys live under ['screenscraper'] — deliberately OUTSIDE ['games'], so
// a status edit on the shelf never refetches the quota or the storage meter.
// A scrape that writes a game invalidates ['games'] itself.

export const SS_KEYS = {
  prefs: ['screenscraper', 'prefs'] as const,
  status: ['screenscraper', 'status'] as const,
  storage: ['screenscraper', 'storage'] as const,
  systems: ['screenscraper', 'systems'] as const,
  game: (id: string) => ['screenscraper', 'game', id] as const,
  runs: ['screenscraper', 'runs'] as const,
  noMatches: ['screenscraper', 'no-matches'] as const,
}

export function useScrapePrefs() {
  const qc = useQueryClient()
  // placeholderData, not initialData: the real fetch must still run on mount.
  const query = useQuery({ queryKey: SS_KEYS.prefs, queryFn: fetchScrapePrefs, placeholderData: defaultPrefs(), staleTime: 5 * 60_000 })
  const save = useMutationWithFeedback<SsPrefs, SsPrefs, { prev?: SsPrefs }>({
    action: 'save_screenscraper_prefs',
    successMessage: 'Scrape settings saved ✓',
    mutationFn: saveScrapePrefs,
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: SS_KEYS.prefs })
      const prev = qc.getQueryData<SsPrefs>(SS_KEYS.prefs)
      qc.setQueryData(SS_KEYS.prefs, next)
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(SS_KEYS.prefs, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: SS_KEYS.prefs }),
  })
  // `loaded` is false while the defaults are only a placeholder (or the read
  // failed): nothing may SAVE from that state, or it would overwrite the real
  // settings with built-in ones.
  const loaded = query.isSuccess && !query.isPlaceholderData
  return { prefs: query.data ?? defaultPrefs(), loaded, error: query.error, save }
}

/** Account, quota, library counts and storage — one ScreenScraper request. */
export function useScraperStatus(enabled = true) {
  return useQuery({ queryKey: SS_KEYS.status, queryFn: fetchScraperStatus, enabled, staleTime: 60_000, retry: false })
}

/** Storage only — no ScreenScraper request, so it can refresh after every save. */
export function useStorageUsage(enabled = true) {
  return useQuery({ queryKey: SS_KEYS.storage, queryFn: fetchStorageUsage, enabled, staleTime: 30_000, retry: false })
}

export function useSsSystems(enabled = true) {
  return useQuery({ queryKey: SS_KEYS.systems, queryFn: fetchSsSystems, enabled, staleTime: 24 * 60 * 60_000 })
}

/** Re-reads ScreenScraper's system list into the cache (their ids for ES-DE folders). */
export function useRefreshSystems() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'screenscraper_refresh_systems',
    successMessage: r => `System list refreshed · ${r.systems} systems`,
    mutationFn: () => refreshSystems(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SS_KEYS.systems }); qc.invalidateQueries({ queryKey: SS_KEYS.status }) },
  })
}

export function useGameScrapeData(gameId: string | null) {
  return useQuery({
    queryKey: SS_KEYS.game(gameId ?? ''),
    queryFn: () => fetchGameScrapeData(gameId!),
    enabled: !!gameId,
    staleTime: 60_000,
  })
}

function afterWrite(qc: ReturnType<typeof useQueryClient>, gameIds: string[]) {
  qc.invalidateQueries({ queryKey: ['games'] })
  qc.invalidateQueries({ queryKey: SS_KEYS.storage })
  qc.invalidateQueries({ queryKey: SS_KEYS.status })
  qc.invalidateQueries({ queryKey: SS_KEYS.runs })
  for (const id of gameIds) qc.invalidateQueries({ queryKey: SS_KEYS.game(id) })
}

/** The last saves, one entry per run, for "Recent saves" with Undo. */
export function useRecentRuns(enabled = true) {
  return useQuery({ queryKey: SS_KEYS.runs, queryFn: () => fetchRecentRuns(), enabled, staleTime: 30_000 })
}

export function useKnownNoMatches(enabled = true) {
  return useQuery({ queryKey: SS_KEYS.noMatches, queryFn: fetchKnownNoMatches, enabled, staleTime: 5 * 60_000 })
}

export function useCleanupStorage() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'screenscraper_cleanup',
    // A server-side refusal comes back as status 'error' (not a thrown
    // error): it is turned into one here, so it is toasted like any failure.
    mutationFn: async (dryRun: boolean) => {
      const r = await cleanupStorage(dryRun)
      if (r.status === 'error') throw new Error(r.error ?? 'Cleanup failed — nothing was deleted.')
      return r
    },
    onSuccess: (r, dryRun) => {
      if (dryRun) return
      qc.invalidateQueries({ queryKey: SS_KEYS.storage })
      qc.invalidateQueries({ queryKey: SS_KEYS.status })
      const mb = (r.bytes / 1048576).toFixed(1)
      if (r.error) toast.warning(`Deleted ${r.files} unused cop${r.files === 1 ? 'y' : 'ies'} (${mb} MB) — ${r.error}`)
      else toast.success(`Deleted ${r.files} unused cop${r.files === 1 ? 'y' : 'ies'} · ${mb} MB freed`)
    },
  })
}

/** Toasts what an undo really did: nothing reverted is a warning, not a success. */
function undoFeedback(r: UndoResponse) {
  if (r.status === 'no_journal') { toast.warning(r.message ?? 'There is no record of what to undo.'); return }
  const reasons = [...new Set((r.skipped ?? []).map(s => s.reason))]
  if (!r.reverted) { toast.warning(`Nothing was undone${reasons.length ? ` — ${reasons.join('; ')}` : ''}`); return }
  toast.success(`Undone ✓ (${r.reverted} game${r.reverted === 1 ? '' : 's'})${reasons.length ? ` — ${reasons.join('; ')}` : ''}`)
}

/** Applies one chosen entry. The caller shows the outcome; failures toast here. */
export function useApplyScrape() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'screenscraper_apply',
    mutationFn: (req: ApplyRequest) => applyScrape(req),
    onSuccess: (_d, req) => afterWrite(qc, [req.game_id]),
  })
}

/** A chunk of a batch save. The library itself is refreshed once, by the
 *  caller, after the last chunk (`useAfterScrapeWrite`) — not per chunk. */
export function useApplyBatch() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'screenscraper_apply_batch',
    mutationFn: ({ items, runId }: { items: BatchItem[]; runId?: string }) => applyBatch(items, runId),
    onSuccess: (_d, v) => { for (const i of v.items) qc.invalidateQueries({ queryKey: SS_KEYS.game(i.game_id) }) },
  })
}

/** The refresh every scrape write needs (library, storage, runs, the games' records). */
export function useAfterScrapeWrite() {
  const qc = useQueryClient()
  return (gameIds: string[]) => afterWrite(qc, gameIds)
}

export function useFindBatch() {
  return useMutationWithFeedback({ action: 'screenscraper_find_batch', mutationFn: (ids: string[]) => findBatch(ids) })
}

/**
 * `scope: 'game'` undoes only `gameIds` in the run (the detail, the Saved
 * screen); `'run'` undoes the whole run (Recent saves, the batch). Every game
 * the server actually reverted is refreshed.
 */
export function useUndoScrape() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'screenscraper_undo',
    mutationFn: ({ runId, gameIds, scope }: { runId: string; gameIds: string[]; scope: 'game' | 'run' }) =>
      undoScrape(runId, scope === 'game' ? gameIds : undefined),
    onSuccess: (r, v) => { undoFeedback(r); afterWrite(qc, [...new Set([...v.gameIds, ...(r.reverted_ids ?? [])])]) },
  })
}
