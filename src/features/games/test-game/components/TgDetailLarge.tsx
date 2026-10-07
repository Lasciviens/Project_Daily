import { ModalShell } from '../../../../shared/modals/ModalShell'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailPanel } from './TgDetailPanel'

interface Props {
  /** The game to show; null closes the popup. */
  game: TgGame | null
  actions: TgActions
  onClose: () => void
}

/**
 * The overlay's details as a bigger popup: the same card (TgDetailPanel,
 * `large`), every word shown, the story and the record side by side once the
 * popup is wide enough. ModalShell gives it Esc, Back and stacking; it portals
 * to <body>, so the panel carries `tg-portal` for the page's tokens.
 */
export function TgDetailLarge({ game, actions, onClose }: Props) {
  return (
    <ModalShell
      open={game != null}
      onClose={onClose}
      title={game?.title ?? 'Game details'}
      subtitle="Details"
      size="xl"
      mobile="fullscreen"
      bodyClassName="relative !overflow-hidden p-0"
      panelClassName="tg-portal !border-[var(--tg-border)] !bg-[var(--tg-panel)] text-[var(--tg-text)] sm:!max-w-[min(76rem,calc(100vw-2rem))] sm:!h-[88dvh]"
    >
      {/* Pinned to the body's box: the card scrolls inside itself and keeps its footer. */}
      {game && <div className="absolute inset-0"><TgDetailPanel game={game} actions={actions} variant="large" /></div>}
    </ModalShell>
  )
}
