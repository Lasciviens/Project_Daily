import { memo, useState } from 'react'
import { formatPlaytime } from '../../api/playtimeFormat'
import {
  formatDay, lastPlayedIso, playSeconds, starsFromRating, subtitleParts, type TgGame,
} from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStars } from './TgStars'
import { TgStatusIcon } from './TgStatusIcon'
import { statusLabel } from './TgStatusMeta'
import { useRevealCard } from './useShelfLayout'

interface Props {
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

// Playtime and last played are the low-priority columns: gone below lg.
const COLUMNS = 'grid-cols-[40px_minmax(0,1fr)_112px_76px] lg:grid-cols-[40px_minmax(0,1fr)_112px_76px_84px_96px]'

const Row = memo(function Row({ game, selected, onSelect }: { game: TgGame; selected: boolean; onSelect: (id: string) => void }) {
  const seconds = playSeconds(game)
  return (
    // Off-screen rows skip layout and paint; the 2px padding holds the focus
    // ring (offset 0) inside the paint containment that comes with it.
    <div className="p-0.5 [contain-intrinsic-size:auto_68px] [content-visibility:auto]">
      <button
        type="button"
        data-game-id={game.id}
        aria-pressed={selected}
        onClick={() => onSelect(game.id)}
        className={`grid w-full min-h-[64px] ${COLUMNS} items-center gap-x-4 rounded-xl px-3 py-1.5 text-left transition-colors focus-visible:!outline-offset-0 ${
          selected ? 'bg-[var(--tg-accent-soft)]' : 'hover:bg-[var(--tg-hover)]'
        }`}
      >
        <span className="block h-[54px] w-10 overflow-hidden rounded-md shadow-[shadow:var(--tg-cover-shadow)]">
          <TgCover game={game} mode="contain" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[var(--tg-text)]">{game.title}</span>
          <span className="block truncate text-[12px] text-[var(--tg-muted)]">{subtitleParts(game).join(' · ')}</span>
        </span>
        <span data-status={game.play_status} className="flex min-w-0 items-center gap-2 text-[12.5px]">
          <TgStatusIcon status={game.play_status} />
          <span className="tg-status-text truncate font-medium">{statusLabel(game.play_status)}</span>
        </span>
        <TgStars stars={starsFromRating(game.rating)} size={12} />
        <span className="hidden text-[12.5px] tabular-nums text-[var(--tg-text-2)] lg:block">
          {seconds == null ? '—' : formatPlaytime(seconds / 60)}
        </span>
        <span className="hidden text-[12.5px] tabular-nums text-[var(--tg-text-2)] lg:block">{formatDay(lastPlayedIso(game))}</span>
      </button>
    </div>
  )
})

/** The third view: one dense row per game. */
export function TgListView({ games, selectedId, onSelect }: Props) {
  const [list, setList] = useState<HTMLDivElement | null>(null)
  // Scrolls to a newly selected row only — never on a refetch or a length change.
  useRevealCard(list, selectedId, 'list', games.length)

  return (
    <div ref={setList} role="region" aria-label="Games list" className="tg-panel tg-scroll-y h-full px-2 pb-2">
      <div className={`tg-section-label sticky top-0 z-[1] grid ${COLUMNS} gap-x-4 bg-[var(--tg-panel)] px-3.5 pb-2 pt-3`}>
        <span aria-hidden />
        <span>Title</span>
        <span>Status</span>
        <span>Rating</span>
        <span className="hidden lg:block">Playtime</span>
        <span className="hidden lg:block">Last played</span>
      </div>
      {games.map(g => <Row key={g.id} game={g} selected={g.id === selectedId} onSelect={onSelect} />)}
    </div>
  )
}
