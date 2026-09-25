import { memo } from 'react'
import { Star } from 'lucide-react'
import { formatStars, starsFromRating, type TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStatusIcon } from './TgStatusIcon'
import { gameCardLabel, statusLabel } from './TgStatusMeta'

const MobileCard = memo(function MobileCard({ game, onSelect }: { game: TgGame; onSelect: (id: string) => void }) {
  const stars = starsFromRating(game.rating)
  return (
    <button
      type="button"
      onClick={() => onSelect(game.id)}
      aria-label={gameCardLabel(game)}
      // Off-screen cards skip layout and paint; the intrinsic size is one card
      // at 393px wide, so the scrollbar doesn't jump as rows render in.
      className="group block min-w-0 rounded-md text-left [contain-intrinsic-size:auto_280px] [content-visibility:auto]"
    >
      <div className="relative aspect-[0.72] w-full overflow-hidden rounded-md bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)] ring-1 ring-[var(--tg-border)] transition-transform duration-150 group-active:scale-[0.98]">
        <TgCover game={game} mode="contain" className="h-full w-full" />
      </div>
      <div className="mt-2 truncate text-[13px] font-semibold leading-[1.35] text-[var(--tg-text)]">
        {game.title}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] leading-[1.3]">
        <span data-status={game.play_status} className="flex min-w-0 items-center gap-1.5">
          <TgStatusIcon status={game.play_status} size={12} />
          <span className="tg-status-text truncate font-medium">{statusLabel(game.play_status)}</span>
        </span>
        {stars != null && (
          <span className="flex shrink-0 items-center gap-1 font-medium tabular-nums text-[var(--tg-text-2)]">
            <Star size={11} strokeWidth={0} className="fill-[var(--tg-star)]" aria-hidden />
            {formatStars(stars)}
          </span>
        )}
      </div>
    </button>
  )
})

/**
 * The phone's two-column cover grid; tapping a card opens the detail sheet.
 * The design's gutters are ~20px with a ~24px column gap: px-1 here adds to
 * the phone scroller's own 16px (px-4 in TestGamePage), so the grid keeps its
 * spacing without the shell padding every section differently.
 */
export function TgMobileGrid({ games, onSelect }: { games: TgGame[]; onSelect: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-1 pb-4">
      {games.map(g => <MobileCard key={g.id} game={g} onSelect={onSelect} />)}
    </div>
  )
}
