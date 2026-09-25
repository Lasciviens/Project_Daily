import { Toaster } from '../../../../shared/components/Toaster'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { GameDetailModal } from '../../components/GameDetailModal'
import { SteamGameModal } from '../../components/SteamGameModal'
import { PsnGameModal } from '../../components/PsnGameModal'
import type { SteamGame } from '../../api/steamApi'
import { psnGamesFromLibrary } from '../../api/psnLibraryFallback'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import type { TgBreakpoint } from '../useTgBreakpoint'
import { TgDetailSheet } from './TgDetailSheet'

// Every modal the page owns, in one place the shell renders OUTSIDE its
// layout tree, so switching layouts never remounts (and so closes) one. The
// tablet/desktop details are not modal — they live in the layout as the
// non-modal TgDetailOverlay — so the only sheet here is the phone's.

/** A saved library row, shaped as the live Steam payload the modal expects. */
function toSteamGame(g: TgGame): SteamGame {
  const last = g.last_played_at ? Math.floor(Date.parse(g.last_played_at) / 1000) : undefined
  return {
    appid: g.steamAppId ?? 0,
    name: g.title,
    playtime_forever: Math.round((g.play_seconds ?? 0) / 60),
    rtime_last_played: Number.isFinite(last) ? last : undefined,
  }
}

// Toasts clear the phone's tab bar and the sheet's Play/Edit footer (both
// under 76px + the home indicator), and the notch/home indicator elsewhere.
const TOAST_POSITION: Record<TgBreakpoint, string> = {
  mobile: 'bottom-[calc(76px+env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))]',
  tablet: 'bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1.5rem,env(safe-area-inset-left))]',
  desktop: 'bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1.5rem,env(safe-area-inset-left))]',
}

interface Props {
  bp: TgBreakpoint
  actions: TgActions
  /** The game the phone's full-screen sheet shows (null: closed, and always at tablet/desktop width). */
  sheetGame: TgGame | null
  onCloseSheet: () => void
  editId: string | null
  fullId: string | null
  provider: TgGame | null
  onClose: (which: 'edit' | 'full' | 'provider') => void
}

export function TgModals({ bp, actions, sheetGame, onCloseSheet, editId, fullId, provider, onClose }: Props) {
  return (
    <>
      {/* Widening past the phone layout closes the sheet (its history entry
          rolls back) and the overlay takes the same open game over. */}
      <TgDetailSheet
        game={bp === 'mobile' ? sheetGame : null}
        variant="fullscreen"
        actions={actions}
        onClose={onCloseSheet}
      />
      {editId && <GameDetailModal gameId={editId} initialEditing onClose={() => onClose('edit')} />}
      {fullId && <GameDetailModal gameId={fullId} onClose={() => onClose('full')} />}
      {provider?.library === 'steam' && provider.steamAppId != null && (
        <ErrorBoundary label="Steam" action="test_game_steam_modal">
          <SteamGameModal game={toSteamGame(provider)} onClose={() => onClose('provider')} />
        </ErrorBoundary>
      )}
      {provider?.library === 'playstation' && (
        <ErrorBoundary label="PlayStation" action="test_game_psn_modal">
          <PsnGameModal game={psnGamesFromLibrary([provider])[0]} onClose={() => onClose('provider')} />
        </ErrorBoundary>
      )}
      <Toaster positionClassName={TOAST_POSITION[bp]} />
    </>
  )
}
