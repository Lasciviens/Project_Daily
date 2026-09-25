import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import { fetchAllGames, fetchLibraryGames } from '../../api/gamesApi'
import { deriveGames, queueRanks } from '../testGameModel'

// The game's place in the Play Queue ("#3") — the SAME number the Queue view
// and the queue badge show, because all three read `queueRanks`: hidden games
// (status-hidden or a Steam non-game) are left out, and `play_order` gaps
// (removing a game leaves one) are closed.
//
// Reads the page's already-loaded libraries (the same keys and fetchers as
// useTestGameLibrary) through observers that never fetch (`enabled: false`):
// the ⋯ menu mounts with every phone sheet, and a normal observer would
// refetch all three libraries on each open once the data is a minute old.

type SteamTypes = Map<number, string | null>

// useTestGameLibrary's store-type query, by key prefix: its last segment
// hashes the appid list, which this hook does not rebuild.
const STEAM_TYPES_PREFIX = ['steam', 'app-types', 'library']

/** The newest cached classification. Returns the cached Map itself, so the
 *  snapshot stays referentially stable until the cache actually changes. */
function latestSteamTypes(queries: Query[]): SteamTypes | undefined {
  let best: Query | undefined
  for (const q of queries) {
    if (!(q.state.data instanceof Map)) continue
    if (!best || q.state.dataUpdatedAt > best.state.dataUpdatedAt) best = q
  }
  return best?.state.data as SteamTypes | undefined
}

export function useQueuePosition(id: string): number | null {
  const cache = useQueryClient().getQueryCache()
  const retro = useQuery({ queryKey: ['games', 'all'], queryFn: fetchAllGames, enabled: false })
  const steam = useQuery({ queryKey: ['games', 'library', 'steam'], queryFn: () => fetchLibraryGames('steam'), enabled: false })
  const psn = useQuery({ queryKey: ['games', 'library', 'playstation'], queryFn: () => fetchLibraryGames('playstation'), enabled: false })

  // Data changes only ('added' fires while another component renders, and
  // a new query holds no data yet anyway).
  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(e => { if (e.type === 'updated' || e.type === 'removed') onChange() }),
    [cache],
  )
  const steamTypes = useSyncExternalStore(subscribe, () => latestSteamTypes(cache.findAll({ queryKey: STEAM_TYPES_PREFIX })))

  const ranks = useMemo(
    () => queueRanks(deriveGames([...(retro.data ?? []), ...(steam.data ?? []), ...(psn.data ?? [])], steamTypes)),
    [retro.data, steam.data, psn.data, steamTypes],
  )
  return ranks.get(id) ?? null
}
