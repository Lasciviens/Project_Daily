import { useState, useMemo } from 'react'
import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, useAllGames } from '../../home/hooks/useGames'
import { GameDetailModal } from '../components/GameDetailModal'
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
const TIER_COLOR: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900', A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',       C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',         F: 'bg-red-500 text-white',
}
const TIERS = ['S', 'A', 'B', 'C', 'D', 'F']
const STATUSES = ['playing', 'wishlist', 'backlog', 'completed', 'dropped']

type SortKey  = 'az' | 'za' | 'year-asc' | 'year-desc' | 'rating' | 'igdb'
type ViewMode = 'grid' | 'list' | 'table'

// ─── Sub-components ───────────────────────────────────────────────────────────

function CoverImg({ url, title }: { url?: string | null; title: string }) {
  const [err, setErr] = useState(false)
  if (url && !err) {
    return <img src={url} alt={title} onError={() => setErr(true)} className="w-full h-full object-cover" />
  }
  return <div className="w-full h-full flex items-center justify-center text-2xl">🎮</div>
}

function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const tierClass = game.tier ? (TIER_COLOR[game.tier] ?? 'bg-ink-200 text-ink-700') : null
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-md transition-all duration-150"
    >
      <div className="relative bg-ink-100 flex-shrink-0" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.cover_url} title={game.title} />
        {tierClass && (
          <span className={`absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${tierClass}`}>{game.tier}</span>
        )}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {game.is_iconic && <span className="text-xs leading-none">⭐</span>}
          {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded">2P</span>}
        </div>
        {game.igdb_rating != null && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            {Math.round(Number(game.igdb_rating))}
          </span>
        )}
      </div>
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2 flex-1">{game.title}</p>
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

function GameListItem({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-ink-200 hover:border-accent-300 transition-colors text-left"
    >
      <div className="flex-shrink-0 w-10 bg-ink-100 rounded-lg overflow-hidden border border-ink-100" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.cover_url} title={game.title} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{game.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
            {STATUS_LABEL[game.play_status] ?? game.play_status}
          </span>
          {game.tier && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>{game.tier}</span>
          )}
          {game.release_year && <span className="text-[10px] text-ink-400">{game.release_year}</span>}
          {game.is_iconic && <span className="text-xs">⭐</span>}
          {game.is_coop   && <span className="text-[9px] font-bold bg-cyan-500 text-white px-1 rounded">2P</span>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        {game.igdb_rating != null && (
          <p className="text-sm font-bold text-purple-600">{Math.round(Number(game.igdb_rating))}</p>
        )}
        {game.rating != null && (
          <p className="text-xs text-ink-400">{game.rating}/10</p>
        )}
      </div>
    </button>
  )
}

function GameTableRow({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="hover:bg-cream-50 cursor-pointer transition-colors border-b border-ink-100 last:border-0"
    >
      <td className="py-2 pl-3 pr-2 w-8">
        <div className="w-7 rounded overflow-hidden bg-ink-100 border border-ink-100" style={{ aspectRatio: '3/4' }}>
          <CoverImg url={game.cover_url} title={game.title} />
        </div>
      </td>
      <td className="py-2 pr-3">
        <p className="text-sm font-medium text-ink-800 truncate max-w-[200px]">{game.title}</p>
        <p className="text-[10px] text-ink-400">{game.release_year ?? '—'}</p>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
          {STATUS_LABEL[game.play_status] ?? game.play_status}
        </span>
      </td>
      <td className="py-2 pr-3">
        {game.tier && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_COLOR[game.tier] ?? ''}`}>{game.tier}</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-purple-600 font-bold">
        {game.igdb_rating != null ? Math.round(Number(game.igdb_rating)) : '—'}
      </td>
      <td className="py-2 pr-3 text-xs text-ink-500">
        {game.rating ?? '—'}
      </td>
      <td className="py-2 pr-3 text-sm">
        {game.is_iconic && '⭐'}
        {game.is_coop   && ' 2P'}
      </td>
    </tr>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GamesPage() {
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [tierFilter,   setTierFilter]   = useState<string | null>(null)
  const [coopOnly,     setCoopOnly]     = useState(false)
  const [iconicOnly,   setIconicOnly]   = useState(false)
  const [sort,         setSort]         = useState<SortKey>('az')
  const [view,         setView]         = useState<ViewMode>('grid')
  const [selectedId,   setSelectedId]   = useState<string | null>(null)

  const { data: stats }            = useGameStats()
  const { data: allGames = [], isLoading } = useAllGames()

  const filtered = useMemo(() => {
    let gs = allGames

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      gs = gs.filter(g => g.title.toLowerCase().includes(q))
    }
    if (statusFilter) gs = gs.filter(g => g.play_status === statusFilter)
    if (tierFilter)   gs = gs.filter(g => g.tier === tierFilter)
    if (coopOnly)     gs = gs.filter(g => g.is_coop)
    if (iconicOnly)   gs = gs.filter(g => g.is_iconic)

    switch (sort) {
      case 'za':        return [...gs].sort((a, b) => b.title.localeCompare(a.title))
      case 'year-asc':  return [...gs].sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))
      case 'year-desc': return [...gs].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))
      case 'rating':    return [...gs].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      case 'igdb':      return [...gs].sort((a, b) => Number(b.igdb_rating ?? 0) - Number(a.igdb_rating ?? 0))
      default:          return [...gs].sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [allGames, search, statusFilter, tierFilter, coopOnly, iconicOnly, sort])

  function pickRandom() {
    if (!filtered.length) return
    setSelectedId(filtered[Math.floor(Math.random() * filtered.length)].id)
  }

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
      <div className="max-w-6xl mx-auto px-4 py-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-ink-900">🎮 Games</h1>
          <button
            onClick={pickRandom}
            className="text-xs px-3 py-2 rounded-lg border border-ink-200 bg-white text-ink-600 hover:border-accent-300 transition-colors min-h-[36px]"
          >
            🎲 Random
          </button>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-5">
            {[
              { label: 'Total',    value: stats.total,     color: 'text-ink-900'     },
              { label: 'Playing',  value: stats.playing,   color: 'text-orange-600'  },
              { label: 'Done',     value: stats.completed, color: 'text-green-600'   },
              { label: 'Wishlist', value: stats.wishlist,  color: 'text-purple-600'  },
              { label: 'Backlog',  value: stats.backlog,   color: 'text-ink-500'     },
              { label: 'Dropped',  value: stats.dropped,   color: 'text-red-500'     },
              { label: 'Iconic',   value: stats.iconic,    color: 'text-yellow-600'  },
              { label: 'Co-op',    value: stats.coop,      color: 'text-cyan-600'    },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-ink-200 p-2.5 text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-ink-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search games…"
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">🔍</span>
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600">✕</button>
          )}
        </div>

        {/* Filters row 1: Status */}
        <div className="flex gap-1.5 flex-wrap mb-2">
          <button
            onClick={() => setStatusFilter(null)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${!statusFilter ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-ink-600 border-ink-200 hover:border-accent-300'}`}
          >All</button>
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${statusFilter === s ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-ink-600 border-ink-200 hover:border-accent-300'}`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Filters row 2: Tier + toggles + sort + view */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {/* Tier chips */}
          <div className="flex gap-1">
            {TIERS.map(t => (
              <button
                key={t}
                onClick={() => setTierFilter(tierFilter === t ? null : t)}
                className={`text-xs font-bold w-8 h-8 rounded-lg border transition-colors ${
                  tierFilter === t
                    ? (TIER_COLOR[t] ?? 'bg-ink-500 text-white') + ' border-transparent'
                    : 'bg-white text-ink-500 border-ink-200 hover:border-ink-400'
                }`}
              >{t}</button>
            ))}
          </div>

          {/* Toggle filters */}
          <button
            onClick={() => setCoopOnly(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${coopOnly ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'}`}
          >2P Co-op</button>
          <button
            onClick={() => setIconicOnly(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] ${iconicOnly ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'}`}
          >⭐ Iconic</button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="text-xs px-2 py-1.5 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[36px]"
          >
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
            <option value="year-asc">Year ↑</option>
            <option value="year-desc">Year ↓</option>
            <option value="rating">My Rating</option>
            <option value="igdb">IGDB Rating</option>
          </select>

          {/* View mode */}
          <div className="flex border border-ink-200 rounded-lg overflow-hidden bg-white">
            {(['grid', 'list', 'table'] as ViewMode[]).map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1.5 text-sm transition-colors ${view === v ? 'bg-accent-500 text-white' : 'text-ink-500 hover:bg-ink-50'} ${i > 0 ? 'border-l border-ink-200' : ''}`}
                title={v}
              >
                {v === 'grid' ? '⊞' : v === 'list' ? '☰' : '⊟'}
              </button>
            ))}
          </div>
        </div>

        {/* Result count */}
        <p className="text-xs text-ink-400 mb-3">
          {filtered.length} game{filtered.length !== 1 ? 's' : ''}
          {(search || statusFilter || tierFilter || coopOnly || iconicOnly) && ' (filtered)'}
        </p>

        {isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading games…</div>}

        {/* Grid */}
        {!isLoading && view === 'grid' && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {filtered.map(g => <GameCard key={g.id} game={g} onClick={() => setSelectedId(g.id)} />)}
          </div>
        )}

        {/* List */}
        {!isLoading && view === 'list' && (
          <div className="space-y-2">
            {filtered.map(g => <GameListItem key={g.id} game={g} onClick={() => setSelectedId(g.id)} />)}
          </div>
        )}

        {/* Table */}
        {!isLoading && view === 'table' && (
          <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left">
                  <th className="py-2.5 pl-3 pr-2 w-8" />
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Title</th>
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Status</th>
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Tier</th>
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">IGDB</th>
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Mine</th>
                  <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => <GameTableRow key={g.id} game={g} onClick={() => setSelectedId(g.id)} />)}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-ink-400 text-sm">No games match your filters</div>
        )}
      </div>

      {/* Detail modal */}
      {selectedId && (
        <GameDetailModal gameId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
