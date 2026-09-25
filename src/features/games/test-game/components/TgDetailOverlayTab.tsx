import type { Ref } from 'react'
import { ChevronsLeft, X } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStatusIcon } from './TgStatusIcon'

interface Props {
  game: TgGame
  onExpand: () => void
  onClose: () => void
  /** The expand button, for the overlay to move focus onto after a collapse. */
  expandRef: Ref<HTMLButtonElement>
}

const HOVER = '[@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:text-[var(--tg-text)] active:bg-[var(--tg-hover)]'

/**
 * What the tucked-away overlay shows in its slim tab at the right edge (the
 * frame is TgDetailOverlay's): the selected game's box art, status and title
 * running down it, then Close. The tab follows the selection without opening;
 * the whole upper part expands it again.
 */
export function TgDetailOverlayTab({ game, onExpand, onClose, expandRef }: Props) {
  return (
    <>
      <button
        ref={expandRef}
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${game.title} details`}
        title="Expand details"
        className={`flex w-12 flex-col items-center gap-2.5 rounded-xl pb-3 pt-2.5 text-[var(--tg-accent)] transition-colors focus-visible:!rounded-xl ${HOVER}`}
      >
        <ChevronsLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
        <span className="block h-[54px] w-10 overflow-hidden rounded-md bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)] ring-1 ring-[var(--tg-border-strong)]">
          <TgCover game={game} mode="contain" />
        </span>
        <TgStatusIcon status={game.play_status ?? 'backlog'} size={14} />
        {/* Reads top to bottom, like a book's spine on the shelf. */}
        <span className="max-h-[168px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold leading-none text-[var(--tg-text)] [writing-mode:vertical-rl]">
          {game.title}
        </span>
      </button>
      <span aria-hidden className="my-1 h-px w-7 bg-[var(--tg-border)]" />
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${game.title} details`}
        title="Close (Esc)"
        className={`grid h-11 w-11 place-items-center rounded-xl text-[var(--tg-text-2)] transition-colors focus-visible:!rounded-xl ${HOVER}`}
      >
        <X aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
      </button>
    </>
  )
}
