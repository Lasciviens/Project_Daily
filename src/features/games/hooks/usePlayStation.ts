import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  fetchPsnStatus, connectPsn, disconnectPsn, fetchPsnProfile, fetchPsnTitles,
  fetchPsnPlayedGames, fetchPsnPurchasedGames, fetchPsnTitleMap,
  fetchPsnTitleTrophies, fetchPsnTrophyGroups,
} from '../api/psnApi'

// LOADING PRIORITY — the same tiering the Steam tab uses (CLAUDE.md's Games
// Feature Detail): first paint costs the profile plus the playtime library,
// and nothing else. Purchase provenance (PS Plus badges) is queued behind
// the library; the trophy-set list only loads when its view is opened; the
// store-SKU→trophy-set bridge and the trophy list itself are keyed to a game
// the user actually opened, the trophy list lazily on scroll.

const STATUS_QK = ['psn', 'status']
const STALE = 5 * 60_000
const STALE_LONG = 60 * 60_000

export function usePsnStatus() {
  return useQuery({ queryKey: STATUS_QK, queryFn: fetchPsnStatus, staleTime: 60_000 })
}

export function usePsnProfile(enabled: boolean) {
  return useQuery({
    queryKey: ['psn', 'profile'], queryFn: fetchPsnProfile,
    enabled, staleTime: STALE, retry: false,
  })
}

/** The playtime library — primary content, loads with the profile. */
export function usePsnPlayedGames(enabled: boolean) {
  return useQuery({
    queryKey: ['psn', 'played-games'], queryFn: fetchPsnPlayedGames,
    enabled, staleTime: STALE, retry: false,
  })
}

/** PS Plus provenance — enrichment, queued behind the library. */
export function usePsnPurchasedGames(enabled: boolean) {
  return useQuery({
    queryKey: ['psn', 'purchased-games'], queryFn: fetchPsnPurchasedGames,
    enabled, staleTime: STALE_LONG, retry: false,
  })
}

/** Trophy-set list — only when the trophy view is actually shown. */
export function usePsnTitles(enabled: boolean) {
  return useQuery({
    queryKey: ['psn', 'titles'], queryFn: fetchPsnTitles,
    enabled, staleTime: STALE, retry: false,
  })
}

/**
 * Bridges ONE store SKU to its trophy set. Sony caps this at 5 ids per
 * request, so it is deliberately called per opened game, never per library.
 */
export function usePsnTitleMap(titleId: string | null) {
  return useQuery({
    queryKey: ['psn', 'title-map', titleId],
    queryFn: async () => {
      const r = await fetchPsnTitleMap([titleId!])
      return r.titles[0]?.trophyTitles?.[0] ?? null
    },
    enabled: !!titleId, staleTime: Infinity, retry: false,
  })
}

export function usePsnTitleTrophies(npCommunicationId: string | null, npServiceName?: string) {
  return useQuery({
    queryKey: ['psn', 'title-trophies', npCommunicationId],
    queryFn: () => fetchPsnTitleTrophies(npCommunicationId!, npServiceName),
    enabled: !!npCommunicationId, staleTime: STALE, retry: false,
  })
}

export function usePsnTrophyGroups(npCommunicationId: string | null, npServiceName?: string, enabled = true) {
  return useQuery({
    queryKey: ['psn', 'trophy-groups', npCommunicationId],
    queryFn: () => fetchPsnTrophyGroups(npCommunicationId!, npServiceName),
    enabled: enabled && !!npCommunicationId, staleTime: STALE, retry: false,
  })
}

export function useConnectPsn() {
  const qc = useQueryClient()
  return useMutationWithFeedback<{ connected: true; expiresAt: string }, string>({
    action: 'connect_psn',
    successMessage: 'PlayStation bağlandı ✓',
    mutationFn: connectPsn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['psn'] }),
  })
}

export function useDisconnectPsn() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, void>({
    action: 'disconnect_psn',
    successMessage: 'PlayStation bağlantısı kesildi',
    mutationFn: disconnectPsn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['psn'] }),
  })
}
