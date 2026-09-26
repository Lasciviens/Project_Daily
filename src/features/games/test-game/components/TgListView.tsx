import { memo, useState, type KeyboardEvent } from 'react'
import { formatPlaytime } from '../../api/playtimeFormat'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  extraVariants, formatDay, lastPlayedIso, platformInfo, playCount, playSeconds, starsFromRating, subtitleParts,
  type TgGame, type TgSort,
} from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import { TgCover } from './TgCover'
import { TgStars } from './TgStars'
import { TgStatusIcon } from './TgStatusIcon'
import { cardStatus } from './TgStatusMeta'
import { useScrollReset } from './useScrollReset'
import { useRevealCard } from './useShelfLayout'
import { gridStep, stepOrigin } from './tgGridNav'

interface Props {
  games: TgGame[]
  selectedId: string | null
  /** Changes when the list is a different list (section, filters, sort): back to the top. */
  resetKey?: string
  onSelect: (id: string) => void
}

// Playtime and last played are the low-priority columns: gone below lg;
// platforms, genres and launches appear only where there is room (xl).
const COLUMNS = 'grid-cols-[40px_minmax(0,1fr)_112px_76px] lg:grid-cols-[40px_minmax(0,1fr)_112px_76px_84px_96px] xl:grid-cols-[40px_minmax(0,1fr)_112px_76px_84px_96px_110px_150px_64px]'

const Row = memo(function Row({ game, selected, focusable, onSelect }: { game: TgGame; selected: boolean; focusable: boolean; onSelect: (id: string) => void }) {
  const seconds = playSeconds(game)
  const stars = starsFromRating(game.rating)
  const launches = playCount(game)
  const st = cardStatus(game)
  return (
    // Off-screen rows skip layout and paint; the 2px padding holds the focus
    // ring (offset 0) inside the paint containment that comes with it.
    <div className="p-0.5 [contain-intrinsic-size:auto_68px] [content-visibility:auto]">
      <button
        type="button"
        data-game-id={game.id}
        aria-pressed={selected}
        tabIndex={focusable ? 0 : -1}
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
        <span data-status={st.status} className="flex min-w-0 items-center gap-2 text-[12.5px]">
          <TgStatusIcon status={st.status} />
          <span className="tg-status-text truncate font-medium">{st.label}</span>
        </span>
        {/* Unrated rows get a dash: five empty stars per row were most of the list's DOM. */}
        {stars == null
          ? <span aria-label="Not rated" className="text-[12.5px] text-[var(--tg-faint)]">—</span>
          : <TgStars stars={stars} size={12} />}
        <span className="hidden text-[12.5px] tabular-nums text-[var(--tg-text-2)] lg:block">
          {seconds == null ? '—' : formatPlaytime(seconds / 60)}
        </span>
        <span className="hidden text-[12.5px] tabular-nums text-[var(--tg-text-2)] lg:block">{formatDay(lastPlayedIso(game))}</span>
        <span className="hidden truncate text-[12.5px] text-[var(--tg-text-2)] xl:block" title={game.platforms.map(p => p.system).join(', ') || undefined}>
          {platformInfo(game.platformKey).short}{extraVariants(game) > 0 ? ` +${extraVariants(game)}` : ''}
        </span>
        <span className="hidden truncate text-[12px] text-[var(--tg-muted)] xl:block" title={(game.genres ?? []).join(', ') || undefined}>
          {(game.genres ?? []).slice(0, 2).join(', ') || '—'}
        </span>
        <span className="hidden text-right text-[12.5px] tabular-nums text-[var(--tg-text-2)] xl:block">{launches != null && launches > 0 ? launches.toLocaleString('en-GB') : '—'}</span>
      </button>
    </div>
  )
})

/** A column heading that sorts by it (a second tap flips Title to Z–A). */
function SortHead({ label, sorts, className = '' }: { label: string; sorts: TgSort[]; className?: string }) {
  const sort = useTestGameStore(s => s.sort)
  const setSort = useTestGameStore(s => s.setSort)
  const active = sorts.includes(sort)
  const next = active && sorts.length > 1 ? sorts[(sorts.indexOf(sort) + 1) % sorts.length] : sorts[0]
  return (
    <button
      type="button" onClick={() => setSort(next)} aria-pressed={active}
      aria-label={`Sort by ${label.toLowerCase()}${active ? ' (current)' : ''}`}
      className={`inline-flex min-h-[32px] items-center gap-1 text-left uppercase [@media(pointer:coarse)]:min-h-[44px] tracking-[inherit] ${active ? 'text-[var(--tg-text)]' : ''} ${className}`}
    >
      {label}
      {active && (sort === 'title-desc' ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" />)}
    </button>
  )
}

/** The third view: one dense row per game. Up / Down walk it; one row is a tab stop. */
export function TgListView({ games, selectedId, onSelect, resetKey }: Props) {
  const [list, setList] = useState<HTMLDivElement | null>(null)
  useScrollReset(list, resetKey)
  // Scrolls to a newly selected row only — never on a refetch or a length change.
  useRevealCard(list, selectedId, 'list', games.length)
  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  const focusId = selectedIndex >= 0 ? selectedId : games[0]?.id ?? null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    // Only from a row: the column headings keep their own keys.
    if (!(e.target as HTMLElement).dataset?.gameId) return
    const next = gridStep(e.key, stepOrigin(e.target, games, selectedIndex), games.length - 1, 1)
    if (next == null) return
    e.preventDefault()
    const id = games[next].id
    if (next !== selectedIndex) onSelect(id)
    list?.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }

  return (
    <div ref={setList} role="region" aria-label="Games list" onKeyDown={onKeyDown} className="tg-panel tg-scroll-y h-full px-2 pb-2">
      <div className={`tg-section-label sticky top-0 z-[1] grid ${COLUMNS} items-center gap-x-4 bg-[var(--tg-panel)] px-3.5 pb-2 pt-3`}>
        <span aria-hidden />
        <SortHead label="Title" sorts={['title', 'title-desc']} />
        <span>Status</span>
        <SortHead label="Rating" sorts={['rating']} />
        <SortHead label="Playtime" sorts={['playtime']} className="hidden lg:flex" />
        <SortHead label="Last played" sorts={['recent']} className="hidden lg:flex" />
        <span className="hidden xl:block">Platform</span>
        <span className="hidden xl:block">Genres</span>
        <span className="hidden text-right xl:block">Launches</span>
      </div>
      {games.map(g => <Row key={g.id} game={g} selected={g.id === selectedId} focusable={g.id === focusId} onSelect={onSelect} />)}
    </div>
  )
}
