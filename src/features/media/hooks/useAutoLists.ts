import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { addFollow, checkFollowsNow, fetchFollows, removeFollow, updateFollow, type FollowKind, type MediaFollow } from '../api/followsApi'
import { addToTraktList, createTraktList, deleteTraktList, fetchTraktLists } from '../trakt/traktApi'
import { useTraktStatus } from '../trakt/useTrakt'
import { fetchSmart } from './useSmartLists'

// Every list lives on Trakt. A list that fills itself is a normal Trakt list
// plus one rule in media_follows (its source and trakt_list_id): it is filled
// once here, and the daily follow check adds new films to the same list.
// Owner's rule (01.10.2026): "Trakt should see what I see."

const KIND_LABEL: Record<FollowKind, string> = { collection: 'franchise', company: 'studio', keyword: 'keyword', director: 'director', actor: 'actor' }
const CHUNK = 100
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Studio, keyword and person lists drop documentaries and TV movies, as the preview did. */
const hideExtrasFor = (kind: FollowKind) => kind !== 'collection'

async function fillList(qc: QueryClient, kind: FollowKind, tmdbId: number, listId: number) {
  const hide = hideExtrasFor(kind)
  const r = await qc.fetchQuery({
    queryKey: [...qk.media.smartList(kind, tmdbId), hide],
    queryFn: () => fetchSmart(kind, tmdbId, hide),
    staleTime: STALE.day,
  })
  const ids = r.titles.map(t => t.tmdbId)
  // Trakt takes one write per second; one request carries up to CHUNK films.
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (i) await wait(1100)
    await addToTraktList(listId, ids.slice(i, i + CHUNK).map(tmdb => ({ type: 'movie' as const, tmdb })))
  }
  return { added: ids.length, capped: r.capped, total: r.total }
}

export interface AutoListInput { kind: FollowKind; tmdbId: number; name: string; follow?: MediaFollow | null }

/**
 * Creates (or, for an existing rule without a list, puts on Trakt) a list that
 * fills itself. Without Trakt only the rule is saved; it goes onto Trakt from
 * the Lists page once Trakt is connected.
 */
export function useCreateAutoList() {
  const qc = useQueryClient()
  const { data: trakt } = useTraktStatus()
  const connected = !!trakt?.connected
  return useMutationWithFeedback({
    action: 'media_auto_list_create',
    loadingMessage: v => (connected ? `Putting “${v.name}” on Trakt…` : undefined),
    mutationFn: async (v: AutoListInput) => {
      if (!connected) {
        if (!v.follow) { await addFollow({ kind: v.kind, tmdb_id: v.tmdbId, name: v.name }); await checkFollowsNow().catch(() => null) }
        return { pending: true as const }
      }
      // Reuse a Trakt list of the same name that no rule fills yet (e.g. a
      // franchise saved by hand earlier) instead of making a twin of it.
      const [lists, follows] = await Promise.all([fetchTraktLists(), fetchFollows()])
      const linked = new Set(follows.map(f => f.trakt_list_id).filter(Boolean))
      const same = lists.find(l => !linked.has(l.id) && l.name.trim().toLowerCase() === v.name.trim().toLowerCase())
      const list = same ?? await createTraktList(v.name, `Fills itself from the ${KIND_LABEL[v.kind]} “${v.name}” on TMDB.`)
      // Link first: if filling fails half-way, the list and its rule still belong together.
      if (v.follow) await updateFollow(v.follow.id, { trakt_list_id: list.id })
      else await addFollow({ kind: v.kind, tmdb_id: v.tmdbId, name: v.name, trakt_list_id: list.id })
      const filled = await fillList(qc, v.kind, v.tmdbId, list.id)
      // The first check records what exists now, so only later films are "new".
      if (!v.follow) await checkFollowsNow().catch(() => null)
      return { pending: false as const, listId: list.id, ...filled }
    },
    successMessage: (r, v) => (r.pending
      ? `Saved “${v.name}” — it goes onto Trakt once Trakt is connected`
      : `“${v.name}” is on Trakt · ${r.added} films${r.capped ? ` (newest of ${r.total})` : ''}`),
    invalidates: [qk.trakt.lists(), qk.mediaFollows.all],
  })
}

/** Deletes a list that fills itself: the Trakt list and its rule. */
export function useDeleteAutoList() {
  return useMutationWithFeedback({
    action: 'media_auto_list_delete',
    loadingMessage: 'Deleting list…',
    mutationFn: async (v: { follow: MediaFollow; listId: number | null }) => {
      if (v.listId) await deleteTraktList(v.listId)
      await removeFollow(v.follow.id)
    },
    successMessage: 'List deleted',
    invalidates: [qk.trakt.lists(), qk.mediaFollows.all],
  })
}

/** Stops a list filling itself; the Trakt list stays as a normal list. */
export function useStopAutoFill() {
  return useMutationWithFeedback({
    action: 'media_auto_list_stop',
    mutationFn: (follow: MediaFollow) => removeFollow(follow.id),
    successMessage: (_r, f) => `“${f.name}” stays on Trakt but stops filling itself`,
    invalidates: [qk.mediaFollows.all],
  })
}
