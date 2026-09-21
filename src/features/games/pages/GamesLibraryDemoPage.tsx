import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, Gamepad2, Play, CheckCircle2, PackageOpen, Heart, X, Clock3,
  CalendarDays, Star, ListPlus, ListX, Pencil, ChevronRight, Plus,
} from 'lucide-react'
import {
  useAllGames, useSetPlayStatus, useUpdateGame, useAddToQueue, useRemoveFromQueue,
} from '../hooks/useGames'
import { AddGameModal } from '../components/AddGameModal'
import { GameDetailModal } from '../components/GameDetailModal'
import { STATUS_LABEL, STATUSES } from '../gamesMeta'
import { systemMeta } from '../systemMeta'
import { formatPlaytime, playStatsOf, sortByRecentlyPlayed } from '../gameStats'
import type { Game, PlayStatus } from '../types'

type StatusFilter = 'all' | PlayStatus
type SortKey = 'recent' | 'title' | 'rating' | 'playtime'

const PREVIEW_COUNT = 5

const SECTION_ORDER = [
  'ps2', 'gc', 'switch', 'psp', 'psx', 'n64', 'gba', 'n3ds', 'wii', 'wiiu',
  'dreamcast', 'saturn', 'genesis', 'megadrive', 'snes', 'snesna', 'nes',
  'xbox360', 'steam', 'playstation',
]

const SECTION_LABELS: Record<string, string> = {
  ps2: 'PlayStation 2',
  gc: 'Nintendo GameCube',
  switch: 'Nintendo Switch',
  psp: 'PSP / Handheld',
  psx: 'PlayStation',
  n64: 'Nintendo 64',
  gba: 'Game Boy Advance',
  n3ds: 'Nintendo 3DS',
  wii: 'Nintendo Wii',
  wiiu: 'Nintendo Wii U',
  dreamcast: 'Dreamcast',
  saturn: 'Sega Saturn',
  genesis: 'Sega Genesis',
  megadrive: 'Mega Drive',
  snes: 'Super Nintendo',
  snesna: 'Super Nintendo',
  nes: 'Nintendo Entertainment System',
  xbox360: 'Xbox 360',
  steam: 'Steam',
  playstation: 'PlayStation Network',
}

const CASE_THEME: Record<string, { spine: string; rim: string; badge: string }> = {
  ps2: { spine: 'bg-slate-950', rim: 'ring-slate-950/70', badge: 'bg-slate-900 text-white' },
  gc: { spine: 'bg-indigo-700', rim: 'ring-indigo-700/60', badge: 'bg-indigo-700 text-white' },
  switch: { spine: 'bg-red-600', rim: 'ring-red-500/50', badge: 'bg-red-600 text-white' },
  psp: { spine: 'bg-slate-200', rim: 'ring-slate-400/70', badge: 'bg-slate-700 text-white' },
  psx: { spine: 'bg-neutral-800', rim: 'ring-neutral-700/60', badge: 'bg-neutral-800 text-white' },
}

const STATUS_DOT: Record<string, string> = {
  playing: 'bg-green-500',
  completed: 'bg-emerald-600',
  backlog: 'bg-slate-400',
  wishlist: 'bg-rose-500',
  dropped: 'bg-red-500',
}

function primarySystem(game: Game): string {
  const primary = game.platforms.find(p => p.is_primary_variant) ?? game.platforms[0]
  if (primary?.system) return primary.system.toLowerCase()
  if (game.library === 'steam') return 'steam'
  if (game.library === 'playstation') return 'playstation'
  return 'unknown'
}

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? systemMeta(key).label
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function externalScore(game: Game): string | null {
  const p = game.platforms.find(x => x.is_primary_variant) ?? game.platforms[0]
  if (p?.rating == null) return null
  // ScreenScraper/platform ratings are stored 0-100; display on a familiar 5-point scale.
  return (p.rating / 20).toFixed(1)
}

function statusLabel(status: PlayStatus): string {
  return STATUS_LABEL[status] ?? status
}

function GameCase({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const system = primarySystem(game)
  const theme = CASE_THEME[system] ?? {
    spine: 'bg-stone-700',
    rim: 'ring-stone-500/40',
    badge: 'bg-stone-700 text-white',
  }
  const playtime = formatPlaytime(playStatsOf(game).seconds)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-xl"
      aria-label={`Open details for ${game.title}`}
    >
      <div className="relative mx-auto max-w-[180px]">
        <div
          className={[
            'relative aspect-[2/3] rounded-[9px] bg-ink-100 ring-1 overflow-hidden',
            theme.rim,
            'shadow-[0_8px_20px_-12px_rgba(26,21,15,0.7)]',
            'transition-[transform,box-shadow,filter] duration-200 ease-out',
            'group-hover:-translate-y-1 group-hover:scale-[1.025]',
            'group-hover:shadow-[0_18px_34px_-12px_rgba(72,96,72,0.42)] group-hover:brightness-[1.03]',
          ].join(' ')}
        >
          <span className={`absolute inset-y-0 left-0 w-[7px] z-20 ${theme.spine}`} />
          {game.primary_cover_url ? (
            <img
              src={game.primary_cover_url}
              alt={game.title}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover pl-[7px]"
            />
          ) : (
            <div className="absolute inset-0 pl-[7px] flex items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200">
              <Gamepad2 size={34} className="text-ink-300" />
            </div>
          )}

          <div className="absolute inset-x-[7px] bottom-0 h-16 bg-gradient-to-t from-black/72 to-transparent" />
          <span className={`absolute top-2 left-3 z-30 text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-sm ${theme.badge}`}>
            {sectionLabel(system)}
          </span>
          <span className="absolute left-3 bottom-2 z-30 flex items-center gap-1 rounded-full bg-black/72 text-white text-[9px] font-semibold px-1.5 py-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[game.play_status] ?? 'bg-slate-400'}`} />
            {statusLabel(game.play_status)}
          </span>
          {game.is_iconic && (
            <span className="absolute top-2 right-2 z-30 rounded-full bg-black/65 text-amber-300 w-6 h-6 grid place-items-center text-xs">★</span>
          )}
        </div>

        <div className="pt-2 px-0.5">
          <p className="text-[12px] sm:text-[13px] font-semibold text-ink-800 leading-snug line-clamp-2 min-h-[2.35rem]">
            {game.title}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-400">
            <span className="inline-flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[game.play_status] ?? 'bg-slate-400'}`} />
              {statusLabel(game.play_status)}
            </span>
            {playtime && <span>· {playtime}</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

function ShowRestCard({ remaining, expanded, onClick }: { remaining: number; expanded: boolean; onClick: () => void }) {
  if (remaining <= 0 && !expanded) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[260px] rounded-2xl border border-dashed border-ink-200 bg-cream-50/60 hover:bg-cream-50 hover:border-accent-300 transition-colors flex flex-col items-center justify-center text-center p-4 group"
    >
      <span className="w-11 h-11 rounded-full bg-ink-100 text-ink-400 group-hover:bg-accent-50 group-hover:text-accent-600 grid place-items-center transition-colors">
        <Gamepad2 size={21} />
      </span>
      <span className="mt-3 text-sm font-semibold text-ink-700">{expanded ? 'Show less' : 'Show Rest'}</span>
      <span className="mt-1 text-xs text-ink-400">{expanded ? 'Collapse this platform' : `${remaining} more game${remaining === 1 ? '' : 's'}`}</span>
      <ChevronRight size={18} className={`mt-3 text-ink-300 transition-transform ${expanded ? 'rotate-90' : ''}`} />
    </button>
  )
}

function RatingStars({ rating }: { rating: number | null }) {
  const rounded = rating == null ? 0 : Math.round(rating)
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={rating == null ? 'Not rated' : `${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={16} className={n <= rounded ? 'fill-amber-400 text-amber-400' : 'text-ink-200'} />
      ))}
    </span>
  )
}

function DetailsDrawer({
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

  const system = primarySystem(game)
  const primary = game.platforms.find(p => p.is_primary_variant) ?? game.platforms[0]
  const stats = playStatsOf(game)
  const score = externalScore(game)

  const media = useMemo(() => {
    const urls = [
      game.screenshot_url,
      game.fanart_url,
      ...game.platforms.flatMap(p => Object.values(p.esde_assets ?? {}).map(asset => asset.url)),
    ].filter((x): x is string => Boolean(x))
    return [...new Set(urls)].slice(0, 6)
  }, [game])

  function saveNotes() {
    update.mutate({ id: game.id, patch: { play_notes: notes.trim() || null } })
  }

  return (
    <aside className="fixed top-[calc(3rem+env(safe-area-inset-top))] sm:top-14 right-0 bottom-0 z-50 w-full sm:w-[430px] lg:w-[490px] bg-cream-50 border-l border-ink-200 shadow-[-18px_0_40px_-28px_rgba(20,18,14,0.5)] overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-cream-50/95 backdrop-blur border-b border-ink-100">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-400">Game details</p>
          <p className="text-xs text-ink-500 mt-0.5">{sectionLabel(system)}</p>
        </div>
        <button type="button" onClick={onClose} className="w-10 h-10 grid place-items-center rounded-xl hover:bg-ink-100 text-ink-500" aria-label="Close details">
          <X size={20} />
        </button>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex gap-4 items-start">
          <div className="w-[118px] sm:w-[132px] flex-shrink-0">
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-ink-200 shadow-lg bg-ink-100">
              {game.primary_cover_url ? (
                <img src={game.primary_cover_url} alt={game.title} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center"><Gamepad2 className="text-ink-300" /></div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-ink-900 leading-tight">{game.title}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {[sectionLabel(system), game.release_year, game.developer].filter(Boolean).join(' · ')}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(game.genres ?? []).slice(0, 4).map(g => (
                <span key={g} className="text-[10px] px-2 py-1 rounded-full bg-ink-100 text-ink-600">{g}</span>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-ink-100 bg-canvas/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Platform score</p>
                <p className="mt-1 text-lg font-bold text-ink-800">{score ? `${score}/5` : '—'}</p>
              </div>
              <div className="rounded-xl border border-ink-100 bg-canvas/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-400">My rating</p>
                <div className="mt-1"><RatingStars rating={game.rating} /></div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-500">My status</span>
            <select
              value={game.play_status}
              onChange={e => setStatus.mutate({ id: game.id, status: e.target.value as PlayStatus })}
              disabled={setStatus.isPending}
              className="mt-1 w-full min-h-[42px] rounded-xl border border-ink-200 bg-cream-50 px-3 text-sm text-ink-800"
            >
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-500">My rating</span>
            <select
              value={game.rating ?? ''}
              onChange={e => update.mutate({ id: game.id, patch: { rating: e.target.value ? Number(e.target.value) : null } })}
              disabled={update.isPending}
              className="mt-1 w-full min-h-[42px] rounded-xl border border-ink-200 bg-cream-50 px-3 text-sm text-ink-800"
            >
              <option value="">Not rated</option>
              {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map(n => <option key={n} value={n}>{n.toFixed(1)} / 5</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-ink-100 bg-canvas/50 p-4">
          <div className="grid grid-cols-2 gap-y-4 gap-x-3 text-sm">
            <div className="flex items-start gap-2">
              <Clock3 size={17} className="text-ink-400 mt-0.5" />
              <div><p className="text-[10px] uppercase tracking-wide text-ink-400">Playtime</p><p className="font-semibold text-ink-800">{formatPlaytime(stats.seconds) || '—'}</p></div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays size={17} className="text-ink-400 mt-0.5" />
              <div><p className="text-[10px] uppercase tracking-wide text-ink-400">Last played</p><p className="font-semibold text-ink-800">{fmtDate(stats.last)}</p></div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-400">Players</p>
              <p className="font-semibold text-ink-800">{game.players ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-400">Region</p>
              <p className="font-semibold text-ink-800">{primary?.region ?? '—'}</p>
            </div>
          </div>
        </div>

        {media.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink-800">Media</h3>
              <span className="text-[10px] text-ink-400">{media.length} image{media.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {media.slice(0, 3).map((url, idx) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className={`rounded-xl overflow-hidden border border-ink-100 bg-ink-100 ${idx === 0 ? 'col-span-2 row-span-2' : ''}`}>
                  <img src={url} alt="" loading="lazy" className="w-full h-full min-h-[76px] object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {(game.description || game.storyline) && (
          <div className="mt-5">
            <h3 className="text-sm font-bold text-ink-800">About</h3>
            <p className="mt-2 text-sm leading-6 text-ink-600 line-clamp-6">{game.description || game.storyline}</p>
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-800">Personal notes</h3>
            <button
              type="button"
              onClick={() => update.mutate({ id: game.id, patch: { is_iconic: !game.is_iconic } })}
              className={`min-h-[36px] px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${game.is_iconic ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'}`}
            >
              <Star size={14} className={game.is_iconic ? 'fill-current' : ''} /> Iconic
            </button>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Notes about this game…"
            className="mt-2 w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-sm text-ink-700 resize-y focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
          <button type="button" onClick={saveNotes} disabled={update.isPending} className="mt-2 min-h-[40px] px-4 rounded-xl bg-ink-900 text-white text-xs font-semibold hover:bg-ink-800 disabled:opacity-50">
            Save notes
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {game.play_order == null ? (
            <button type="button" onClick={() => addQueue.mutate(game.id)} disabled={addQueue.isPending} className="min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              <ListPlus size={17} /> Add to Queue
            </button>
          ) : (
            <button type="button" onClick={() => removeQueue.mutate(game.id)} disabled={removeQueue.isPending} className="min-h-[44px] px-4 rounded-xl bg-ink-100 text-ink-700 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              <ListX size={17} /> Remove from Queue
            </button>
          )}
          <button type="button" onClick={onFullEdit} className="min-h-[44px] px-4 rounded-xl border border-ink-200 text-ink-700 text-sm font-semibold inline-flex items-center gap-2 hover:border-accent-300">
            <Pencil size={16} /> Full edit
          </button>
        </div>
      </div>
    </aside>
  )
}

export function GamesLibraryDemoPage() {
  const { data: games = [], isLoading, error } = useAllGames()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [systemFilter, setSystemFilter] = useState('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [fullEditId, setFullEditId] = useState<string | null>(null)

  const systems = useMemo(() => {
    const keys = [...new Set(games.map(primarySystem))]
    return keys.sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a)
      const bi = SECTION_ORDER.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return sectionLabel(a).localeCompare(sectionLabel(b))
    })
  }, [games])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = games.filter(g => {
      if (status !== 'all' && g.play_status !== status) return false
      if (systemFilter !== 'all' && primarySystem(g) !== systemFilter) return false
      if (!q) return true
      return [
        g.title, g.series_name, g.developer, g.publisher,
        ...(g.genres ?? []), ...g.platforms.map(p => p.system),
      ].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })

    if (sort === 'recent') rows = sortByRecentlyPlayed(rows)
    else if (sort === 'title') rows = [...rows].sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'rating') rows = [...rows].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    else if (sort === 'playtime') rows = [...rows].sort((a, b) => (playStatsOf(b).seconds ?? 0) - (playStatsOf(a).seconds ?? 0))
    return rows
  }, [games, query, status, systemFilter, sort])

  const grouped = useMemo(() => {
    const map = new Map<string, Game[]>()
    for (const game of filtered) {
      const key = primarySystem(game)
      const arr = map.get(key) ?? []
      arr.push(game)
      map.set(key, arr)
    }
    return systems
      .filter(k => map.has(k))
      .map(key => ({ key, games: map.get(key)! }))
  }, [filtered, systems])

  const selected = selectedId ? games.find(g => g.id === selectedId) ?? null : null
  const counts = useMemo(() => ({
    playing: games.filter(g => g.play_status === 'playing').length,
    completed: games.filter(g => g.play_status === 'completed').length,
    backlog: games.filter(g => g.play_status === 'backlog').length,
    wishlist: games.filter(g => g.play_status === 'wishlist').length,
  }), [games])

  function toggleSection(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isLoading) {
    return <div className="p-6 sm:p-8 text-sm text-ink-500">Loading game library…</div>
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Could not load the game library: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
      <div className="flex flex-col xl:flex-row xl:items-end gap-4 xl:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-11 h-11 rounded-2xl bg-emerald-900 text-white grid place-items-center shadow-sm"><Gamepad2 size={23} /></span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-ink-900">Games Library</h1>
              <p className="text-sm text-ink-400 mt-0.5">Physical-case inspired demo · live data · existing Games page untouched</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full xl:w-auto xl:min-w-[560px]">
          {[
            { key: 'playing', label: 'Currently Playing', value: counts.playing, icon: Play, cls: 'bg-emerald-50 text-emerald-700' },
            { key: 'completed', label: 'Completed', value: counts.completed, icon: CheckCircle2, cls: 'bg-cream-50 text-ink-700' },
            { key: 'backlog', label: 'Backlog', value: counts.backlog, icon: PackageOpen, cls: 'bg-cream-50 text-ink-700' },
            { key: 'wishlist', label: 'Wishlist', value: counts.wishlist, icon: Heart, cls: 'bg-cream-50 text-ink-700' },
          ].map(item => {
            const Icon = item.icon
            return (
              <button key={item.key} type="button" onClick={() => setStatus(item.key as StatusFilter)} className={`rounded-2xl border border-ink-100 p-3 text-left hover:border-accent-200 transition-colors ${item.cls}`}>
                <div className="flex items-center gap-2">
                  <Icon size={18} />
                  <span className="text-xl font-bold">{item.value}</span>
                </div>
                <p className="text-[10px] sm:text-[11px] font-medium mt-1 opacity-80">{item.label}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-ink-100 bg-cream-50 p-2.5 sm:p-3">
        <div className="flex flex-col lg:flex-row gap-2">
          <label className="relative flex-1 min-w-0">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search games, series, genres or platforms…"
              className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-ink-200 bg-canvas/50 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
          </label>
          <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)} className="min-h-[44px] rounded-xl border border-ink-200 bg-canvas/50 px-3 text-sm text-ink-700">
            <option value="all">All Platforms</option>
            {systems.map(s => <option key={s} value={s}>{sectionLabel(s)}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="min-h-[44px] rounded-xl border border-ink-200 bg-canvas/50 px-3 text-sm text-ink-700">
            <option value="recent">Recently Played</option>
            <option value="title">Title A–Z</option>
            <option value="rating">My Rating</option>
            <option value="playtime">Playtime</option>
          </select>
          <button type="button" onClick={() => setAddOpen(true)} className="min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent-600">
            <Plus size={17} /> Add game
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {([
            ['all', 'All'],
            ['playing', 'Playing'],
            ['completed', 'Completed'],
            ['backlog', 'Backlog'],
            ['wishlist', 'Wishlist'],
            ['dropped', 'Dropped'],
          ] as [StatusFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${status === value ? 'bg-emerald-900 text-white' : 'bg-canvas/60 text-ink-500 hover:bg-ink-100'}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[11px] text-ink-400 px-2"><Gamepad2 size={13} /> {filtered.length} games</span>
        </div>
      </div>

      <div className="mt-6 space-y-7">
        {grouped.map(section => {
          const isExpanded = expanded.has(section.key)
          const visible = isExpanded ? section.games : section.games.slice(0, PREVIEW_COUNT)
          const remaining = Math.max(0, section.games.length - PREVIEW_COUNT)
          return (
            <section key={section.key}>
              <div className="flex items-end justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg sm:text-xl font-bold text-ink-900">{sectionLabel(section.key)}</h2>
                    <span className="text-[10px] font-semibold bg-ink-100 text-ink-500 px-2 py-1 rounded-full">{section.games.length} games</span>
                  </div>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    {section.games.filter(g => g.play_status === 'playing').length > 0
                      ? `${section.games.filter(g => g.play_status === 'playing').length} currently playing`
                      : 'Your collection on this platform'}
                  </p>
                </div>
                {remaining > 0 && (
                  <button type="button" onClick={() => toggleSection(section.key)} className="min-h-[36px] px-3 rounded-xl text-xs font-semibold text-ink-600 hover:bg-ink-100 inline-flex items-center gap-1">
                    {isExpanded ? 'Show less' : `Show ${remaining} more`} <ChevronRight size={14} className={isExpanded ? 'rotate-90' : ''} />
                  </button>
                )}
              </div>

              <div className="relative rounded-2xl border border-ink-100 bg-gradient-to-b from-cream-50 to-canvas/40 px-3 pt-4 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5 items-start">
                  {visible.map(game => <GameCase key={game.id} game={game} onOpen={() => setSelectedId(game.id)} />)}
                  {remaining > 0 && <ShowRestCard remaining={remaining} expanded={isExpanded} onClick={() => toggleSection(section.key)} />}
                </div>
              </div>
            </section>
          )
        })}

        {grouped.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-200 py-16 px-6 text-center">
            <Gamepad2 size={32} className="mx-auto text-ink-300" />
            <p className="mt-3 text-sm font-semibold text-ink-700">No games match these filters</p>
            <button type="button" onClick={() => { setQuery(''); setStatus('all'); setSystemFilter('all') }} className="mt-3 text-xs font-semibold text-accent-600">Clear filters</button>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-ink-100 pt-4 text-xs text-ink-400">
        <span>Demo route: /games-demo</span>
        <Link to="/games" className="font-semibold text-accent-600 hover:text-accent-700">Open current Games page →</Link>
      </div>

      {selected && (
        <DetailsDrawer
          game={selected}
          onClose={() => setSelectedId(null)}
          onFullEdit={() => { setFullEditId(selected.id); setSelectedId(null) }}
        />
      )}
      <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
      {fullEditId && <GameDetailModal gameId={fullEditId} onClose={() => setFullEditId(null)} />}
    </div>
  )
}
