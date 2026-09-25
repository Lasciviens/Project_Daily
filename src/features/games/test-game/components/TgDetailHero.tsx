import { useMemo, useState } from 'react'
import { formatStars, heroCandidates, subtitleParts, type TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStars } from './TgStars'
import { TgStatusMenu } from './TgStatusMenu'
import { useDetailState } from './TgDetailState'

interface Props {
  game: TgGame
  /** Steam store genre, for rows imported without one. */
  steamGenre?: string | null
}

/** The scene art (walks `heroCandidates` on error, blurred cover as the last resort). */
function HeroArt({ game }: { game: TgGame }) {
  const candidates = useMemo(() => heroCandidates(game), [game])
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const [loaded, setLoaded] = useState<string | null>(null)
  const url = candidates.find(u => !failed.has(u))

  return (
    <div className="tg-hero h-[228px] bg-[var(--tg-panel-2)]">
      {url ? (
        <img
          src={url}
          alt=""
          decoding="async"
          fetchPriority="high"
          draggable={false}
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(f => new Set(f).add(url))}
          className={`tg-hero-img ${loaded === url ? 'tg-fade-in' : 'opacity-0'}`}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 scale-125 opacity-70 blur-2xl">
          <TgCover game={game} mode="cover" />
        </div>
      )}
      <div className="tg-hero-fade" />
    </div>
  )
}

/**
 * Hero, overlapping box art and the title block, as drawn: the cover and the
 * text column share one fixed-height row pulled up into the hero, bottom
 * aligned, so a two-line title grows UP into the art instead of pushing the
 * info rows down.
 */
export function TgDetailHero({ game, steamGenre }: Props) {
  const { stars, setStars } = useDetailState(game)
  const subtitle = subtitleParts(game, steamGenre).join(' · ')

  return (
    <div>
      <HeroArt game={game} />
      <div className="relative -mt-[118px] flex h-[150px] items-end gap-4 px-5">
        <div className="relative h-[150px] w-[108px] shrink-0 overflow-hidden rounded-lg bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)] ring-1 ring-[var(--tg-border-strong)]">
          <TgCover game={game} mode="contain" eager />
        </div>

        <div className="-mb-2 min-w-0 flex-1">
          <h2 className="line-clamp-2 break-words text-[20px] font-bold leading-[1.25] text-[var(--tg-text)]">
            {game.title}
          </h2>
          {subtitle && <p className="mt-1 truncate text-[12px] text-[var(--tg-muted)]">{subtitle}</p>}
          {/* Fixed-height line: an interactive TgStars keeps its 44px hit area
              (overflowing evenly) without spreading the block apart. */}
          <div className="mt-2 flex h-5 items-center gap-2">
            <TgStars stars={stars} size={15} onChange={setStars} />
            <span className="whitespace-nowrap text-[12px] text-[var(--tg-muted)]">
              {stars == null ? 'Not rated' : `${formatStars(stars)}/5 (My Rating)`}
            </span>
          </div>
          <TgStatusMenu game={game} className="mt-3" />
        </div>
      </div>
    </div>
  )
}
