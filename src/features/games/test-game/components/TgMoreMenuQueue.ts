import { useCallback, useContext, useState } from 'react'
import { useAddToQueue, useRemoveFromQueue } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'
import { TgRanksContext } from './tgRanks'

// The game's place in the Play Queue ("#3") — the SAME number the Queue view
// and the queue badge show, because all read the page's one `queueRanks`
// (TgRanksContext): hidden games are left out and `play_order` gaps closed.
export function useQueuePosition(id: string): number | null {
  return useContext(TgRanksContext)?.get(id) ?? null
}

/**
 * The detail footer's queue toggle: in the queue (and where), and one call that
 * adds to the end or removes. The button flips at once: the tapped state is
 * held until the refetch brings a new play_order (or the write fails), so it
 * never reads "Add to queue" again for the round trip after a successful add.
 */
export function useQueueToggle(game: TgGame) {
  const position = useQueuePosition(game.id)
  const add = useAddToQueue()
  const remove = useRemoveFromQueue()
  const [pending, setPending] = useState<{ id: string; basis: number | null; queued: boolean } | null>(null)
  const stored = game.play_order != null
  const held = pending && pending.id === game.id && pending.basis === game.play_order ? pending : null
  const queued = held ? held.queued : stored

  const inFlight = add.isPending || remove.isPending
  const toggle = useCallback(() => {
    // Ignored (not greyed out — the write takes a moment) while one is running.
    if (inFlight) return
    const next = !queued
    setPending({ id: game.id, basis: game.play_order, queued: next })
    const onError = () => setPending(null) // the hook toasts and logs the failure
    if (next) add.mutate(game.id, { onError })
    else remove.mutate(game.id, { onError })
  }, [inFlight, queued, game.id, game.play_order, add, remove])

  // Busy while either write is in flight: a second tap would race the first.
  return { queued, position: queued && stored ? position : null, toggle, busy: held != null || inFlight }
}
