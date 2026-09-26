import { Suspense, useState } from 'react'
import { Toaster } from '../../../../shared/components/Toaster'
import { UnifiedPlanModal } from '../../../../shared/components/plan-modal'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { lazyWithReload } from '../../../../shared/utils/lazyWithReload'
import type { SteamGame } from '../../api/steamApi'
import { psnGamesFromLibrary } from '../../api/psnLibraryFallback'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import type { TgBreakpoint } from '../useTgBreakpoint'
import { TgDetailSheet } from './TgDetailSheet'
import { TgChunkFailed } from './TgStates'
import { useTgAddGame } from './tgAddGame'

// The classic edit form, Add game and the provider modals load on first use.
const GameDetailModal = lazyWithReload(() => import('../../components/GameDetailModal').then(m => m.GameDetailModal), TgChunkFailed)
const AddGameModal = lazyWithReload(() => import('../../components/AddGameModal').then(m => m.AddGameModal), TgChunkFailed)
const SteamGameModal = lazyWithReload(() => import('../../components/SteamGameModal').then(m => m.SteamGameModal), TgChunkFailed)
const PsnGameModal = lazyWithReload(() => import('../../components/PsnGameModal').then(m => m.PsnGameModal), TgChunkFailed)

// Every modal the page owns, in one place the shell renders OUTSIDE its
// layout tree, so switching layouts never remounts (and so closes) one. The
// tablet/desktop details are not modal — they live in the layout as the
// non-modal TgDetailOverlay — so the only sheet here is the phone's.
// The legacy dialogs get `tg-portal tg-legacy` so they take this page's
// palette (testGame.css) instead of the app's cream one.

const LEGACY = 'tg-portal tg-legacy'

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
  /** The game a play session is being planned for (the calendar planner). */
  planGame: TgGame | null
  onClosePlan: () => void
}

export function TgModals({ bp, actions, sheetGame, onCloseSheet, editId, fullId, provider, onClose, planGame, onClosePlan }: Props) {
  const addOpen = useTgAddGame(s => s.open)
  const setAddOpen = useTgAddGame(s => s.setOpen)
  // Add game stays mounted once opened, so it keeps its closing animation.
  const [addMounted, setAddMounted] = useState(false)
  if (addOpen && !addMounted) setAddMounted(true)
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
      {/* Each mounts only once it is opened, so its code loads on first use. */}
      <Suspense fallback={null}>
        {editId && <GameDetailModal gameId={editId} initialEditing className={LEGACY} onClose={() => onClose('edit')} />}
        {fullId && <GameDetailModal gameId={fullId} className={LEGACY} onClose={() => onClose('full')} />}
        {addMounted && <AddGameModal open={addOpen} className={LEGACY} onClose={() => setAddOpen(false)} />}
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
      </Suspense>
      {/* The app's one planner (a time block in the Games category); it keeps
          the app palette — plan-modal/ takes no theme and is not edited here. */}
      {planGame && (
        <UnifiedPlanModal
          open
          onClose={onClosePlan}
          mode="schedule"
          config={{ heading: 'Plan a gaming session' }}
          defaults={{ title: `🎮 ${planGame.title}`, duration: 60, category: 'games', color: 'purple' }}
        />
      )}
      <Toaster positionClassName={TOAST_POSITION[bp]} />
    </>
  )
}
