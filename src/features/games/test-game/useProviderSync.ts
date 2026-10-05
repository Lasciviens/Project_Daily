import { useEffect } from 'react'
import { useIsMutating, useQueryClient, type Mutation, type QueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchSteamOwnedGames } from '../api/steamApi'
import { fetchPsnPlayedGames } from '../api/psnApi'
import { importProviderGames } from '../api/gamesApi'
import { psnImportRows, steamImportRows } from '../api/providerImportRows'
import { autoSyncDue, lastSynced } from './components/tgProviderSync'
import type { TgGame } from './testGameModel'

export type SyncProvider = 'steam' | 'playstation'
export const PROVIDER_NAME: Record<SyncProvider, string> = { steam: 'Steam', playstation: 'PlayStation' }

interface SyncVars { library: SyncProvider; auto: boolean }
type SyncResult = Awaited<ReturnType<typeof importProviderGames>>

const SYNC_KEY = ['games', 'provider-sync'] as const
const isSyncOf = (library: SyncProvider) => (m: Mutation<unknown, Error, unknown, unknown>) =>
  (m.state.variables as SyncVars | undefined)?.library === library

/** Reads the provider's list and imports it: new games added, playtime refreshed, only empty metadata filled. */
async function syncProvider(qc: QueryClient, library: SyncProvider): Promise<SyncResult> {
  const rows = library === 'steam'
    ? steamImportRows((await qc.fetchQuery({ queryKey: ['steam', 'owned-games'], queryFn: fetchSteamOwnedGames, staleTime: 0 })).games)
    : psnImportRows(await qc.fetchQuery({ queryKey: ['psn', 'played-games'], queryFn: fetchPsnPlayedGames, staleTime: 0 }))
  if (!rows.length) throw new Error(`${PROVIDER_NAME[library]} returned no games — check Settings → Subscriptions.`)
  return importProviderGames(library, library === 'steam' ? 'steam' : 'psn', rows)
}

function summary(library: SyncProvider, r: SyncResult, auto: boolean): string | undefined {
  // `updated` counts every row already in the library, so the daily run speaks
  // only when games were added or moved to Playing.
  const bits = [r.imported ? `${r.imported} added` : null, !auto && r.updated ? `${r.updated} refreshed` : null, r.promoted ? `${r.promoted} now playing` : null].filter(Boolean)
  if (auto) return bits.length ? `${PROVIDER_NAME[library]} daily sync: ${bits.join(' · ')} ✓` : undefined
  return bits.length ? `${PROVIDER_NAME[library]}: ${bits.join(' · ')} ✓` : `${PROVIDER_NAME[library]} is up to date ✓`
}

/** One write path for both the Sync button and the daily auto-sync. */
function useProviderSyncMutation() {
  const qc = useQueryClient()
  return useMutationWithFeedback<SyncResult, SyncVars>({
    action: 'games_provider_sync',
    mutationKey: SYNC_KEY,
    mutationFn: async ({ library, auto }) => {
      try {
        return await syncProvider(qc, library)
      } catch (e) {
        // A daily run that fails says so once (the attempt key stops repeats) and names the fix.
        throw auto ? new Error(`${PROVIDER_NAME[library]} daily sync failed — ${(e as Error).message} (Settings → Subscriptions).`) : e
      }
    },
    loadingMessage: ({ library, auto }) => (auto ? undefined : `Reading your ${PROVIDER_NAME[library]} library…`),
    successMessage: (r, { library, auto }) => summary(library, r, auto),
    invalidates: [['games']],
  })
}

/** The Sync button: runs now, unless this provider is already syncing. */
export function useProviderSync(library: SyncProvider) {
  const qc = useQueryClient()
  const sync = useProviderSyncMutation()
  const busy = useIsMutating({ mutationKey: SYNC_KEY, predicate: isSyncOf(library) }) > 0
  const run = () => {
    if (qc.isMutating({ mutationKey: SYNC_KEY, predicate: isSyncOf(library) }) > 0) return
    sync.mutate({ library, auto: false })
  }
  return { run, busy }
}

const ATTEMPT_KEY = (l: SyncProvider) => `lasci.games.autoSync.${l}`
function readAttempt(l: SyncProvider): number | null {
  try { const v = Number(localStorage.getItem(ATTEMPT_KEY(l))); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
}
function writeAttempt(l: SyncProvider, at: number) {
  try { localStorage.setItem(ATTEMPT_KEY(l), String(at)) } catch { /* private mode: retried next visit */ }
}

/**
 * Opening Games syncs Steam and PlayStation by themselves once a day
 * (autoSyncDue — the owner's exception to "no eager provider calls on mount").
 * Quiet: a toast only when games were added or moved to Playing, or when the
 * run failed (once a day at most).
 */
export function useProviderAutoSync(games: readonly TgGame[], ready: boolean) {
  const qc = useQueryClient()
  const { mutate } = useProviderSyncMutation()
  useEffect(() => {
    if (!ready) return
    const now = Date.now()
    for (const library of ['steam', 'playstation'] as const) {
      if (qc.isMutating({ mutationKey: SYNC_KEY, predicate: isSyncOf(library) }) > 0) continue
      if (!autoSyncDue(lastSynced(games, library), readAttempt(library), now)) continue
      writeAttempt(library, now)
      mutate({ library, auto: true })
    }
  }, [games, ready, qc, mutate])
}
