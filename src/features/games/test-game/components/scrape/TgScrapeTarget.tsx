import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { coverCandidates, platformInfo, type TgGame } from '../../testGameModel'
import { TgCover } from '../TgCover'
import { TgScrapeDialog } from './TgScrapeDialog'
import { isScraped, primaryVariant, scrapedId } from './tgScrapeModel'
import { romFileName } from '../../../scraper/ssPlan'

type PickFilter = 'todo' | 'no_cover' | 'no_desc' | 'all'
const FILTERS: { key: PickFilter; label: string }[] = [
  { key: 'todo', label: 'Not scraped' },
  { key: 'no_cover', label: 'No cover' },
  { key: 'no_desc', label: 'No description' },
  { key: 'all', label: 'All' },
]
const SHOWN = 150

function matches(g: TgGame, f: PickFilter): boolean {
  if (f === 'todo') return !isScraped(g)
  if (f === 'no_cover') return coverCandidates(g).length === 0
  if (f === 'no_desc') return !g.description?.trim()
  return true
}

/** The game being scraped, the way to pick another, and (folded) the search
 *  that ran for it — one compact panel on the phone. */
export function TgScrapeTarget({ games, target, loading, onPick, footer }: {
  games: TgGame[]
  target: TgGame | null
  loading: boolean
  onPick: (id: string | null) => void
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const p = primaryVariant(target)
  const file = romFileName(p?.esde_path)
  const prevId = target ? scrapedId(target) : null

  return (
    <>
      {target ? (
        <div className="tg-panel overflow-hidden">
          <div className="flex items-center gap-3 p-3">
            <div className="relative h-[64px] w-[46px] shrink-0">
              <TgCover game={target} mode="natural" align="center" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug">{target.title}</p>
              <p className="mt-0.5 truncate text-[12px] tg-muted">
                {platformInfo(target.platformKey).name}{file ? ` · ${file}` : ''}
              </p>
              {prevId && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--tg-green)]">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden /> Matched before · #{prevId}
                </p>
              )}
            </div>
            <button type="button" onClick={() => setOpen(true)} className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[13px]">
              Change
            </button>
          </div>
          {footer && <div className="border-t border-[var(--tg-border)]">{footer}</div>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={loading}
          className="tg-panel flex w-full items-center gap-3 p-4 text-left transition-colors [@media(hover:hover)]:hover:border-[var(--tg-border-strong)]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
            <Search className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{loading ? 'Loading your library…' : 'Pick a game to scrape'}</span>
            <span className="block text-[12px] tg-muted">Its name and ROM file fill the search for you.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 tg-muted" aria-hidden />
        </button>
      )}
      <TgScrapeGamePicker open={open} onClose={() => setOpen(false)} games={games} currentId={target?.id ?? null} onPick={(id) => { onPick(id); setOpen(false) }} />
    </>
  )
}

function TgScrapeGamePicker({ open, onClose, games, currentId, onPick }: {
  open: boolean
  onClose: () => void
  games: TgGame[]
  currentId: string | null
  onPick: (id: string) => void
}) {
  const [filter, setFilter] = useState<PickFilter>('todo')
  const [q, setQ] = useState('')
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.key, games.filter(g => matches(g, f.key)).length])) as Record<PickFilter, number>, [games])
  const needle = q.trim().toLowerCase()
  const hit = (g: TgGame) => g.title.toLowerCase().includes(needle) || platformInfo(g.platformKey).name.toLowerCase().includes(needle)
  const list = useMemo(() => games
    .filter(g => matches(g, filter))
    .filter(g => !needle || hit(g))
    .sort((a, b) => a.title.localeCompare(b.title)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [games, filter, needle])
  // A search that finds nothing under the active chip still finds the game
  // elsewhere — "No games match" for a game you own read as a bug.
  const elsewhere = useMemo(() => (needle && list.length === 0 ? games.filter(hit).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 50) : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [games, needle, list.length])

  return (
    <TgScrapeDialog open={open} onClose={onClose} title="Pick a game">
      <div className="sticky top-0 z-[1] -mx-5 bg-[var(--tg-panel)] px-5 pb-3">
        <label className="relative block">
          <span className="sr-only">Search your games</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 tg-muted" aria-hidden />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Title or platform" className="tg-input pl-9 pr-3" autoComplete="off" />
        </label>
        <div role="group" aria-label="Show" className="tg-scroll-x -mx-1 mt-2.5 flex gap-1.5 px-1">
          {FILTERS.map(f => (
            <button
              key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={`tg-tab min-h-[44px] shrink-0 !px-3 !text-[12.5px] ${filter === f.key ? 'is-active' : 'bg-[var(--tg-panel-2)]'}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 && elsewhere.length > 0 && (
        <p className="pb-2 text-[12.5px] tg-muted">Nothing under “{FILTERS.find(f => f.key === filter)?.label}” — found in your whole library:</p>
      )}
      {list.length === 0 && elsewhere.length === 0 ? (
        <p className="py-10 text-center text-[13px] tg-muted">No games match.</p>
      ) : (
        <ul className="flex flex-col">
          {(list.length ? list : elsewhere).slice(0, SHOWN).map(g => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onPick(g.id)}
                aria-current={g.id === currentId ? 'true' : undefined}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] ${g.id === currentId ? 'bg-[var(--tg-accent-soft)]' : ''}`}
              >
                <span className="relative h-[46px] w-[33px] shrink-0 [contain-intrinsic-size:auto_46px] [content-visibility:auto]">
                  <TgCover game={g} mode="natural" align="center" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{g.title}</span>
                  <span className="block truncate text-[11.5px] tg-muted">
                    {platformInfo(g.platformKey).name}
                    {isScraped(g) ? ' · matched' : ''}
                    {!g.description?.trim() ? ' · no description' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {list.length > SHOWN && (
            <li className="py-3 text-center text-[12px] tg-muted">{list.length - SHOWN} more — type to narrow the list.</li>
          )}
        </ul>
      )}
    </TgScrapeDialog>
  )
}
