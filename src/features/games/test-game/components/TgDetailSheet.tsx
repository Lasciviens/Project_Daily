import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailPanel } from './TgDetailPanel'

interface Props {
  game: TgGame | null
  variant: 'drawer' | 'fullscreen'
  actions: TgActions
  onClose: () => void
}

// Side insets: a landscape phone is a "tablet" here, and its notch would sit
// over the drawer's close button and footer.
const PANEL: Record<Props['variant'], string> = {
  drawer: 'fixed inset-y-0 right-0 flex h-full w-[calc(420px+env(safe-area-inset-right))] max-w-full overflow-hidden rounded-l-[18px] pr-[env(safe-area-inset-right)] border-l border-[var(--tg-border)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-300 ease-out data-[closed]:translate-x-full',
  fullscreen: 'fixed inset-0 flex pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition duration-300 ease-out data-[closed]:translate-y-full',
}

/**
 * Tablet (drawer from the right) and phone (full screen) home of the detail
 * panel. The shell renders ONE of these and switches `variant` with the
 * breakpoint, so rotating a phone restyles the open sheet instead of
 * remounting it (a remount's history cleanup would close it).
 */
export function TgDetailSheet({ game, variant, actions, onClose }: Props) {
  // Keep showing the last game while the sheet animates out — by then the
  // shell has already cleared `game`, and an empty card would flash.
  const [lastGame, setLastGame] = useState(game)
  if (game && game !== lastGame) setLastGame(game)
  const shown = game ?? lastGame
  const open = game != null

  // Android Back / iOS edge-swipe closes the sheet instead of leaving the page.
  useHistoryDismiss(open, onClose)

  // z-40: above the page's own chrome, and at the same level as the shell's
  // edit modal (GameDetailModal, z-40) which, opened later, stacks on top.
  // The name goes on the root — in Headless UI v2 that is the role="dialog"
  // element (a label on DialogPanel names nothing).
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label={shown ? `${shown.title} details` : 'Game details'}
      className="tg-portal relative z-40"
    >
      <DialogBackdrop
        transition
        className={`fixed inset-0 transition duration-300 data-[closed]:opacity-0 ${variant === 'drawer' ? 'bg-black/40 backdrop-blur-[2px]' : 'bg-black/60'}`}
      />
      <DialogPanel transition className={`bg-[var(--tg-panel)] ${PANEL[variant]}`}>
        <TgDetailPanel game={shown} actions={actions} variant="sheet" onClose={onClose} />
      </DialogPanel>
    </Dialog>
  )
}
