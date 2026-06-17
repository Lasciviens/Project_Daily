import { useState, useMemo, useCallback } from 'react'
import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, useAllGames, useUpdateGame } from '../../home/hooks/useGames'
import { GameDetailModal } from '../components/GameDetailModal'
import { TierEditorTab }   from '../components/TierEditorTab'
import { PlayQueueTab }    from '../components/PlayQueueTab'
import type { Game } from '../../home/api/gamesApi'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  playing: 'Playing', completed: 'Completed', wishlist: 'Wishlist',
  backlog: 'Backlog', dropped: 'Dropped',
}
const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  wishlist:  'bg-purple-100 text-purple-700',
  backlog:   'bg-ink-100 text-ink-500',
  dropped:   'bg-red-100 text-red-600',
}
const STATUS_BORDER: Record<string, string> = {
  playing:   'border-l-orange-400',
  completed: 'border-l-green-500',
  wishlist:  'border-l-purple-500',
  backlog:   'border-l-ink-300',
  dropped:   'border-l-red-400',
}
const TIER_COLOR: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900', A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',       C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',         F: 'bg-red-500 text-white',
}
const TIERS    = ['S', 'A', 'B', 'C', 'D', 'F']
const STATUSES = ['playing', 'wishlist', 'backlog', 'completed', 'dropped']

type SortKey   = 'az' | 'za' | 'year-asc' | 'year-desc' | 'rating' | 'igdb' | 'series'
type LibView   = 'grid' | 'compact' | 'poster' | 'list' | 'table' | 'series'
type RetroidTab = 'library' | 'tiers' | 'queue'
type PlatformTab = 'retroid' | 'playstation'

const LIB_VIEWS: { v: LibView; icon: string; label: string }[] = [
  { v: 'grid',    icon: '⊞', label: 'Grid'    },
  { v: 'compact', icon: '▦', label: 'Compact' },
  { v: 'poster',  icon: '▬', label: 'Poster'  },
  { v: 'list',    icon: '☰', label: 'List'    },
  { v: 'table',   icon: '⊟', label: 'Table'   },
  { v: 'series',  icon: '⛓', label: 'Series'  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CoverImg({ url, title, className = '' }: { url?: string | null; title: string; className?: string }) {
  const [err, setErr] = useState(false)
  if (url && !err) return <img src={url} alt={title} onError={() => setErr(true)} className={`w-full h-full object-cover ${className}`} />
  return <div className={`w-full h-full flex items-center justify-center bg-ink-100 text-2xl ${className}`}>🎮</div>
}

function sortGames(gs: Game[], sort: SortKey): Game[] {
  switch (sort) {
    case 'za':        return [...gs].sort((a, b) => b.title.localeCompare(a.title))
    case 'year-asc':  return [...gs].sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))
    case 'year-desc': return [...gs].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))
    case 'rating':    return [...gs].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    case 'igdb':      return [...gs].sort((a, b) => Number(b.igdb_rating ?? 0) - Number(a.igdb_rating ?? 0))
    case 'series':    return [...gs].sort((a, b) => (a.series_name ?? 'zzz').localeCompare(b.series_name ?? 'zzz') || a.title.localeCompare(b.title))
    default:          return [...gs].sort((a, b) => a.title.localeCompare(b.title))
  }
}

// ─── Card components ──────────────────────────────────────────────────────────

function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const tierClass = game.tier ? (TIER_COLOR[game.tier] ?? 'bg-ink-200 text-ink-700') : null
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-md hover:scale-[1.02] transition-all duration-150 group"
    >
      <div className="relative bg-ink-100 flex-shrink-0" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.cover_url} title={game.title} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        {tierClass && <span className={`absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${tierClass}`}>{game.tier}</span>}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {game.is_iconic && <span className="text-xs leading-none drop-shadow">⭐</span>}
          {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded">2P</span>}
        </div>
        {game.igdb_rating != null && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">{Math.round(Number(game.igdb_rating))}</span>
        )}
        {game.rating != null && (
          <span className="absolute bottom-1.5 left-1.5 bg-accent-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">★{game.rating}</span>
        )}
      </div>
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2 flex-1">{game.title}</p>
        {game.series_name && <p className="text-[10px] text-ink-400 truncate">{game.series_name}</p>}
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
            {STATUS_LABEL[game.play_status] ?? game.play_status}
          </span>
          {game.release_year && <span className="text-[10px] text-ink-400">{game.release_year}</span>}
        </div>
      </div>
    </button>
  )
}

function CompactCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const tierClass = game.tier ? (TIER_COLOR[game.tier] ?? 'bg-ink-200 text-ink-700') : null
  const dotColor  = ({ playing: 'bg-orange-400', completed: 'bg-green-500', wishlist: 'bg-purple-500', backlog: 'bg-ink-300', dropped: 'bg-red-400' } as Record<string, string>)[game.play_status] ?? 'bg-ink-300'
  return (
    <button onClick={onClick} title={game.title}
      className="relative rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 hover:scale-105 transition-all duration-150 bg-ink-100 shadow-sm group"
      style={{ aspectRatio: '3/4' }}
    >
      <CoverImg url={game.cover_url} title={game.title} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      {tierClass && <span className={`absolute top-1 left-1 text-[9px] font-bold px-1 py-0.5 rounded leading-none ${tierClass}`}>{game.tier}</span>}
      <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white/60 ${dotColor}`} />
      {game.is_iconic && <span className="absolute top-1 right-1 text-[10px] leading-none drop-shadow">⭐</span>}
    </button>
  )
}

function PosterCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const tierClass = game.tier ? (TIER_COLOR[game.tier] ?? 'bg-ink-200 text-ink-700') : null
  return (
    <button onClick={onClick}
      className="relative rounded-2xl overflow-hidden shadow-md border border-ink-200 hover:shadow-xl hover:border-accent-400 hover:scale-[1.03] transition-all duration-200 bg-ink-900 group"
      style={{ aspectRatio: '2/3' }}
    >
      <CoverImg url={game.cover_url} title={game.title} className="absolute inset-0" />
      {tierClass && <span className={`absolute top-2 left-2 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded ${tierClass}`}>{game.tier}</span>}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
        {game.is_iconic && <span className="text-xs drop-shadow">⭐</span>}
        {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded">2P</span>}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pt-10 pb-3 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
        <p className="text-white text-xs font-bold leading-snug line-clamp-2 mb-1">{game.title}</p>
        {game.series_name && <p className="text-white/60 text-[10px] mb-1.5 truncate">{game.series_name}</p>}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
          {game.igdb_rating != null && <span className="text-[10px] text-purple-300 font-bold">{Math.round(Number(game.igdb_rating))}</span>}
          {game.rating != null && <span className="text-[10px] text-accent-300 font-bold">★{game.rating}</span>}
          {game.release_year && <span className="text-[10px] text-white/50">{game.release_year}</span>}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6 group-hover:opacity-0 transition-opacity duration-150">
        <p className="text-white text-[10px] font-semibold leading-snug line-clamp-1">{game.title}</p>
      </div>
    </button>
  )
}

function GameListItem({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-ink-200 border-l-4 ${STATUS_BORDER[game.play_status] ?? 'border-l-ink-200'} hover:shadow-sm transition-all text-left`}
    >
      <div className="flex-shrink-0 w-10 bg-ink-100 rounded-lg overflow-hidden border border-ink-100" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.cover_url} title={game.title} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{game.title}</p>
        {game.series_name && <p className="text-[10px] text-ink-400 truncate mb-0.5">{game.series_name}</p>}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
          {game.tier && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>{game.tier}</span>}
          {game.release_year && <span className="text-[10px] text-ink-400">{game.release_year}</span>}
          {game.is_iconic && <span className="text-xs">⭐</span>}
          {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded">2P</span>}
        </div>
        {(game.genres?.length ?? 0) > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {game.genres!.slice(0, 3).map((g, i) => (
              <span key={i} className="text-[10px] bg-ink-50 text-ink-500 border border-ink-200 px-1.5 py-0.5 rounded-full">{g}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-right space-y-0.5">
        {game.igdb_rating != null && <p className="text-sm font-bold text-purple-600">{Math.round(Number(game.igdb_rating))}</p>}
        {game.rating != null && <p className="text-xs text-accent-600 font-semibold">★{game.rating}</p>}
        {game.platforms?.slice(0, 2).map((p, i) => <p key={i} className="text-[10px] text-ink-400">{p}</p>)}
      </div>
    </button>
  )
}

function GameTableRow({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <tr onClick={onClick} className="hover:bg-cream-50 cursor-pointer transition-colors border-b border-ink-100 last:border-0">
      <td className="py-2 pl-3 pr-2 w-8">
        <div className="w-7 rounded overflow-hidden bg-ink-100" style={{ aspectRatio: '3/4' }}>
          <CoverImg url={game.cover_url} title={game.title} />
        </div>
      </td>
      <td className="py-2 pr-3 max-w-[180px]">
        <p className="text-sm font-medium text-ink-800 truncate">{game.title}</p>
        <p className="text-[10px] text-ink-400">{game.series_name ?? game.release_year ?? '—'}</p>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
      </td>
      <td className="py-2 pr-3">
        {game.tier && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_COLOR[game.tier] ?? ''}`}>{game.tier}</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-purple-600 font-bold">{game.igdb_rating != null ? Math.round(Number(game.igdb_rating)) : '—'}</td>
      <td className="py-2 pr-3 text-xs text-accent-600 font-semibold">{game.rating != null ? `★${game.rating}` : '—'}</td>
      <td className="py-2 pr-3 max-w-[150px]"><p className="text-[10px] text-ink-400 truncate">{game.platforms?.slice(0, 2).join(', ') ?? '—'}</p></td>
      <td className="py-2 pr-3 max-w-[140px]"><p className="text-[10px] text-ink-400 truncate">{game.genres?.slice(0, 2).join(', ') ?? '—'}</p></td>
      <td className="py-2 pr-3 text-sm whitespace-nowrap">
        {game.is_iconic && '⭐'}
        {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded ml-0.5">2P</span>}
      </td>
    </tr>
  )
}

// ─── Series view ──────────────────────────────────────────────────────────────

function SeriesView({ games, onSelect }: { games: Game[]; onSelect: (id: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Game[]>()
    const standalone: Game[] = []
    for (const g of games) {
      if (g.series_name) { const a = map.get(g.series_name) ?? []; a.push(g); map.set(g.series_name, a) }
      else standalone.push(g)
    }
    const sorted = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, gs]) => ({ name, games: [...gs].sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999) || a.title.localeCompare(b.title)) }))
    if (standalone.length) sorted.push({ name: 'Standalone', games: standalone.sort((a, b) => a.title.localeCompare(b.title)) })
    return sorted
  }, [games])

  return (
    <div className="space-y-8">
      {groups.map(({ name, games: gs }) => {
        const done = gs.filter(g => g.play_status === 'completed').length
        const playing = gs.filter(g => g.play_status === 'playing').length
        const isStandalone = name === 'Standalone'
        return (
          <div key={name}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className={`text-sm font-bold ${isStandalone ? 'text-ink-400 italic' : 'text-ink-800'}`}>{isStandalone ? '— Standalone —' : name}</h2>
                  <span className="text-[10px] text-ink-400 bg-ink-100 px-2 py-0.5 rounded-full flex-shrink-0">{gs.length}</span>
                  {playing > 0 && <span className="text-[10px] font-medium bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex-shrink-0">▶ Playing</span>}
                </div>
                {!isStandalone && gs.length > 1 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden max-w-[200px]">
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${gs.length ? Math.round((done / gs.length) * 100) : 0}%` }} />
                    </div>
                    <span className="text-[10px] text-ink-400">{done}/{gs.length} done</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
              {gs.map((g, idx) => {
                const tierClass = g.tier ? (TIER_COLOR[g.tier] ?? 'bg-ink-200 text-ink-700') : null
                const dotColor  = ({ playing: 'bg-orange-400', completed: 'bg-green-500', wishlist: 'bg-purple-500', backlog: 'bg-ink-300', dropped: 'bg-red-400' } as Record<string,string>)[g.play_status] ?? 'bg-ink-300'
                return (
                  <button key={g.id} onClick={() => onSelect(g.id)} title={g.title}
                    className="relative rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 hover:scale-105 transition-all duration-150 bg-ink-100 shadow-sm group"
                    style={{ aspectRatio: '3/4' }}
                  >
                    <CoverImg url={g.cover_url} title={g.title} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    {!isStandalone && <span className="absolute top-1 left-1 text-[9px] font-bold bg-black/60 text-white px-1 py-0.5 rounded leading-none">#{idx + 1}</span>}
                    {tierClass && <span className={`absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded leading-none ${tierClass}`}>{g.tier}</span>}
                    <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white/60 ${dotColor}`} />
                    {g.is_iconic && <span className="absolute bottom-1 left-1 text-[10px] leading-none">⭐</span>}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1.5 pt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <p className="text-white text-[9px] font-semibold leading-tight line-clamp-2">{g.title}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Library tab ──────────────────────────────────────────────────────────────

function LibraryTab({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState<string | null>(null)
  const [tierFilter,     setTierFilter]     = useState<string | null>(null)
  const [genreFilter,    setGenreFilter]    = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [seriesFilter,   setSeriesFilter]   = useState<string | null>(null)
  const [coopOnly,       setCoopOnly]       = useState(false)
  const [iconicOnly,     setIconicOnly]     = useState(false)
  const [sort,           setSort]           = useState<SortKey>('az')
  const [view,           setView]           = useState<LibView>('grid')

  const { data: allGames = [], isLoading } = useAllGames()

  const genreOptions   = useMemo(() => [...new Set(allGames.flatMap(g => g.genres ?? []))].sort(),   [allGames])
  const platformOptions = useMemo(() => [...new Set(allGames.flatMap(g => g.platforms ?? []))].sort(), [allGames])
  const seriesOptions  = useMemo(() => [...new Set(allGames.map(g => g.series_name).filter(Boolean) as string[])].sort(), [allGames])

  const filtered = useMemo(() => {
    let gs = allGames
    if (search.trim()) { const q = search.trim().toLowerCase(); gs = gs.filter(g => g.title.toLowerCase().includes(q) || (g.series_name?.toLowerCase().includes(q) ?? false)) }
    if (statusFilter)   gs = gs.filter(g => g.play_status === statusFilter)
    if (tierFilter)     gs = gs.filter(g => g.tier === tierFilter)
    if (genreFilter)    gs = gs.filter(g => g.genres?.includes(genreFilter) ?? false)
    if (platformFilter) gs = gs.filter(g => g.platforms?.includes(platformFilter) ?? false)
    if (seriesFilter)   gs = gs.filter(g => g.series_name === seriesFilter)
    if (coopOnly)       gs = gs.filter(g => g.is_coop)
    if (iconicOnly)     gs = gs.filter(g => g.is_iconic)
    if (view === 'series') return gs
    return sortGames(gs, sort)
  }, [allGames, search, statusFilter, tierFilter, genreFilter, platformFilter, seriesFilter, coopOnly, iconicOnly, sort, view])

  const hasFilters = !!(search || statusFilter || tierFilter || genreFilter || platformFilter || seriesFilter || coopOnly || iconicOnly)

  const clearFilters = useCallback(() => {
    setSearch(''); setStatusFilter(null); setTierFilter(null)
    setGenreFilter(null); setPlatformFilter(null); setSeriesFilter(null)
    setCoopOnly(false); setIconicOnly(false)
  }, [])

  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search games, series…"
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">🔍</span>
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600">✕</button>}
      </div>

      {/* Status chips */}
      <div className="flex gap-1.5 flex-wrap mb-2">
        <button onClick={() => setStatusFilter(null)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${!statusFilter ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-ink-600 border-ink-200 hover:border-accent-300'}`}
        >All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${statusFilter === s ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-ink-600 border-ink-200 hover:border-accent-300'}`}
          >{STATUS_LABEL[s]}</button>
        ))}
      </div>

      {/* Dropdowns + toggles + sort + view */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <select value={tierFilter ?? ''} onChange={e => setTierFilter(e.target.value || null)}
          className={`text-xs px-2 py-1.5 rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px] ${tierFilter ? 'border-accent-400 text-accent-700 font-semibold' : 'border-ink-200 text-ink-600'}`}>
          <option value="">Tier: All</option>
          {TIERS.map(t => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <select value={genreFilter ?? ''} onChange={e => setGenreFilter(e.target.value || null)}
          className={`text-xs px-2 py-1.5 rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px] ${genreFilter ? 'border-accent-400 text-accent-700 font-semibold' : 'border-ink-200 text-ink-600'}`}>
          <option value="">Genre: All</option>
          {genreOptions.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={platformFilter ?? ''} onChange={e => setPlatformFilter(e.target.value || null)}
          className={`text-xs px-2 py-1.5 rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px] ${platformFilter ? 'border-accent-400 text-accent-700 font-semibold' : 'border-ink-200 text-ink-600'}`}>
          <option value="">Platform: All</option>
          {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {seriesOptions.length > 0 && (
          <select value={seriesFilter ?? ''} onChange={e => setSeriesFilter(e.target.value || null)}
            className={`text-xs px-2 py-1.5 rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px] ${seriesFilter ? 'border-accent-400 text-accent-700 font-semibold' : 'border-ink-200 text-ink-600'}`}>
            <option value="">Series: All</option>
            {seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button onClick={() => setCoopOnly(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${coopOnly ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'}`}
        >2P Co-op</button>
        <button onClick={() => setIconicOnly(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${iconicOnly ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'}`}
        >⭐ Iconic</button>
        <div className="flex-1" />
        {view !== 'series' && (
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
            className="text-xs px-2 py-1.5 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px]">
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
            <option value="year-asc">Year ↑</option>
            <option value="year-desc">Year ↓</option>
            <option value="rating">My Rating</option>
            <option value="igdb">IGDB Rating</option>
            <option value="series">By Series</option>
          </select>
        )}
        <div className="flex border border-ink-200 rounded-lg overflow-hidden bg-white">
          {LIB_VIEWS.map(({ v, icon, label }, i) => (
            <button key={v} onClick={() => setView(v)} title={label}
              className={`px-2.5 py-1.5 text-sm transition-colors ${view === v ? 'bg-accent-500 text-white' : 'text-ink-500 hover:bg-ink-50'} ${i > 0 ? 'border-l border-ink-200' : ''}`}
            >{icon}</button>
          ))}
        </div>
      </div>

      {/* Count + clear */}
      <div className="flex items-center gap-3 mb-3">
        <p className="text-xs text-ink-400">{filtered.length} game{filtered.length !== 1 ? 's' : ''}{hasFilters && ' (filtered)'}</p>
        {hasFilters && <button onClick={clearFilters} className="text-xs text-accent-600 hover:text-accent-800 transition-colors">Clear filters</button>}
      </div>

      {isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading games…</div>}

      {!isLoading && view === 'grid' && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filtered.map(g => <GameCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'compact' && (
        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
          {filtered.map(g => <CompactCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'poster' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map(g => <PosterCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'list' && (
        <div className="space-y-2">
          {filtered.map(g => <GameListItem key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'table' && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-ink-100 text-left">
                <th className="py-2.5 pl-3 pr-2 w-8" />
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Title</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Status</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Tier</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">IGDB</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Mine</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Platforms</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Genres</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => <GameTableRow key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && view === 'series' && (
        <SeriesView games={filtered} onSelect={onOpenDetail} />
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-ink-400 text-sm">No games match your filters</div>
      )}
    </div>
  )
}

// ─── Retroid section ──────────────────────────────────────────────────────────

function RetroidSection() {
  const [tab, setTab]         = useState<RetroidTab>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: stats }       = useGameStats()
  const { data: allGames = [] } = useAllGames()
  const { mutate: updateGame } = useUpdateGame()
  const seriesCount = useMemo(() => new Set(allGames.map(g => g.series_name).filter(Boolean)).size, [allGames])

  function pickRandom() {
    if (!allGames.length) return
    setSelectedId(allGames[Math.floor(Math.random() * allGames.length)].id)
  }

  return (
    <div>
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-5">
          {[
            { label: 'Total',    value: stats.total,     color: 'text-ink-900'    },
            { label: 'Playing',  value: stats.playing,   color: 'text-orange-600' },
            { label: 'Done',     value: stats.completed, color: 'text-green-600'  },
            { label: 'Wishlist', value: stats.wishlist,  color: 'text-purple-600' },
            { label: 'Backlog',  value: stats.backlog,   color: 'text-ink-500'    },
            { label: 'Dropped',  value: stats.dropped,   color: 'text-red-500'    },
            { label: 'Iconic',   value: stats.iconic,    color: 'text-yellow-600' },
            { label: 'Series',   value: seriesCount,     color: 'text-cyan-600'   },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-ink-200 p-2.5 text-center">
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[10px] text-ink-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 mb-5 bg-white rounded-xl border border-ink-200 p-1 shadow-sm">
        {([
          { t: 'library' as RetroidTab, label: '📚 Library' },
          { t: 'tiers'   as RetroidTab, label: '🏆 Tier Editor' },
          { t: 'queue'   as RetroidTab, label: '▶ Play Queue' },
        ]).map(({ t, label }) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t ? 'bg-accent-500 text-white shadow-sm' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'}`}
          >{label}</button>
        ))}
        <button onClick={pickRandom}
          className="ml-2 text-xs px-3 py-2 rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors min-h-[36px] flex-shrink-0"
        >🎲</button>
      </div>

      {/* Tab content */}
      {tab === 'library' && <LibraryTab onOpenDetail={setSelectedId} />}
      {tab === 'tiers'   && <TierEditorTab />}
      {tab === 'queue'   && <PlayQueueTab />}

      {selectedId && (
        <GameDetailModal gameId={selectedId} onClose={() => setSelectedId(null)} updateGame={updateGame} />
      )}
    </div>
  )
}

// ─── PlayStation placeholder ──────────────────────────────────────────────────

function PlayStationSection() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🎮</div>
      <h2 className="text-xl font-bold text-ink-900 mb-2">PlayStation</h2>
      <p className="text-sm text-ink-400 max-w-xs">Coming soon — connect your PlayStation library to track trophies, games and playtime.</p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GamesPage() {
  const [platform, setPlatform] = useState<PlatformTab>('retroid')

  if (!rp5) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-cream-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🎮</div>
          <h1 className="text-2xl font-bold text-ink-900 mb-2">Games</h1>
          <p className="text-sm text-ink-400">RP5 Supabase keys not configured</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-cream-50">
      <div className="max-w-7xl mx-auto px-4 py-5">

        {/* Top-level platform tabs */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-bold text-ink-900 mr-2">🎮 Games</h1>
          <div className="flex gap-1 bg-white rounded-xl border border-ink-200 p-1 shadow-sm">
            {([
              { t: 'retroid'     as PlatformTab, label: '📱 Retroid',      color: platform === 'retroid'     ? 'bg-accent-500 text-white' : '' },
              { t: 'playstation' as PlatformTab, label: '🎮 PlayStation',  color: platform === 'playstation' ? 'bg-accent-500 text-white' : '' },
            ]).map(({ t, label, color }) => (
              <button key={t} onClick={() => setPlatform(t)}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${color || 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'}`}
              >{label}</button>
            ))}
          </div>
        </div>

        {platform === 'retroid'     && <RetroidSection />}
        {platform === 'playstation' && <PlayStationSection />}
      </div>
    </div>
  )
}
