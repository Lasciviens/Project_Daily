import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAllGames, fetchLibraryGames } from '../../api/gamesApi'

// The game's place in the Play Queue ("#3"), counted the way the Queue view
// numbers its rows. `play_order` itself can have gaps (removing a game leaves
// one), so the raw value would disagree with the list.
//
// Reads the page's already-loaded libraries (the same keys and fetchers as
// useTestGameLibrary) through observers that never fetch (`enabled: false`):
// the ⋯ menu mounts with every phone sheet, and a normal observer would
// refetch all three libraries on each open once the data is a minute old.

export function useQueuePosition(id: string, playOrder: number | null): number | null {
  const retro = useQuery({ queryKey: ['games', 'all'], queryFn: fetchAllGames, enabled: false })
  const steam = useQuery({ queryKey: ['games', 'library', 'steam'], queryFn: () => fetchLibraryGames('steam'), enabled: false })
  const psn = useQuery({ queryKey: ['games', 'library', 'playstation'], queryFn: () => fetchLibraryGames('playstation'), enabled: false })

  return useMemo(() => {
    if (playOrder == null) return null
    const ahead = new Set<string>()
    for (const g of [...(retro.data ?? []), ...(steam.data ?? []), ...(psn.data ?? [])]) {
      if (g.id !== id && g.play_order != null && g.play_order < playOrder && g.play_status !== 'hidden') ahead.add(g.id)
    }
    return ahead.size + 1
  }, [id, playOrder, retro.data, steam.data, psn.data])
}
