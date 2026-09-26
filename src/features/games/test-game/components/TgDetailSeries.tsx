import { useContext, useMemo } from 'react'
import { seriesSiblings, type TgGame } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import { TgGamesContext } from './tgRanks'
import { TgStatusIcon } from './TgStatusIcon'

/**
 * "More in this series": the rest of the game's series in release order, and
 * how far through it you are. Hidden until a series has two games here
 * (series_name fills as ScreenScraper scrapes land).
 */
export function TgDetailSeries({ game }: { game: TgGame }) {
  const games = useContext(TgGamesContext)
  const s = useMemo(() => seriesSiblings(games, game), [games, game])
  const openDetail = useTestGameStore(st => st.openDetail)
  if (!s) return null
  return (
    <section className="flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-3.5">
      <h3 className="tg-section-label">
        {s.series} · {s.completed} of {s.games.length} completed
      </h3>
      <ol className="flex flex-col">
        {s.games.map(g => (
          <li key={g.id}>
            <button
              type="button" onClick={() => openDetail(g.id)} disabled={g.id === game.id}
              aria-current={g.id === game.id ? 'true' : undefined}
              className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-[13px] ${g.id === game.id ? 'font-semibold' : '[@media(hover:hover)]:hover:bg-[var(--tg-hover)]'}`}
            >
              <span className="w-10 shrink-0 tabular-nums tg-muted">{g.release_year ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span data-status={g.play_status}><TgStatusIcon status={g.play_status} size={13} /></span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
