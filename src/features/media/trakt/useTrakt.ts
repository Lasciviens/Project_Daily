import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import {
  connectTrakt, disconnectTrakt, fetchLocalLibraryForTrakt, fetchTraktSnapshot, fetchTraktStatus, traktAuthorizeUrl,
} from './traktApi'
import { newTraktState } from './traktCallback'
import { buildTraktPreview } from './traktPreview'
import { runTraktImport } from './traktImport'

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

/** The first real import: library first, then the app-only facts to Trakt. */
export function useRunTraktImport(onProgress: (step: string) => void) {
  return useMutationWithFeedback({
    action: 'trakt_import',
    successMessage: r => `Imported: ${r.movies} movies, ${r.shows} shows, ${r.episodes} episodes · ${r.sent} changes sent to Trakt`,
    mutationFn: () => runTraktImport(onProgress),
    invalidates: ['media', qk.trakt.all],
  })
}
