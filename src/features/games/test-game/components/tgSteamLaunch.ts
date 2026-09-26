import { useCallback } from 'react'
import type { TgGame } from '../testGameModel'
import { useDetailState } from './TgDetailState'

/**
 * "Launch on Steam" for a Steam row, or null for every other game (the web can
 * only hand a game to the Steam client). Promotes a backlog/wishlist game to
 * Playing first: the protocol hand-off can stall the page behind an
 * "Open Steam?" prompt, and the write should not wait on it.
 */
export function useSteamLaunch(game: TgGame): (() => void) | null {
  const { status, setStatus } = useDetailState(game)
  const appId = game.library === 'steam' ? game.steamAppId : null
  const launch = useCallback(() => {
    if (appId == null) return
    if (status === 'backlog' || status === 'wishlist') setStatus('playing')
    window.location.href = `steam://rungameid/${appId}`
  }, [appId, status, setStatus])
  return appId != null ? launch : null
}
