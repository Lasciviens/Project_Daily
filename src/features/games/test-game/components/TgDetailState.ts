import { useCallback } from 'react'
import { create } from 'zustand'
import { useSetPlayStatus, useUpdateGame } from '../../hooks/useGames'
import { isUndecidedStatus, starsFromRating, ratingFromStars, type TgGame } from '../testGameModel'
import type { PlayStatus } from '../../types'

// Instant feedback for the detail panel's status and rating controls.
//
// `useSetPlayStatus` has no optimistic update, and `useUpdateGame`'s only
// patches the retro query — so without this a click shows the OLD value until
// the refetch lands, and the Play button stays clickable long enough to be
// pressed twice. Several components show the same status (the pill, the Play
// button, the ⋯ menu's Hide), so the pending value lives in one small store.
//
// An override is stamped with the row's `updated_at` at click time and holds
// only while the row still carries that stamp. The write bumps `updated_at`
// (trg_games_updated_at), so the refetch that brings the new value also ends
// the override — and a later change made anywhere else can never be masked by
// a stale one, because `updated_at` only moves forward. No cleanup needed.

interface Override<T> { value: T; stamp: string }
interface Pending { status?: Override<PlayStatus>; rating?: Override<number | null> }

interface PendingStore {
  byId: Record<string, Pending>
  patch: (id: string, p: Pending) => void
  drop: (id: string, key: keyof Pending, stamp: string) => void
}

const usePending = create<PendingStore>()((set) => ({
  byId: {},
  patch: (id, p) => set(s => ({ byId: { ...s.byId, [id]: { ...s.byId[id], ...p } } })),
  // Only drops the override it was asked about — a newer click may have replaced it.
  drop: (id, key, stamp) => set(s => {
    const cur = s.byId[id]
    if (!cur || cur[key]?.stamp !== stamp) return s
    return { byId: { ...s.byId, [id]: { ...cur, [key]: undefined } } }
  }),
}))

function live<T>(o: Override<T> | undefined, stamp: string): Override<T> | undefined {
  // No stamp → nothing could ever end the override, so none is applied.
  return stamp !== '' && o?.stamp === stamp ? o : undefined
}

export interface DetailState {
  status: PlayStatus
  /** Hidden by its status (not by the Steam "not a game" rule). */
  hiddenByStatus: boolean
  /** Hidden automatically: a Steam app whose store type is not a game, with
   *  no deliberate status yet (see `isHiddenRow`). */
  autoHidden: boolean
  stars: number | null
  setStatus: (next: PlayStatus) => void
  setStars: (stars: number | null) => void
}

export function useDetailState(game: TgGame): DetailState {
  const pending = usePending(s => s.byId[game.id])
  const patch = usePending(s => s.patch)
  const drop = usePending(s => s.drop)
  // One queue of writes per game: rapid taps land in the order they were made.
  const setPlayStatus = useSetPlayStatus(`game-${game.id}`)
  const updateGame = useUpdateGame(`game-${game.id}`)

  const stamp = game.updated_at ?? ''
  const statusOverride = live(pending?.status, stamp)
  const ratingOverride = live(pending?.rating, stamp)
  const status = statusOverride ? statusOverride.value : game.play_status
  const rating = ratingOverride ? ratingOverride.value : game.rating

  const { id } = game
  const statusMutate = setPlayStatus.mutateAsync
  const updateMutate = updateGame.mutateAsync
  const autoHidden = game.hidden && game.play_status !== 'hidden' && !statusOverride

  // The promise form, not `mutate(v, { onError })`: per-call callbacks are
  // skipped once the component unmounts (a sheet closed mid-request), which
  // would leave a failed value painted over the real one. The hooks already
  // toast the error — the catch only withdraws the override.
  const setStatus = useCallback((next: PlayStatus) => {
    // Re-picking Playing on an undecided row is a real write: an importer-
    // promoted "playing" (hidden or not) has no start date, and the write
    // stamps one — confirming it, and taking it out of the "undecided" group.
    const confirmsPlaying = next === 'playing' && !statusOverride && isUndecidedStatus(game)
    if (next === status && !confirmsPlaying) return
    patch(id, { status: { value: next, stamp } })
    statusMutate({ id, status: next }).catch(() => drop(id, 'status', stamp))
  }, [id, stamp, status, statusOverride, game, patch, drop, statusMutate])

  const setStars = useCallback((stars: number | null) => {
    const next = stars == null ? null : ratingFromStars(stars)
    if (next === rating) return
    patch(id, { rating: { value: next, stamp } })
    updateMutate({ id, patch: { rating: next } }).catch(() => drop(id, 'rating', stamp))
  }, [id, stamp, rating, patch, drop, updateMutate])

  return {
    status,
    hiddenByStatus: status === 'hidden',
    autoHidden,
    stars: starsFromRating(rating),
    setStatus,
    setStars,
  }
}
