import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Game } from '../../types'

// The game's place in the Play Queue ("#3"), counted the way the Queue view
// numbers its rows. `play_order` itself can have gaps (removing a game leaves
// one), so the raw value would disagree with the list.
//
// Reads the page's already-loaded libraries WITHOUT subscribing a fetching
// observer (`enabled: false`): the ⋯ menu mounts with every phone sheet, and a
// normal observer would refetch all three libraries each time once stale.

const cacheOnly = (queryKey: readonly unknown[]) => ({ queryKey, enabled: false })

export function useQueuePosition(id: string, playOrder: number | null): number | null {
  const retro = useQuery<Game[]>(cacheOnly(['games', 'all']))
  const steam = useQuery<Game[]>(cacheOnly(['games', 'library', 'steam']))
  const psn = useQuery<Game[]>(cacheOnly(['games', 'library', 'playstation']))

  return useMemo(() => {
    if (playOrder == null) return null
    const ahead = new Set<string>()
    for (const g of [...(retro.data ?? []), ...(steam.data ?? []), ...(psn.data ?? [])]) {
      if (g.id !== id && g.play_order != null && g.play_order < playOrder && g.play_status !== 'hidden') ahead.add(g.id)
    }
    return ahead.size + 1
  }, [id, playOrder, retro.data, steam.data, psn.data])
}
