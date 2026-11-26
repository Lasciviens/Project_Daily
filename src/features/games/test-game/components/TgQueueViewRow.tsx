import { memo, type KeyboardEvent } from 'react'
import { CalendarPlus, ChevronDown, ChevronUp, GripVertical, Play, X } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import {
  STATUS_TEXT, formatDay, lastPlayedIso, playSeconds, subtitleParts,
  type TgGame, type TgStatusFilter,
} from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStatusIcon } from './TgStatusIcon'
import { Truncate } from '../../../../shared/ui/Truncate'
import { useDragReorderRow } from '../../../../shared/ui/dragReorder/dragReorderRow'

interface Props {
  game: TgGame
  /** The 1-based places in the whole queue, in list order (a search can show a subset). */
  slots: readonly number[]
  selected: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  /** Start playing it now (stamps the start date) — absent when it already is. */
  onPlay?: (id: string) => void
  /** Plan a session in the calendar. */
  onPlan?: (game: TgGame) => void
}

const ICON = { size: 18, strokeWidth: 2 } as const
const CONTROL = 'tg-icon-btn disabled:opacity-30 disabled:pointer-events-none'

export const TgQueueViewRow = memo(function TgQueueViewRow({
  game, slots, selected, onSelect, onRemove, onPlay, onPlan,
}: Props) {
  // A row of the shared drag (DragReorderList), by its grip: a mouse drags once it moves, a finger holds, then drags.
  const row = useDragReorderRow(game.id, { handle: true })
  const { index, count, dragging } = row
  const canMoveUp = index > 0
  const canMoveDown = index < count - 1
  // While a row is dragged every row shows the place it gets if it drops now.
  const position = slots[row.place] ?? row.place + 1
  const seconds = playSeconds(game)
  const last = lastPlayedIso(game)
  const status = (game.play_status ?? 'backlog') as TgStatusFilter
  const statusText = STATUS_TEXT[status] ?? status
  const playtime = seconds != null ? formatPlaytime(seconds / 60) : null

  // Alt+↑/↓ anywhere in the row; plain ↑/↓ on the grip, which owns no other keys.
  function onKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (e.defaultPrevented) return // the grip's Alt+↑/↓ (the shared row) already moved it
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    const onGrip = (e.target as HTMLElement).dataset.queueGrip != null
    if (!dir || !(e.altKey || onGrip) || (dir < 0 ? !canMoveUp : !canMoveDown)) return
    e.preventDefault()
    row.move(index + dir, e.target as HTMLElement)
  }

  return (
    <li
      {...row.rowProps}
      data-queue-id={game.id}
      onKeyDown={onKeyDown}
      className={`${row.rowClassName} @container/qrow flex items-center gap-1 @[30rem]/qrow:gap-2 rounded-xl pr-1 transition-colors ${
        dragging ? 'is-dragged' : ''
      } ${selected ? 'bg-[var(--tg-accent-soft)]' : 'hover:bg-[var(--tg-hover)]'}`}
    >
      <button
        type="button"
        data-queue-grip=""
        {...row.handleProps}
        onClick={e => e.preventDefault()}
        aria-label={`Reorder ${game.title}, #${position}. Drag, or use the up and down arrow keys`}
        title="Drag to reorder"
        className={`${row.handleClassName} tg-icon-btn tg-queue-grip -mr-1 shrink-0 @[30rem]/qrow:mr-0`}
      >
        <GripVertical {...ICON} />
      </button>
      <button
        type="button"
        onClick={() => onSelect(game.id)}
        aria-pressed={selected}
        aria-label={`#${position} ${game.title}, ${statusText}${playtime ? `, ${playtime} played` : ''}`}
        className="flex-1 min-w-0 min-h-[76px] flex items-center gap-3 @[30rem]/qrow:gap-4 py-2 text-left rounded-lg"
      >
        <span
          className={`hidden @[38rem]/qrow:block w-11 shrink-0 text-right text-[22px] font-bold leading-none tabular-nums ${
            position === 1 ? 'text-[var(--tg-accent)]' : 'text-[var(--tg-faint)]'
          }`}
        >
          <span className="mr-px align-top text-[13px] font-semibold opacity-70">#</span>{position}
        </span>

        <span className="relative block w-11 h-[60px] shrink-0 overflow-hidden rounded-md bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)]">
          <TgCover game={game} mode="contain" />
          <span className="@[38rem]/qrow:hidden absolute left-0 top-0 min-w-[18px] rounded-br-md bg-[var(--tg-accent)] px-1 text-center text-[10px] font-bold leading-[16px] text-[var(--tg-on-accent)] tabular-nums">
            {position}
          </span>
        </span>

        <span className="flex-1 min-w-0">
          <Truncate className="text-[14px] font-semibold text-[var(--tg-text)]">{game.title}</Truncate>
          <Truncate className="text-[12px] tg-muted">{subtitleParts(game).join(' · ')}</Truncate>
          <span data-status={status} className="mt-1 flex items-center gap-1.5 text-[12px] font-medium">
            <TgStatusIcon status={status} size={13} />
            <span className="tg-status-text">{statusText}</span>
          </span>
        </span>

        <span className="hidden @[48rem]/qrow:flex w-40 shrink-0 flex-col items-end text-right text-[12px]">
          <span className="font-medium text-[var(--tg-text-2)] tabular-nums">
            {playtime ?? '—'}
          </span>
          <span className="tg-faint">{last ? `Last played ${formatDay(last)}` : 'No recorded play'}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        {/* Start it / plan it — the queue's two next steps. The controls follow the ROW's
            width, not the viewport's: a phone row and a row squeezed beside the open
            details both keep only Remove (the grip reorders; the details start or plan it). */}
        {onPlay && status !== 'playing' && (
          <button type="button" className={`${CONTROL} !hidden @[38rem]/qrow:!inline-flex hover:!text-[var(--tg-accent)]`} onClick={() => onPlay(game.id)}
            aria-label={`Mark ${game.title} as playing`} title="Mark as playing">
            <Play {...ICON} />
          </button>
        )}
        {onPlan && (
          <button type="button" className={`${CONTROL} !hidden @[38rem]/qrow:!inline-flex`} onClick={() => onPlan(game)}
            aria-label={`Plan a session of ${game.title}`} title="Plan a session">
            <CalendarPlus {...ICON} />
          </button>
        )}
        <button type="button" className={`${CONTROL} !hidden @[30rem]/qrow:!inline-flex`} disabled={!canMoveUp}
          onClick={e => row.move(index - 1, e.currentTarget)} aria-label={`Move ${game.title} up`} title="Move up">
          <ChevronUp {...ICON} />
        </button>
        <button type="button" className={`${CONTROL} !hidden @[30rem]/qrow:!inline-flex`} disabled={!canMoveDown}
          onClick={e => row.move(index + 1, e.currentTarget)} aria-label={`Move ${game.title} down`} title="Move down">
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
