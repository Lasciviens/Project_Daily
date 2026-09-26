import { useCallback, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAllGames, useLibraryGames } from '../hooks/useGames'
import { fetchSteamAppTypes } from '../api/steamApi'
import { deriveGames, type TgGame } from './testGameModel'

// Every game this user owns, from all three libraries, in ONE list.
//
// Built from the SAME queries the Games page uses (`['games','all']` for the
// retro library, `['games','library',…]` for Steam and PlayStation), so every
// existing mutation's `invalidateQueries(['games'])` refreshes this page too
// and nothing is fetched twice when both pages have been visited.
//
// Steam store types come from the shared `steam_apps` cache (migration 092),
// read directly — no Steam call — and only decide whether a non-game app is
// auto-hidden. A missing table just means nothing is classified.

export interface TestGameLibrary {
  games: TgGame[]
  /** The retro library has not arrived yet (every view needs it). */
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  /** Steam or PlayStation rows (or the Steam store types that decide which
   *  apps hide) have not arrived yet — a saved provider platform should wait
   *  on its loading shelf instead of falling back to All Games. */
  providersLoading: boolean
  /** A provider library failed and has no rows to show; null otherwise. */
  providerError: unknown | null
  /** Refetch both provider libraries. */
  retryProviders: () => void
}

/** FNV-1a over the sorted id list: a key that changes when ANY id changes,
 *  not only the count or the two ends. */
function idsKey(ids: number[]): string {
  let h = 0x811c9dc5
  const s = ids.join(',')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${ids.length}-${(h >>> 0).toString(36)}`
}

export function useTestGameLibrary(): TestGameLibrary {
  const retro = useAllGames()
  const steam = useLibraryGames('steam')
  const psn = useLibraryGames('playstation')

  const steamIds = useMemo(() => {
    const ids = new Set<number>()
    for (const g of steam.games) {
      const n = Number(g.external_ref)
      if (Number.isInteger(n) && n > 0) ids.add(n)
    }
    return [...ids].sort((a, b) => a - b)
  }, [steam.games])
  const steamKey = useMemo(() => idsKey(steamIds), [steamIds])

  const steamTypes = useQuery({
    // Outside the ['games'] namespace on purpose: every games mutation
    // invalidates that whole namespace, and a store type does not change
    // because a status did. `keepPreviousData` holds the old classification
    // while a changed id list (an import, a delete) loads — without it every
    // hidden app popped back onto the shelf for the length of the request.
    queryKey: ['steam', 'app-types', 'library', steamKey],
    queryFn: () => fetchSteamAppTypes(steamIds),
    enabled: steamIds.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })

  // Steam rows wait for their store types on first load: without them every
  // tool and soundtrack showed on the shelves for a moment and then vanished.
  // Games arriving a beat later read as loading; a failed type read shows
  // them unclassified (nothing hidden) rather than holding them back.
  const steamReady = steamIds.length === 0 || steamTypes.data !== undefined || steamTypes.isError
  const games = useMemo(
    () => deriveGames([...(retro.data ?? []), ...(steamReady ? steam.games : []), ...psn.games], steamTypes.data),
    [retro.data, steam.games, psn.games, steamTypes.data, steamReady],
  )

  const refetchRetro = retro.refetch
  const refetchSteam = steam.refetch
  const refetchPsn = psn.refetch
  const refetch = useCallback(() => { void refetchRetro() }, [refetchRetro])
  const retryProviders = useCallback(() => {
    void refetchSteam()
    void refetchPsn()
  }, [refetchSteam, refetchPsn])

  // A failed background refetch keeps the rows it already had; only a
  // library with nothing to show is an error worth surfacing.
  const failed = (lib: typeof steam) => (lib.isError && lib.games.length === 0 ? lib.error ?? new Error('Library failed to load') : null)

  return {
    games,
    // The retro library is the one every view needs; the two provider
    // libraries arrive into an already-painted page.
    isLoading: retro.isLoading,
    isError: retro.isError,
    error: retro.error,
    refetch,
    providersLoading: steam.isLoading || psn.isLoading || steamTypes.isLoading,
    providerError: failed(steam) ?? failed(psn),
    retryProviders,
  }
}
