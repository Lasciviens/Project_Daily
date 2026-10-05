import { useCallback, useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { fetchSteamOwnedGames } from '../api/steamApi'
import { fetchPsnPlayedGames } from '../api/psnApi'
import { importProviderGames } from '../api/gamesApi'
import { psnImportRows, steamImportRows } from '../api/providerImportRows'
import { autoSyncDue, lastSynced } from './components/tgProviderSync'
import type { TgGame } from './testGameModel'

export type SyncProvider = 'steam' | 'playstation'
export const PROVIDER_NAME: Record<SyncProvider, string> = { steam: 'Steam', playstation: 'PlayStation' }

// One sync per provider at a time, whoever started it (the button or the daily auto-sync).
const inFlight = new Set<SyncProvider>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

/** Reads the provider's list and imports it: new games added, playtime refreshed, only empty metadata filled. */
async function syncProvider(qc: QueryClient, library: SyncProvider) {
  const rows = library === 'steam'
    ? steamImportRows((await qc.fetchQuery({ queryKey: ['steam', 'owned-games'], queryFn: fetchSteamOwnedGames, staleTime: 0 })).games)
    : psnImportRows(await qc.fetchQuery({ queryKey: ['psn', 'played-games'], queryFn: fetchPsnPlayedGames, staleTime: 0 }))
  if (!rows.length) throw new Error(`${PROVIDER_NAME[library]} returned no games — check Settings → Subscriptions.`)
  const result = await importProviderGames(library, library === 'steam' ? 'steam' : 'psn', rows)
  qc.invalidateQueries({ queryKey: ['games'] })
  return result
}

const summary = (library: SyncProvider, r: Awaited<ReturnType<typeof syncProvider>>) => {
  const bits = [r.imported ? `${r.imported} added` : null, r.updated ? `${r.updated} refreshed` : null, r.promoted ? `${r.promoted} now playing` : null].filter(Boolean)
  return bits.length ? `${PROVIDER_NAME[library]}: ${bits.join(' · ')} ✓` : `${PROVIDER_NAME[library]} is up to date ✓`
}

/** The Sync button: a loading toast, the result, errors toasted and logged. */
export function useProviderSync(library: SyncProvider) {
  const qc = useQueryClient()
  const [, rerender] = useState(0)
  useEffect(() => {
    const l = () => rerender(n => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  const run = useCallback(async () => {
    if (inFlight.has(library)) return
    inFlight.add(library); notify()
    const tid = toast.loading(`Reading your ${PROVIDER_NAME[library]} library…`)
    try {
      const r = await syncProvider(qc, library)
      toast.dismiss(tid)
      toast.success(summary(library, r))
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`games_provider_sync_${library}: ${msg}`)
      toast.error(msg)
    } finally {
      inFlight.delete(library); notify()
    }
  }, [qc, library])
  return { run, busy: inFlight.has(library) }
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
 * (autoSyncDue). Quiet: a toast only when something changed; a failure (an
 * expired PSN token, say) is only logged — the Sync button still reports it.
 */
export function useProviderAutoSync(games: readonly TgGame[], ready: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!ready) return
    const now = Date.now()
    for (const library of ['steam', 'playstation'] as const) {
      if (inFlight.has(library) || !autoSyncDue(lastSynced(games, library), readAttempt(library), now)) continue
      writeAttempt(library, now)
      inFlight.add(library); notify()
      syncProvider(qc, library)
        .then(r => { if (r.imported || r.updated || r.promoted) toast.success(summary(library, r)) })
        .catch(e => logError(`games_provider_autosync_${library}: ${(e as Error).message}`))
        .finally(() => { inFlight.delete(library); notify() })
    }
  }, [games, ready, qc])
}
