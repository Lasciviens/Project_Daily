import { memo, useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { formatStars, starsFromRating, type TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStatusIcon } from './TgStatusIcon'
import { cardsForDepth, recalledDepth } from './tgScrollMemory'
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
      {/* Every cell keeps the same box so titles line up, but the frame (radius,
          shadow) hugs the art itself: a wide, square or small cover is scaled
          to fit and centred in the box, on the page background (no blurred fill). */}
      <div className="relative aspect-[0.72] w-full transition-transform duration-150 group-active:scale-[0.98]">
        <TgCover game={game} mode="natural" align="center" />
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
 * The design's gutters are ~20px with a ~24px column gap; the 20px comes from
 * the phone scroller in TestGamePage, shared by every section and the header.
 */
const FIRST = 48
const STEP = 96

/**
 * Cards mount in pages as the list is scrolled, not all ~1,000 at once:
 * content-visibility skips paint but not React or DOM work, and older iOS has
 * no content-visibility at all. The page remounts the grid (a `key`) when the
 * list itself changes; a list returned to mounts enough cards for the depth
 * it was left at (tgScrollMemory), so the restored scroll lands there.
 */
export function TgMobileGrid({ games, onSelect, listKey }: { games: TgGame[]; onSelect: (id: string) => void; listKey?: string }) {
  const [limit, setLimit] = useState(() => Math.max(FIRST, listKey ? cardsForDepth(recalledDepth(listKey)) : 0))
  const sentinel = useRef<HTMLDivElement>(null)
  const more = games.length > limit

  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    // The scroller, not the viewport: an element below a scroll container's
    // edge is clipped before the viewport's margin could see it.
    const root = el.closest('.tg-scroll-y')
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setLimit(l => l + STEP)
    }, { root, rootMargin: '1500px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, limit])

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 pb-4">
        {(more ? games.slice(0, limit) : games).map(g => <MobileCard key={g.id} game={g} onSelect={onSelect} />)}
      </div>
      {more && <div ref={sentinel} aria-hidden className="h-px" />}
    </>
  )
}
