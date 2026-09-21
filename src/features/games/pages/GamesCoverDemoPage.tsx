import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Search, Plus, Gamepad2, Star, Clock3, CalendarDays, Pencil, ListPlus, ListX,
  Heart, CheckCircle2, PackageOpen, PlayCircle, Moon, Sun, SlidersHorizontal,
  ChevronDown, X, Sparkles,
} from 'lucide-react'
import {
  useAllGames, useSetPlayStatus, useUpdateGame, useAddToQueue, useRemoveFromQueue,
} from '../hooks/useGames'
import { AddGameModal } from '../components/AddGameModal'
import { GameDetailModal } from '../components/GameDetailModal'
import { STATUS_LABEL, STATUSES } from '../gamesMeta'
import { systemMeta } from '../systemMeta'
import { formatPlaytime, playStatsOf, sortByRecentlyPlayed } from '../gameStats'
import { useThemeStore } from '../../../app/store'
import type { Game, PlayStatus } from '../types'

type StatusFilter = 'all' | PlayStatus
type SortKey = 'recent' | 'title' | 'rating' | 'playtime'

const PAGE_SIZE = 12
const SYSTEM_ORDER = ['ps2', 'gc', 'switch', 'psp', 'psx', 'n64', 'gba', 'n3ds', 'wii', 'wiiu', 'dreamcast', 'saturn', 'genesis', 'snes', 'nes', 'xbox360']

const STATUS_DOT: Record<string, string> = {
  playing: 'bg-emerald-500',
  completed: 'bg-blue-500',
  backlog: 'bg-ink-400',
  wishlist: 'bg-violet-500',
  dropped: 'bg-red-500',
}

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
  return [...new Set([
    game.screenshot_url,
    game.fanart_url,
    ...game.platforms.flatMap(p => Object.values(p.esde_assets ?? {}).map(a => a.url)),
  ].filter((x): x is string => Boolean(x)))].slice(0, 3)
}

const CoverCard = memo(function CoverCard({
  game,
  selected,
  onOpen,
}: {
  game: Game
  selected: boolean
  onOpen: () => void
}) {
  const stats = playStatsOf(game)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      aria-label={`Open ${game.title}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '250px 390px' }}
    >
      <div className={[
        'relative mx-auto aspect-[2/3] w-full max-w-[210px] rounded-[10px] p-[3px]',
        'bg-gradient-to-r from-black/80 via-slate-700 to-black/90',
        'shadow-[0_14px_28px_-18px_rgba(0,0,0,.8)] ring-1 transition-all duration-300 ease-out',
        'motion-reduce:transition-none group-hover:-translate-y-1.5 group-hover:scale-[1.018]',
        'group-hover:shadow-[0_22px_42px_-18px_rgba(37,99,235,.42)]',
        selected ? 'ring-2 ring-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,.12),0_20px_40px_-18px_rgba(37,99,235,.6)] -translate-y-1' : 'ring-black/25 dark:ring-white/10',
      ].join(' ')}>
        <div className="absolute left-[3px] top-[5px] bottom-[5px] w-[5px] rounded-l-md bg-gradient-to-r from-black via-slate-700 to-slate-900 z-20" />
        <div className="relative w-full h-full overflow-hidden rounded-[7px] bg-ink-100">
          {game.primary_cover_url ? (
            <img
              src={game.primary_cover_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 motion-reduce:transition-none group-hover:scale-[1.025]"
            />
          ) : (
            <div className="w-full h-full grid place-items-center bg-gradient-to-br from-ink-100 to-ink-200">
              <Gamepad2 size={34} className="text-ink-300" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/65 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          {game.is_iconic && (
            <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/65 backdrop-blur text-amber-300 grid place-items-center shadow-lg">
              <Star size={14} fill="currentColor" />
            </span>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-[210px] pt-2.5 px-0.5">
        <p className="text-[13px] font-semibold text-ink-900 leading-tight truncate">{game.title}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1.5 min-w-0 text-ink-500">
            <span className={`w-1.5 h-1.5 rounded-full flex-none ${STATUS_DOT[game.play_status] ?? 'bg-ink-400'}`} />
            <span className="truncate">{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
          </span>
          <span className="text-amber-500 font-semibold flex-none">
            {game.rating != null ? `★ ${Number(game.rating).toFixed(1)}` : formatPlaytime(stats.seconds) ?? ''}
          </span>
        </div>
      </div>
    </button>
  )
})

function DetailPanel({
  game,
  onClose,
  onFullEdit,
}: {
  game: Game
  onClose: () => void
  onFullEdit: () => void
}) {
  const setStatus = useSetPlayStatus()
  const update = useUpdateGame()
  const addQueue = useAddToQueue()
  const removeQueue = useRemoveFromQueue()
  const [notes, setNotes] = useState(game.play_notes ?? '')

  useEffect(() => setNotes(game.play_notes ?? ''), [game.id, game.play_notes])

  const stats = playStatsOf(game)
  const media = useMemo(() => mediaFor(game), [game])
  const system = primarySystem(game)
  const hero = game.fanart_url ?? game.screenshot_url

  return (
    <aside className={[
      'fixed sm:static inset-x-0 bottom-0 top-[calc(3rem+env(safe-area-inset-top))] sm:inset-auto z-50',
      'sm:h-[calc(100dvh-7.5rem)] sm:sticky sm:top-4 overflow-y-auto overscroll-contain',
      'bg-cream-50 sm:bg-cream-50/95 border-t sm:border border-ink-200 sm:rounded-[22px]',
      'shadow-[0_-18px_50px_-24px_rgba(0,0,0,.55)] sm:shadow-[0_18px_50px_-30px_rgba(0,0,0,.5)]',
      'animate-[pageIn_180ms_ease-out] motion-reduce:animate-none',
    ].join(' ')}>
      <div className="relative">
        <div className="relative h-44 sm:h-52 overflow-hidden sm:rounded-t-[21px] bg-ink-100">
          {hero ? (
            <img src={hero} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          ) : game.primary_cover_url ? (
            <img src={game.primary_cover_url} alt="" className="w-full h-full object-cover scale-110 blur-xl opacity-50" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-cream-50 via-cream-50/25 to-black/10" />
        </div>
        <button onClick={onClose} className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/55 text-white grid place-items-center backdrop-blur-md sm:hidden" aria-label="Close">
          <X size={18} />
        </button>
        <div className="-mt-16 relative px-4 sm:px-5 flex gap-4 items-end">
          <div className="w-[92px] sm:w-[104px] aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-black/20 shadow-xl bg-ink-100 flex-none">
            {game.primary_cover_url ? <img src={game.primary_cover_url} alt="" className="w-full h-full object-cover" /> : <div className="h-full grid place-items-center"><Gamepad2 /></div>}
          </div>
          <div className="min-w-0 pb-1">
            <h2 className="text-xl sm:text-2xl font-bold text-ink-900 leading-tight line-clamp-2">{game.title}</h2>
            <p className="mt-1 text-xs text-ink-500">{[systemLabel(system), game.release_year, game.genres?.[0]].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 pt-4">
        <div className="flex items-center gap-1 mb-4">
          {[1,2,3,4,5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => update.mutate({ id: game.id, patch: { rating: n } })}
              className="p-0.5 text-amber-400 hover:scale-110 transition-transform"
              aria-label={`Rate ${n} out of 5`}
            >
              <Star size={18} fill={(game.rating ?? 0) >= n ? 'currentColor' : 'none'} />
            </button>
          ))}
          <span className="ml-2 text-xs text-ink-500">{game.rating != null ? `${Number(game.rating).toFixed(1)}/5` : 'Not rated'}</span>
        </div>

        <label className="block">
          <span className="sr-only">Status</span>
          <select
            value={game.play_status}
            onChange={e => setStatus.mutate({ id: game.id, status: e.target.value as PlayStatus })}
            disabled={setStatus.isPending}
            className="w-full min-h-[44px] rounded-xl border border-ink-200 bg-ink-100/70 px-3 text-sm font-semibold text-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-400"
          >
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-ink-100/65 p-3">
            <Clock3 size={15} className="text-ink-400 mb-1.5" />
            <p className="text-ink-400">Playtime</p>
            <p className="mt-0.5 font-semibold text-ink-800">{formatPlaytime(stats.seconds) ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-ink-100/65 p-3">
            <CalendarDays size={15} className="text-ink-400 mb-1.5" />
            <p className="text-ink-400">Last played</p>
            <p className="mt-0.5 font-semibold text-ink-800">{fmtDate(stats.last)}</p>
          </div>
        </div>

        {(game.developer || game.publisher) && (
          <div className="mt-4 text-xs grid gap-2">
            {game.developer && <div className="flex justify-between gap-4"><span className="text-ink-400">Developer</span><span className="text-ink-700 text-right">{game.developer}</span></div>}
            {game.publisher && <div className="flex justify-between gap-4"><span className="text-ink-400">Publisher</span><span className="text-ink-700 text-right">{game.publisher}</span></div>}
          </div>
        )}

        {(game.description || game.storyline) && (
          <p className="mt-4 text-xs sm:text-[13px] leading-5 text-ink-600 line-clamp-4">{game.description || game.storyline}</p>
        )}

        {media.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {media.map(url => <img key={url} src={url} alt="" loading="lazy" decoding="async" className="aspect-video w-full object-cover rounded-lg bg-ink-100" />)}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onFullEdit} className="flex-1 min-h-[44px] rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors">
            <Pencil size={16} /> Edit
          </button>
          {game.play_order == null ? (
            <button onClick={() => addQueue.mutate(game.id)} disabled={addQueue.isPending} className="min-w-[48px] min-h-[44px] rounded-xl border border-ink-200 bg-cream-50 text-ink-700 grid place-items-center disabled:opacity-50" aria-label="Add to queue">
              <ListPlus size={18} />
            </button>
          ) : (
            <button onClick={() => removeQueue.mutate(game.id)} disabled={removeQueue.isPending} className="min-w-[48px] min-h-[44px] rounded-xl border border-ink-200 bg-cream-50 text-ink-700 grid place-items-center disabled:opacity-50" aria-label="Remove from queue">
              <ListX size={18} />
            </button>
          )}
          <button
            onClick={() => update.mutate({ id: game.id, patch: { is_iconic: !game.is_iconic } })}
            className={`min-w-[48px] min-h-[44px] rounded-xl border grid place-items-center ${game.is_iconic ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-cream-50 text-ink-500 border-ink-200'}`}
            aria-label="Toggle iconic"
          >
            <Star size={18} fill={game.is_iconic ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="mt-5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Personal notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-sm text-ink-800 resize-y focus:outline-none focus:ring-2 focus:ring-accent-400"
            placeholder="Notes about this game…"
          />
          <button onClick={() => update.mutate({ id: game.id, patch: { play_notes: notes.trim() || null } })} disabled={update.isPending} className="mt-2 min-h-[40px] px-4 rounded-xl bg-ink-900 text-cream-50 text-xs font-semibold disabled:opacity-50">
            Save notes
          </button>
        </div>
      </div>
    </aside>
  )
}

export function GamesCoverDemoPage() {
  const { data: games = [], isLoading, error } = useAllGames()
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [systemFilter, setSystemFilter] = useState('auto')
  const [sort, setSort] = useState<SortKey>('recent')
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
    return [...counts.entries()].sort(([a],[b]) => {
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
      if (status !== 'all' && game.play_status !== status) return false
      if (!q) return true
      return [game.title, game.series_name, game.developer, game.publisher, ...(game.genres ?? [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })
    if (sort === 'recent') rows = sortByRecentlyPlayed(rows)
    else if (sort === 'title') rows = [...rows].sort((a,b) => a.title.localeCompare(b.title))
    else if (sort === 'rating') rows = [...rows].sort((a,b) => (b.rating ?? -1) - (a.rating ?? -1))
    else rows = [...rows].sort((a,b) => (playStatsOf(b).seconds ?? 0) - (playStatsOf(a).seconds ?? 0))
    return rows
  }, [games, deferredQuery, effectiveSystem, status, sort])

  useEffect(() => setVisibleCount(PAGE_SIZE), [deferredQuery, effectiveSystem, status, sort])

  const visibleGames = filtered.slice(0, visibleCount)
  const selected = selectedId ? games.find(g => g.id === selectedId) ?? null : null
  const activeLabel = effectiveSystem === 'all' ? 'All Platforms' : systemLabel(effectiveSystem)

  const statusCounts = useMemo(() => {
    const base = effectiveSystem === 'all' ? games : games.filter(g => primarySystem(g) === effectiveSystem)
    return {
      playing: base.filter(g => g.play_status === 'playing').length,
      completed: base.filter(g => g.play_status === 'completed').length,
      backlog: base.filter(g => g.play_status === 'backlog').length,
      wishlist: base.filter(g => g.play_status === 'wishlist').length,
    }
  }, [games, effectiveSystem])

  const libraryItems: { key: StatusFilter; label: string; icon: LucideIcon; count: number }[] = [
    { key: 'all', label: 'All games', icon: Gamepad2, count: games.length },
    { key: 'playing', label: 'Playing', icon: PlayCircle, count: statusCounts.playing },
    { key: 'completed', label: 'Completed', icon: CheckCircle2, count: statusCounts.completed },
    { key: 'backlog', label: 'Backlog', icon: PackageOpen, count: statusCounts.backlog },
    { key: 'wishlist', label: 'Wishlist', icon: Heart, count: statusCounts.wishlist },
  ]

  return (
    <div className="min-h-full bg-canvas text-ink-900">
      <div className="mx-auto max-w-[1680px] px-3 sm:px-5 lg:px-6 py-3 sm:py-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-2xl">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search games, series, developer…"
              className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-ink-200 bg-cream-50/90 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-11 h-11 rounded-xl border border-ink-200 bg-cream-50 grid place-items-center text-ink-600 hover:text-ink-900 transition-colors"
            aria-label="Toggle light and dark mode"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" onClick={() => setAddOpen(true)} className="hidden sm:inline-flex min-h-[44px] px-4 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold items-center gap-2 transition-colors">
            <Plus size={17} /> Add game
          </button>
        </div>

        <div className="grid lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_350px] gap-5">
          <aside className="hidden lg:block">
            <div className="sticky top-4 rounded-[20px] border border-ink-200 bg-cream-50/80 p-3">
              <p className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-ink-400">Library</p>
              {libraryItems.map(item => {
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    onClick={() => setStatus(item.key)}
                    className={`w-full min-h-[40px] px-2.5 rounded-xl flex items-center gap-2 text-xs transition-colors ${status === item.key ? 'bg-accent-500/12 text-accent-600 font-semibold' : 'text-ink-600 hover:bg-ink-100'}`}
                  >
                    <Icon size={16} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <span className="text-[10px] text-ink-400">{item.count}</span>
                  </button>
                )
              })}
              <p className="px-2 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-ink-400">Platforms</p>
              <button onClick={() => setSystemFilter('all')} className={`w-full min-h-[38px] px-2.5 rounded-xl flex items-center justify-between text-xs ${effectiveSystem === 'all' ? 'bg-accent-500/12 text-accent-600 font-semibold' : 'text-ink-600 hover:bg-ink-100'}`}>
                <span>All Platforms</span><span className="text-[10px] text-ink-400">{games.length}</span>
              </button>
              {systems.slice(0, 9).map(([key, count]) => (
                <button key={key} onClick={() => setSystemFilter(key)} className={`w-full min-h-[38px] px-2.5 rounded-xl flex items-center justify-between text-xs ${effectiveSystem === key ? 'bg-accent-500/12 text-accent-600 font-semibold' : 'text-ink-600 hover:bg-ink-100'}`}>
                  <span className="truncate">{systemLabel(key)}</span><span className="text-[10px] text-ink-400">{count}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-4 sm:mb-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-ink-900 text-cream-50 grid place-items-center shadow-sm">
                      <Gamepad2 size={20} />
                    </div>
                    <div>
                      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900">{activeLabel}</h1>
                      <p className="text-xs text-ink-400 mt-0.5">{filtered.length} game{filtered.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setAddOpen(true)} className="sm:hidden w-11 h-11 rounded-xl bg-accent-500 text-white grid place-items-center" aria-label="Add game"><Plus size={18} /></button>
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto scrollbar-none pb-1">
                <label className="relative flex-none lg:hidden">
                  <select value={effectiveSystem} onChange={e => setSystemFilter(e.target.value)} className="appearance-none min-h-[40px] pl-3 pr-8 rounded-xl border border-ink-200 bg-cream-50 text-xs font-semibold text-ink-700">
                    <option value="all">All Platforms</option>
                    {systems.map(([key,count]) => <option key={key} value={key}>{systemLabel(key)} ({count})</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                </label>
                {(['all','playing','completed','backlog','wishlist'] as StatusFilter[]).map(s => (
                  <button key={s} onClick={() => setStatus(s)} className={`flex-none min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${status === s ? 'bg-accent-500 text-white shadow-sm' : 'bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-100'}`}>
                    {s === 'all' ? 'All' : STATUS_LABEL[s]}
                  </button>
                ))}
                <div className="ml-auto flex-none relative">
                  <SlidersHorizontal size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                  <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="appearance-none min-h-[40px] pl-8 pr-8 rounded-xl border border-ink-200 bg-cream-50 text-xs font-semibold text-ink-700">
                    <option value="recent">Recent</option><option value="title">Title</option><option value="rating">Rating</option><option value="playtime">Playtime</option>
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-5 gap-y-6">
                {Array.from({length: 8}).map((_,i) => <div key={i} className="animate-pulse"><div className="aspect-[2/3] rounded-xl bg-ink-100" /><div className="h-3 bg-ink-100 rounded mt-3 w-3/4" /></div>)}
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-700">Could not load the game library.</div>
            ) : visibleGames.length === 0 ? (
              <div className="min-h-[320px] rounded-2xl border border-dashed border-ink-200 bg-cream-50/40 grid place-items-center text-center p-6">
                <div><Gamepad2 size={34} className="mx-auto text-ink-300" /><p className="mt-3 font-semibold text-ink-700">No games in this view</p><p className="mt-1 text-xs text-ink-400">Try another platform, status or search.</p></div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-5 gap-y-6 sm:gap-y-8">
                  {visibleGames.map(game => <CoverCard key={game.id} game={game} selected={selectedId === game.id} onOpen={() => setSelectedId(game.id)} />)}
                </div>
                {visibleCount < filtered.length && (
                  <div className="mt-8 flex justify-center">
                    <button onClick={() => setVisibleCount(v => v + PAGE_SIZE)} className="min-h-[44px] px-5 rounded-xl border border-ink-200 bg-cream-50 text-sm font-semibold text-ink-700 hover:bg-ink-100 transition-colors">
                      Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                    </button>
                  </div>
                )}
                <p className="mt-4 text-center text-[10px] text-ink-400">Rendering {visibleGames.length} of {filtered.length} matching games</p>
              </>
            )}
          </main>

          <div className="hidden xl:block">
            {selected ? (
              <DetailPanel game={selected} onClose={() => setSelectedId(null)} onFullEdit={() => setFullEditId(selected.id)} />
            ) : (
              <div className="h-[calc(100dvh-7.5rem)] sticky top-4 rounded-[22px] border border-dashed border-ink-200 bg-cream-50/45 grid place-items-center text-center p-6">
                <div><Sparkles size={28} className="mx-auto text-ink-300" /><p className="mt-3 text-sm font-semibold text-ink-700">Select a game</p><p className="mt-1 text-xs leading-5 text-ink-400">Details and quick actions appear here without rendering every game at once.</p></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && <div className="xl:hidden"><DetailPanel game={selected} onClose={() => setSelectedId(null)} onFullEdit={() => setFullEditId(selected.id)} /></div>}
      <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
      {fullEditId && <GameDetailModal gameId={fullEditId} onClose={() => setFullEditId(null)} />}
    </div>
  )
}
