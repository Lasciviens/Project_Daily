import { useMemo, useState } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { platformInfo, type TgGame } from '../../testGameModel'
import { TgCover } from '../TgCover'
import { TgScrapeDialog } from './TgScrapeDialog'
import { primaryVariant } from './tgScrapeModel'
import { romFileName } from '../../../scraper/ssPlan'

type PickFilter = 'todo' | 'no_cover' | 'no_desc' | 'all'
const FILTERS: { key: PickFilter; label: string }[] = [
  { key: 'todo', label: 'Not scraped' },
  { key: 'no_cover', label: 'No cover' },
  { key: 'no_desc', label: 'No description' },
  { key: 'all', label: 'All' },
]
const SHOWN = 150

const scraped = (g: TgGame) => g.external_source === 'screenscraper'
function matches(g: TgGame, f: PickFilter): boolean {
  if (f === 'todo') return !scraped(g)
  if (f === 'no_cover') return !g.primary_cover_url && !(g.platforms ?? []).some(p => p.cover_url)
  if (f === 'no_desc') return !g.description?.trim()
  return true
}

/** The game being scraped, and the way to pick another. */
export function TgScrapeTarget({ games, target, loading, onPick }: {
  games: TgGame[]
  target: TgGame | null
  loading: boolean
  onPick: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const p = primaryVariant(target)
  const file = romFileName(p?.esde_path)

  return (
    <>
      {target ? (
        <div className="tg-panel flex items-center gap-3.5 p-3">
          <div className="relative h-[84px] w-[60px] shrink-0">
            <TgCover game={target} mode="natural" align="center" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="tg-section-label">Scraping</p>
            <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">{target.title}</p>
            <p className="mt-0.5 truncate text-[12px] tg-muted">
              {platformInfo(target.platformKey).name}{file ? ` · ${file}` : ''}
            </p>
            {scraped(target) && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--tg-green)]">
                <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden /> Matched before (ScreenScraper #{target.external_ref})
              </p>
            )}
          </div>
          <button type="button" onClick={() => setOpen(true)} className="tg-btn tg-btn-secondary !min-h-[40px] shrink-0 !px-3 !text-[13px]">
            Change
          </button>
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
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return games
      .filter(g => matches(g, filter))
      .filter(g => !needle || g.title.toLowerCase().includes(needle) || platformInfo(g.platformKey).name.toLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [games, filter, q])

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
              className={`tg-tab !h-[34px] shrink-0 !px-3 !text-[12.5px] ${filter === f.key ? 'is-active' : 'bg-[var(--tg-panel-2)]'}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="py-10 text-center text-[13px] tg-muted">No games match.</p>
      ) : (
        <ul className="flex flex-col">
          {list.slice(0, SHOWN).map(g => (
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
                    {scraped(g) ? ' · matched' : ''}
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
