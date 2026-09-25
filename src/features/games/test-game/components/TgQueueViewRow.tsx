import { memo, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import {
  STATUS_TEXT, formatDay, lastPlayedIso, playSeconds, subtitleParts,
  type TgGame, type TgStatusFilter,
} from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStatusIcon } from './TgStatusIcon'

interface Props {
  game: TgGame
  /** 1-based place in the whole queue (a search can show a subset). */
  position: number
  selected: boolean
  /** This row is the one being dragged. */
  dragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onDragStart: (e: PointerEvent<HTMLElement>, id: string) => void
}

const ICON = { size: 18, strokeWidth: 2 } as const
const CONTROL = 'tg-icon-btn disabled:opacity-30 disabled:pointer-events-none'

/** A move re-inserts the row's node, which can drop focus: hand it back. */
function keepFocus(el: HTMLElement) {
  requestAnimationFrame(() => { if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true }) })
}

export const TgQueueViewRow = memo(function TgQueueViewRow({
  game, position, selected, dragging, canMoveUp, canMoveDown, onSelect, onMove, onRemove, onDragStart,
}: Props) {
  const seconds = playSeconds(game)
  const last = lastPlayedIso(game)
  const status = (game.play_status ?? 'backlog') as TgStatusFilter
  const statusText = STATUS_TEXT[status] ?? status
  const playtime = seconds != null ? formatPlaytime(seconds / 60) : null

  // Alt+↑/↓ anywhere in the row; plain ↑/↓ on the grip, which owns no other keys.
  function onKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    const onGrip = (e.target as HTMLElement).dataset.queueGrip != null
    if (!dir || !(e.altKey || onGrip) || (dir < 0 ? !canMoveUp : !canMoveDown)) return
    e.preventDefault()
    onMove(game.id, dir)
    keepFocus(e.target as HTMLElement)
  }

  return (
    <li
      data-queue-id={game.id}
      onKeyDown={onKeyDown}
      className={`relative flex items-center gap-1 sm:gap-2 rounded-xl pr-1 transition-colors ${
        dragging ? 'is-dragged' : ''
      } ${selected ? 'bg-[var(--tg-accent-soft)]' : 'hover:bg-[var(--tg-hover)]'}`}
    >
      <button
        type="button"
        data-queue-grip=""
        onPointerDown={e => onDragStart(e, game.id)}
        onClick={e => e.preventDefault()}
        aria-label={`Reorder ${game.title}, #${position}. Drag, or use the up and down arrow keys`}
        title="Drag to reorder"
        className="tg-icon-btn tg-queue-grip -mr-1 shrink-0 touch-none select-none sm:mr-0"
      >
        <GripVertical {...ICON} />
      </button>
      <button
        type="button"
        onClick={() => onSelect(game.id)}
        aria-pressed={selected}
        aria-label={`#${position} ${game.title}, ${statusText}${playtime ? `, ${playtime} played` : ''}`}
        className="flex-1 min-w-0 min-h-[76px] flex items-center gap-3 sm:gap-4 py-2 text-left rounded-lg"
      >
        <span
          className={`hidden sm:block w-11 shrink-0 text-right text-[22px] font-bold leading-none tabular-nums ${
            position === 1 ? 'text-[var(--tg-accent)]' : 'text-[var(--tg-faint)]'
          }`}
        >
          <span className="mr-px align-top text-[13px] font-semibold opacity-70">#</span>{position}
        </span>

        <span className="relative block w-11 h-[60px] shrink-0 overflow-hidden rounded-md bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)]">
          <TgCover game={game} mode="contain" />
          <span className="sm:hidden absolute left-0 top-0 min-w-[18px] rounded-br-md bg-[var(--tg-accent)] px-1 text-center text-[10px] font-bold leading-[16px] text-[var(--tg-on-accent)] tabular-nums">
            {position}
          </span>
        </span>

        <span className="flex-1 min-w-0">
          <span className="block truncate text-[14px] font-semibold text-[var(--tg-text)]">{game.title}</span>
          <span className="block truncate text-[12px] tg-muted">{subtitleParts(game).join(' · ')}</span>
          <span data-status={status} className="mt-1 flex items-center gap-1.5 text-[12px] font-medium">
            <TgStatusIcon status={status} size={13} />
            <span className="tg-status-text">{statusText}</span>
          </span>
        </span>

        <span className="hidden lg:flex w-40 shrink-0 flex-col items-end text-right text-[12px]">
          <span className="font-medium text-[var(--tg-text-2)] tabular-nums">
            {playtime ?? '—'}
          </span>
          <span className="tg-faint">{last ? `Last played ${formatDay(last)}` : 'Never played'}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        {/* The phone has the grip (and its arrow keys); the buttons would squeeze the title. */}
        <button type="button" className={`${CONTROL} max-sm:!hidden`} disabled={!canMoveUp}
          onClick={e => { onMove(game.id, -1); keepFocus(e.currentTarget) }} aria-label={`Move ${game.title} up`} title="Move up">
          <ChevronUp {...ICON} />
        </button>
        <button type="button" className={`${CONTROL} max-sm:!hidden`} disabled={!canMoveDown}
          onClick={e => { onMove(game.id, 1); keepFocus(e.currentTarget) }} aria-label={`Move ${game.title} down`} title="Move down">
          <ChevronDown {...ICON} />
        </button>
        <button type="button" className={`${CONTROL} hover:!text-[var(--tg-red)]`} onClick={() => onRemove(game.id)}
          aria-label={`Remove ${game.title} from the queue`} title="Remove from queue">
          <X {...ICON} />
        </button>
      </div>
    </li>
  )
})
