import { memo, useDeferredValue, useMemo, useState } from 'react'
import {
  Search, Gamepad2, Star, Clock3, CalendarDays, Pencil, ListPlus, ListX,
  Heart, CheckCircle2, PackageOpen, PlayCircle, Moon, Sun, SlidersHorizontal,
  X, Library, MoreHorizontal, Plus, Grid2X2, List, Disc3,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  useAllGames, useSetPlayStatus, useUpdateGame, useAddToQueue, useRemoveFromQueue,
} from '../hooks/useGames'
import { AddGameModal } from '../components/AddGameModal'
import { GameDetailModal } from '../components/GameDetailModal'
import { STATUS_LABEL, STATUSES } from '../gamesMeta'
import { systemMeta } from '../systemMeta'
import { formatPlaytime, playStatsOf, sortByRecentlyPlayed } from '../gameStats'
import type { Game, PlayStatus } from '../types'
import './GamesCoverDemoPage.css'

type LibraryFilter = 'all' | 'queue' | PlayStatus
type SortKey = 'recent' | 'title' | 'rating' | 'playtime'
type DemoTheme = 'dark' | 'light'

const PAGE_SIZE = 12
const SYSTEM_ORDER = ['ps2', 'psp', 'gc', 'switch', 'wii', 'n3ds', 'xbox360', 'psx', 'n64', 'gba', 'dreamcast', 'saturn', 'genesis', 'snes', 'nes']

function primarySystem(game: Game): string {
  return (game.platforms.find(p => p.is_primary_variant)?.system ?? game.platforms[0]?.system ?? 'unknown').toLowerCase()
}

function systemLabel(key: string): string {
  return systemMeta(key).label
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function mediaFor(game: Game): string[] {
  return [...new Set([game.screenshot_url, game.fanart_url].filter((x): x is string => Boolean(x)))].slice(0, 3)
}

function chunk<T>(rows: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size))
  return result
}

const CoverCard = memo(function CoverCard({
  game, selected, onOpen,
}: {
  game: Game
  selected: boolean
  onOpen: () => void
}) {
  const stats = playStatsOf(game)
  return (
    <button type="button" className={`gcl-card ${selected ? 'selected' : ''}`} onClick={onOpen} aria-label={`Open ${game.title}`}>
      <div className="gcl-case">
        {game.primary_cover_url ? (
          <img src={game.primary_cover_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="gcl-case-empty"><Gamepad2 size={28} /></div>
        )}
      </div>
      <div className="gcl-card-title">{game.title}</div>
      <div className="gcl-card-meta">
        <span className={`gcl-dot ${game.play_status}`} />
        <span>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
        <span className="gcl-rating">{game.rating != null ? `★ ${Number(game.rating).toFixed(1)}` : formatPlaytime(stats.seconds)}</span>
      </div>
    </button>
  )
})

function DetailPanel({
  game, mobile, onClose, onFullEdit,
}: {
  game: Game
  mobile?: boolean
  onClose: () => void
  onFullEdit: () => void
}) {
  const setStatus = useSetPlayStatus()
  const update = useUpdateGame()
  const addQueue = useAddToQueue()
  const removeQueue = useRemoveFromQueue()
  const stats = playStatsOf(game)
  const media = mediaFor(game)
  const system = primarySystem(game)
  const hero = game.fanart_url ?? game.screenshot_url ?? game.primary_cover_url

  return (
    <aside className={`gcl-detail ${mobile ? 'mobile-open' : ''}`}>
      <div className="gcl-detail-inner">
        <div className="gcl-hero">
          {hero && <img src={hero} alt="" loading="lazy" decoding="async" />}
          {mobile && (
            <button type="button" className="gcl-iconbtn" onClick={onClose} aria-label="Close details"
              style={{ position: 'absolute', right: 12, top: 12, zIndex: 3, background: 'rgba(0,0,0,.55)', color: '#fff', borderColor: 'rgba(255,255,255,.18)' }}>
              <X size={17} />
            </button>
          )}
        </div>
        <div className="gcl-detail-body">
          <div className="gcl-detail-top">
            {game.primary_cover_url ? <img className="gcl-mini-cover" src={game.primary_cover_url} alt="" /> : <div className="gcl-mini-cover" />}
            <div className="gcl-detail-title">
              <h2>{game.title}</h2>
              <p>{[systemLabel(system), game.genres?.[0], game.release_year].filter(Boolean).join(' · ')}</p>
              <div className="gcl-stars">★★★★★ <span>{game.rating != null ? `${Number(game.rating).toFixed(1)}/5 (My Rating)` : 'Not rated'}</span></div>
            </div>
          </div>

          <select className="gcl-status" value={game.play_status}
            onChange={e => setStatus.mutate({ id: game.id, status: e.target.value as PlayStatus })}
            disabled={setStatus.isPending}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>

          <dl className="gcl-facts">
            <dt>Playtime</dt><dd>{formatPlaytime(stats.seconds) || '—'}</dd>
            <dt>Last Played</dt><dd>{fmtDate(stats.last)}</dd>
            {game.developer && <><dt>Developer</dt><dd>{game.developer}</dd></>}
            {game.publisher && <><dt>Publisher</dt><dd>{game.publisher}</dd></>}
          </dl>

          {(game.description || game.storyline) && <p className="gcl-desc">{game.description || game.storyline}</p>}
          {media.length > 0 && <div className="gcl-media">{media.map(url => <img key={url} src={url} alt="" loading="lazy" decoding="async" />)}</div>}

          <div className="gcl-actions">
            <button type="button" className="gcl-action primary" onClick={onFullEdit}><Pencil size={14} /> Edit</button>
            {game.play_order == null ? (
              <button type="button" className="gcl-action" onClick={() => addQueue.mutate(game.id)} disabled={addQueue.isPending}><ListPlus size={14} /> Queue</button>
            ) : (
              <button type="button" className="gcl-action" onClick={() => removeQueue.mutate(game.id)} disabled={removeQueue.isPending}><ListX size={14} /> Queue</button>
            )}
            <button type="button" className="gcl-action" onClick={() => update.mutate({ id: game.id, patch: { is_iconic: !game.is_iconic } })} aria-label="Toggle iconic">
              <Star size={14} fill={game.is_iconic ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function GamesCoverDemoPage() {
  const { data: games = [], isLoading, error } = useAllGames()
  const [theme, setTheme] = useState<DemoTheme>('dark')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [systemFilter, setSystemFilter] = useState('auto')
  const [sort, setSort] = useState<SortKey>('title')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [fullEditId, setFullEditId] = useState<string | null>(null)

  const systems = useMemo(() => {
    const counts = new Map<string, number>()
    for (const game of games) {
      const key = primarySystem(game)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => {
      const ai = SYSTEM_ORDER.indexOf(a), bi = SYSTEM_ORDER.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return systemLabel(a).localeCompare(systemLabel(b))
    })
  }, [games])

  const effectiveSystem = systemFilter === 'auto'
    ? (systems.find(([key]) => key === 'ps2')?.[0] ?? systems[0]?.[0] ?? 'all')
    : systemFilter

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    let rows = games.filter(game => {
      if (effectiveSystem !== 'all' && primarySystem(game) !== effectiveSystem) return false
      if (filter === 'queue' && game.play_order == null) return false
      if (filter !== 'all' && filter !== 'queue' && game.play_status !== filter) return false
      if (!q) return true
      return [game.title, game.series_name, game.developer, game.publisher, ...(game.genres ?? [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })
    if (sort === 'recent') rows = sortByRecentlyPlayed(rows)
    else if (sort === 'title') rows = [...rows].sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'rating') rows = [...rows].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    else rows = [...rows].sort((a, b) => playStatsOf(b).seconds - playStatsOf(a).seconds)
    return rows
  }, [games, deferredQuery, effectiveSystem, filter, sort])

  const visibleGames = filtered.slice(0, visibleCount)
  const rows = chunk(visibleGames, 4)
  const selected = selectedId ? games.find(g => g.id === selectedId) ?? null : null
  const desktopSelected = selected ?? visibleGames[0] ?? null
  const activeLabel = effectiveSystem === 'all' ? 'All Platforms' : systemLabel(effectiveSystem)

  const countStatus = (status: PlayStatus) => games.filter(g => g.play_status === status).length
  const navItems: { key: LibraryFilter; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'all', label: 'Library', icon: Library },
    { key: 'queue', label: 'Play Queue', icon: PlayCircle, count: games.filter(g => g.play_order != null).length },
    { key: 'wishlist', label: 'Wishlist', icon: Heart, count: countStatus('wishlist') },
    { key: 'completed', label: 'Completed', icon: CheckCircle2, count: countStatus('completed') },
    { key: 'backlog', label: 'Backlog', icon: PackageOpen, count: countStatus('backlog') },
  ]

  function chooseFilter(next: LibraryFilter) {
    setFilter(next)
    setVisibleCount(PAGE_SIZE)
    setSelectedId(null)
  }

  function chooseSystem(next: string) {
    setSystemFilter(next)
    setVisibleCount(PAGE_SIZE)
    setSelectedId(null)
  }

  return (
    <div className={`gcl-demo ${theme === 'dark' ? 'gcl-dark' : 'gcl-light'}`}>
      <div className="gcl-shell">
        <aside className="gcl-side">
          <div className="gcl-brand"><span className="gcl-brandmark"><Gamepad2 size={17} /></span> Game Library</div>
          {navItems.map(item => {
            const Icon = item.icon
            return <button type="button" key={item.key} className={`gcl-navbtn ${filter === item.key ? 'active' : ''}`} onClick={() => chooseFilter(item.key)}>
              <Icon size={14} /><span>{item.label}</span>{item.count != null && item.count > 0 && <span className="count">{item.count}</span>}
            </button>
          })}
          <div className="gcl-nav-title">Platforms</div>
          {systems.slice(0, 9).map(([key, count]) => (
            <button type="button" key={key} className={`gcl-navbtn ${effectiveSystem === key ? 'active' : ''}`} onClick={() => chooseSystem(key)}>
              <Disc3 size={14} /><span>{systemLabel(key)}</span><span className="count">{count}</span>
            </button>
          ))}
        </aside>

        <main className="gcl-main">
          <div className="gcl-mobile-top">
            <span className="gcl-brandmark"><Gamepad2 size={15} /></span><strong>Game Library</strong><span className="spacer" />
            <button type="button" className="gcl-iconbtn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle demo theme">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button" className="gcl-iconbtn" onClick={() => setAddOpen(true)} aria-label="Add game"><Plus size={16} /></button>
          </div>

          <div className="gcl-toolbar">
            <div className="gcl-search"><Search size={14} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search games, consoles, or tags..." /></div>
            <select className="gcl-filter" value={filter} onChange={e => chooseFilter(e.target.value as LibraryFilter)}>
              <option value="all">All Status</option><option value="playing">Playing</option><option value="completed">Completed</option><option value="backlog">Backlog</option><option value="wishlist">Wishlist</option><option value="queue">Play Queue</option>
            </select>
            <select className="gcl-filter" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
              <option value="title">Sort: Title</option><option value="recent">Sort: Recent</option><option value="rating">Sort: Rating</option><option value="playtime">Sort: Playtime</option>
            </select>
            <button type="button" className="gcl-iconbtn active" aria-label="Grid view"><Grid2X2 size={15} /></button>
            <button type="button" className="gcl-iconbtn" aria-label="List view"><List size={15} /></button>
            <button type="button" className="gcl-iconbtn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle demo theme">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
            <button type="button" className="gcl-iconbtn" onClick={() => setAddOpen(true)} aria-label="Add game"><Plus size={15} /></button>
          </div>

          <section className="gcl-library-head">
            <div className="gcl-system">
              <div className="gcl-system-logo">{effectiveSystem === 'ps2' ? 'PS2' : activeLabel}</div>
              <div><h1>{activeLabel}</h1><p>{filtered.length} games</p></div>
            </div>
            <div className="gcl-mobile-controls">
              <select className="gcl-filter" value={effectiveSystem} onChange={e => chooseSystem(e.target.value)}>
                <option value="all">All</option>{systems.map(([key]) => <option key={key} value={key}>{systemLabel(key)}</option>)}
              </select>
              <SlidersHorizontal size={15} style={{ color: 'var(--g-muted)' }} />
            </div>
            <div className="gcl-tabs">
              {(['all', 'playing', 'completed', 'backlog'] as LibraryFilter[]).map(key => (
                <button type="button" key={key} className={`gcl-tab ${filter === key ? 'active' : ''}`} onClick={() => chooseFilter(key)}>
                  {key === 'all' ? 'All' : STATUS_LABEL[key as PlayStatus]}
                </button>
              ))}
            </div>
          </section>

          <section className="gcl-shelves">
            {isLoading ? (
              <div className="gcl-empty-detail">Loading library…</div>
            ) : error ? (
              <div className="gcl-empty-detail">Could not load the game library.</div>
            ) : visibleGames.length === 0 ? (
              <div className="gcl-empty-detail">No games match this view.</div>
            ) : (
              <>
                {rows.map((row, rowIndex) => (
                  <div className="gcl-shelf-row" key={rowIndex}>
                    <div className="gcl-covers">
                      {row.map(game => <CoverCard key={game.id} game={game} selected={selectedId === game.id} onOpen={() => setSelectedId(game.id)} />)}
                    </div>
                  </div>
                ))}
                {visibleCount < filtered.length && <button type="button" className="gcl-more" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>Show more</button>}
              </>
            )}
          </section>
        </main>

        {desktopSelected ? (
          <DetailPanel game={desktopSelected} onClose={() => setSelectedId(null)} onFullEdit={() => setFullEditId(desktopSelected.id)} />
        ) : (
          <aside className="gcl-detail"><div className="gcl-empty-detail"><div><Gamepad2 size={28} /><p>Select a game</p></div></div></aside>
        )}
      </div>

      {selected && <DetailPanel game={selected} mobile onClose={() => setSelectedId(null)} onFullEdit={() => setFullEditId(selected.id)} />}

      <nav className="gcl-mobile-nav">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => chooseFilter('all')}><Gamepad2 size={17} />Library</button>
        <button type="button" className={filter === 'queue' ? 'active' : ''} onClick={() => chooseFilter('queue')}><PlayCircle size={17} />Queue</button>
        <button type="button" className={filter === 'wishlist' ? 'active' : ''} onClick={() => chooseFilter('wishlist')}><Heart size={17} />Wishlist</button>
        <button type="button" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}><MoreHorizontal size={17} />Theme</button>
      </nav>

      <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
      {fullEditId && <GameDetailModal gameId={fullEditId} onClose={() => setFullEditId(null)} />}
    </div>
  )
}
