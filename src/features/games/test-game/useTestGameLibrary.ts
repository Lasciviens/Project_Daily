import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

export function useTestGameLibrary(): TestGameLibrary {
  const retro = useAllGames()
  const steam = useLibraryGames('steam')
  const psn = useLibraryGames('playstation')

  const steamIds = useMemo(
    () => steam.games.map(g => Number(g.external_ref)).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b),
    [steam.games],
  )
  const steamTypes = useQuery({
    queryKey: ['games', 'test-game', 'steam-types', steamIds.length, steamIds[0] ?? 0, steamIds[steamIds.length - 1] ?? 0],
    queryFn: () => fetchSteamAppTypes(steamIds),
    enabled: steamIds.length > 0,
    staleTime: 10 * 60_000,
  })

  const games = useMemo(
    () => deriveGames([...(retro.data ?? []), ...steam.games, ...psn.games], steamTypes.data),
    [retro.data, steam.games, psn.games, steamTypes.data],
  )

  return {
    games,
    // The retro library is the one every view needs; the two provider
    // libraries arrive into an already-painted page.
    isLoading: retro.isLoading,
    isError: retro.isError,
    error: retro.error,
    refetch: () => { void retro.refetch() },
  }
}
