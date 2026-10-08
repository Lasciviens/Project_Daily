import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import {
  connectTrakt, disconnectTrakt, fetchLocalLibraryForTrakt, fetchTraktSnapshot, fetchTraktStatus, importTrakt, syncTrakt,
  traktAuthorizeUrl, type TraktRunResult,
} from './traktApi'
import { newTraktState } from './traktCallback'
import { buildTraktPreview } from './traktPreview'

export function useTraktStatus() {
  return useQuery({ queryKey: qk.trakt.status(), queryFn: fetchTraktStatus, staleTime: STALE.short, retry: false })
}

/** Leaves the app for Trakt's consent page; the answer comes back through traktCallback. */
export function useStartTraktConnect() {
  return useMutationWithFeedback({
    action: 'trakt_authorize_url',
    loadingMessage: 'Opening Trakt…',
    mutationFn: async () => {
      const { url } = await traktAuthorizeUrl(newTraktState())
      window.location.assign(url)
    },
  })
}

export function useFinishTraktConnect() {
  return useMutationWithFeedback({
    action: 'trakt_connect',
    loadingMessage: 'Connecting Trakt…',
    successMessage: r => (r.username ? `Trakt connected as ${r.username}` : 'Trakt connected'),
    mutationFn: (code: string) => connectTrakt(code),
    invalidates: [qk.trakt.all],
  })
}

export function useDisconnectTrakt() {
  return useMutationWithFeedback({
    action: 'trakt_disconnect',
    successMessage: 'Trakt disconnected',
    mutationFn: () => disconnectTrakt(),
    invalidates: [qk.trakt.all],
  })
}

/** The first-import dry run: reads Trakt and your library, writes nothing. */
export function useTraktPreview(enabled: boolean) {
  return useQuery({
    queryKey: qk.trakt.preview(),
    queryFn: async () => {
      const [snapshot, local] = await Promise.all([fetchTraktSnapshot(), fetchLocalLibraryForTrakt()])
      return { snapshot, preview: buildTraktPreview(snapshot, local) }
    },
    enabled,
    staleTime: STALE.long,
    retry: false,
  })
}

/** The first real import (server side): library first, then the app-only facts to Trakt. */
export function useRunTraktImport() {
  return useMutationWithFeedback({
    action: 'trakt_import',
    loadingMessage: 'Importing from Trakt… this can take a minute',
    successMessage: r => r.busy ? 'A sync is already running — try again in a minute'
      : `Imported: ${r.applied?.movies ?? 0} movies, ${r.applied?.shows ?? 0} shows, ${r.applied?.episodes ?? 0} episodes · ${r.sent ?? 0} changes sent to Trakt`,
    mutationFn: () => importTrakt(),
    invalidates: ['media', qk.trakt.all],
  })
}

function syncSummary(r: TraktRunResult): string {
  if (r.busy) return 'A sync is already running'
  const parts: string[] = []
  const sent = (r.drained?.sent ?? 0) + (r.notes?.sent ?? 0)
  if (sent) parts.push(`${sent} sent to Trakt`)
  const a = r.applied
  if (a && (a.movies || a.shows || a.episodes)) parts.push(`${a.movies + a.shows + a.episodes} updated from Trakt`)
  if (a?.removed) parts.push(`${a.removed} removed`)
  if (r.heldBack) parts.push(`${r.heldBack} removals waiting for you`)
  if (r.notes?.fromTrakt) parts.push(`${r.notes.fromTrakt} note${r.notes.fromTrakt === 1 ? '' : 's'} from Trakt`)
  if (r.notes?.refused) parts.push(`${r.notes.refused} note${r.notes.refused === 1 ? '' : 's'} not taken by Trakt`)
  return parts.length ? `Synced · ${parts.join(' · ')}` : 'Synced · already the same'
}

/** Sync now (Settings card). `force` applies removals a sync held back. */
export function useSyncTrakt() {
  return useMutationWithFeedback({
    action: 'trakt_sync',
    loadingMessage: 'Syncing with Trakt…',
    successMessage: syncSummary,
    mutationFn: (opts: { full?: boolean; force?: boolean } = {}) => syncTrakt(opts),
    invalidates: ['media', qk.trakt.all],
  })
}
