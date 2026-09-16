import { useState, useMemo, useCallback } from 'react'
import { useAllGames } from '../hooks/useGames'
import { GameDetailModal } from '../components/GameDetailModal'
import { AddGameModal } from '../components/AddGameModal'
import { TierEditorTab } from '../components/TierEditorTab'
import { PlayQueueTab } from '../components/PlayQueueTab'
import { NeedsReviewTab } from '../components/NeedsReviewTab'
import { ScreenScraperPanel } from '../components/ScreenScraperPanel'
import { StatsPanel } from '../components/StatsPanel'
import { PlayStationTab } from '../components/PlayStationTab'
import { SteamTab } from '../components/SteamTab'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { STATUS_LABEL, STATUS_COLOR, STATUS_BORDER, TIER_COLOR, TIERS, STATUSES } from '../gamesMeta'
import { Sheet } from '../../../shared/components/Sheet'
import { haptic } from '../../../shared/utils/haptics'
import { useGamesNeedingReview } from '../hooks/useGames'
import { FilterGroupButton, CheckboxFilterPanel } from '../components/CheckboxFilterGroup'
import { CoverImg, CoverBackdrop, TierBadge, RatingBadge, SystemChip, FlagBadges } from '../components/gameCardKit'
import { systemMeta } from '../systemMeta'
import type { Game } from '../types'

// Which filter group is expanded, if any.
type FilterKey = 'tier' | 'genre' | 'system' | 'series'

// ─── Config ───────────────────────────────────────────────────────────────────

type SortKey = 'az' | 'za' | 'year-asc' | 'year-desc' | 'rating' | 'series'
type LibView = 'grid' | 'compact' | 'poster' | 'list' | 'table' | 'series'
type MainTab = 'library' | 'tiers' | 'queue' | 'review' | 'stats'
// Platform-level split, one level above MainTab. Retro Games is the existing
// RP5-migrated library (below); PlayStation/Steam are UI-only placeholders
// for now (deliberate — no DB/backend yet, per the user's explicit request)
// — see PlayStationTab.tsx/SteamTab.tsx for why each is a separate,
// meaningfully different integration story.
type PlatformTab = 'retro' | 'playstation' | 'steam'

const LIB_VIEWS: { v: LibView; icon: string; label: string }[] = [
  { v: 'grid',    icon: '⊞', label: 'Grid'    },
  { v: 'compact', icon: '▦', label: 'Compact' },
  { v: 'poster',  icon: '▬', label: 'Poster'  },
  { v: 'list',    icon: '☰', label: 'List'    },
  { v: 'table',   icon: '⊟', label: 'Table'   },
  { v: 'series',  icon: '⛓', label: 'Series'  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortGames(gs: Game[], sort: SortKey): Game[] {
  switch (sort) {
    case 'za':        return [...gs].sort((a, b) => b.title.localeCompare(a.title))
    case 'year-asc':  return [...gs].sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))
    case 'year-desc': return [...gs].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))
    case 'rating':    return [...gs].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    case 'series':    return [...gs].sort((a, b) => (a.series_name ?? 'zzz').localeCompare(b.series_name ?? 'zzz') || a.title.localeCompare(b.title))
    default:          return [...gs].sort((a, b) => a.title.localeCompare(b.title))
  }
}

// ─── Card components ──────────────────────────────────────────────────────────

function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="relative bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-lg hover:scale-[1.02] transition-all duration-150 press-feedback group"
    >
      {/* The cover's own colours, blurred, as this card's ground. */}
      <CoverBackdrop url={game.primary_cover_url} />

      <div className="relative bg-ink-100 flex-shrink-0" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.primary_cover_url} title={game.title} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />

        <span className="absolute top-1.5 left-1.5"><TierBadge tier={game.tier} /></span>
        <span className="absolute top-1.5 right-1.5"><RatingBadge rating={game.rating} /></span>

        <div className="absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1">
          <SystemChip game={game} />
          <div className="flex items-center gap-1"><FlagBadges game={game} /></div>
        </div>
      </div>

      <div className="relative p-2 flex flex-col gap-1 flex-1 bg-cream-50/85 backdrop-blur-sm">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2 flex-1">{game.title}</p>
        {game.series_name && <p className="text-[10px] text-ink-400 truncate">{game.series_name}</p>}
        {(game.genres?.length ?? 0) > 0 && (
          <p className="text-[10px] text-ink-400 truncate">{game.genres!.slice(0, 2).join(' · ')}</p>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
            {STATUS_LABEL[game.play_status] ?? game.play_status}
          </span>
          {game.release_year && <span className="text-[10px] text-ink-400">{game.release_year}</span>}
          {game.players && <span className="text-[10px] text-ink-400">👤{game.players}</span>}
        </div>
      </div>
    </button>
  )
}

function CompactCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const dotColor  = ({ playing: 'bg-orange-400', completed: 'bg-green-500', wishlist: 'bg-purple-500', backlog: 'bg-ink-300', dropped: 'bg-red-400' } as Record<string, string>)[game.play_status] ?? 'bg-ink-300'
  return (
    <button onClick={onClick} title={game.title}
      className="relative rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 hover:scale-105 transition-all duration-150 press-feedback bg-ink-100 shadow-sm group"
      style={{ aspectRatio: '3/4' }}
    >
      <CoverImg url={game.primary_cover_url} title={game.title} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

      <span className="absolute top-1 left-1"><TierBadge tier={game.tier} size="sm" /></span>
      <span className="absolute top-1 right-1"><RatingBadge rating={game.rating} size="sm" /></span>

      <div className="absolute inset-x-1 bottom-1 flex items-end justify-between gap-1">
        <SystemChip game={game} size="sm" />
        <span className={`w-2 h-2 rounded-full border border-white/60 flex-shrink-0 mb-0.5 ${dotColor}`} title={STATUS_LABEL[game.play_status] ?? game.play_status} />
      </div>
    </button>
  )
}

function PosterCard({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="relative rounded-2xl overflow-hidden shadow-md border border-ink-200 hover:shadow-xl hover:border-accent-400 hover:scale-[1.03] transition-all duration-200 press-feedback bg-ink-950 group"
      style={{ aspectRatio: '2/3' }}
    >
      <CoverImg url={game.primary_cover_url} title={game.title} className="absolute inset-0" />

      <span className="absolute top-2 left-2 z-10"><TierBadge tier={game.tier} /></span>
      <span className="absolute top-2 right-2 z-10"><RatingBadge rating={game.rating} /></span>

      {/* Resting state: just enough to identify the game. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-8 group-hover:opacity-0 transition-opacity duration-150">
        <div className="flex items-center gap-1 mb-1"><SystemChip game={game} size="sm" /><FlagBadges game={game} size="sm" /></div>
        <p className="text-white text-[11px] font-semibold leading-snug line-clamp-1">{game.title}</p>
      </div>

      {/* Hover: the full record. */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-3 pt-10 pb-3 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
        <div className="flex items-center gap-1 mb-1.5 flex-wrap"><SystemChip game={game} size="sm" /><FlagBadges game={game} size="sm" /></div>
        <p className="text-white text-xs font-bold leading-snug line-clamp-2 mb-1">{game.title}</p>
        {game.series_name && <p className="text-white/60 text-[10px] mb-1 truncate">{game.series_name}</p>}
        {(game.genres?.length ?? 0) > 0 && (
          <p className="text-white/50 text-[10px] mb-1.5 truncate">{game.genres!.slice(0, 3).join(' · ')}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
          {game.release_year && <span className="text-[10px] text-white/50">{game.release_year}</span>}
          {game.players && <span className="text-[10px] text-white/50">👤{game.players}</span>}
        </div>
      </div>
    </button>
  )
}

function GameListItem({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 bg-cream-50 rounded-xl border border-ink-200 border-l-4 ${STATUS_BORDER[game.play_status] ?? 'border-l-ink-200'} hover:shadow-sm transition-all text-left`}
    >
      <div className="flex-shrink-0 w-10 bg-ink-100 rounded-lg overflow-hidden border border-ink-100" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.primary_cover_url} title={game.title} />
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
        {game.rating != null && <p className="text-xs text-accent-600 font-semibold">★{game.rating}</p>}
        <div className="flex justify-end"><SystemChip game={game} size="sm" /></div>
      </div>
    </button>
  )
}

function GameTableRow({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <tr onClick={onClick} className="hover:bg-cream-50 cursor-pointer transition-colors border-b border-ink-100 last:border-0">
      <td className="py-2 pl-3 pr-2 w-8">
        <div className="w-7 rounded overflow-hidden bg-ink-100" style={{ aspectRatio: '3/4' }}>
          <CoverImg url={game.primary_cover_url} title={game.title} />
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
      <td className="py-2 pr-3 text-xs text-accent-600 font-semibold">{game.rating != null ? `★${game.rating}` : '—'}</td>
      <td className="py-2 pr-3 max-w-[150px]"><p className="text-[10px] text-ink-400 truncate">{[...new Set(game.platforms.map(p => systemMeta(p.system).label))].slice(0, 2).join(', ') || '—'}</p></td>
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
                const dotColor  = ({ playing: 'bg-orange-400', completed: 'bg-green-500', wishlist: 'bg-purple-500', backlog: 'bg-ink-300', dropped: 'bg-red-400' } as Record<string,string>)[g.play_status] ?? 'bg-ink-300'
                return (
                  <button key={g.id} onClick={() => onSelect(g.id)} title={g.title}
                    className="relative rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 hover:scale-105 transition-all duration-150 bg-ink-100 shadow-sm group"
                    style={{ aspectRatio: '3/4' }}
                  >
                    <CoverImg url={g.primary_cover_url} title={g.title} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
                    {/* Same corner rule as every other cover card — tier left, rating
                        right — with the series position sharing the left corner. */}
                    <span className="absolute top-1 left-1 flex items-center gap-0.5">
                      {!isStandalone && <span className="text-[9px] font-bold bg-black/70 text-white px-1 py-0.5 rounded-md leading-none">#{idx + 1}</span>}
                      <TierBadge tier={g.tier} size="sm" />
                    </span>
                    <span className="absolute top-1 right-1"><RatingBadge rating={g.rating} size="sm" /></span>
                    <span className="absolute inset-x-1 bottom-1 flex items-end justify-between gap-1 z-10">
                      <SystemChip game={g} size="sm" />
                      <span className="flex items-center gap-0.5">
                        {g.is_iconic && <span className="text-[10px] leading-none drop-shadow">⭐</span>}
                        <span className={`w-2 h-2 rounded-full border border-white/60 mb-0.5 ${dotColor}`} />
                      </span>
                    </span>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-6 pt-4 transition-opacity duration-150 lg:group-hover:opacity-0">
                      <p className="text-white text-[9px] font-semibold leading-tight line-clamp-1">{g.title}</p>
                    </div>
                    <div className="hidden lg:block absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-6 pt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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
  // Multi-select: each of these holds every checked value, and a group with
  // nothing checked means "don't narrow by this at all" (not "match nothing").
  const [tierFilter,     setTierFilter]     = useState<string[]>([])
  const [genreFilter,    setGenreFilter]    = useState<string[]>([])
  const [systemFilter,   setSystemFilter]   = useState<string[]>([])
  const [seriesFilter,   setSeriesFilter]   = useState<string[]>([])
  const [openFilter,     setOpenFilter]     = useState<FilterKey | null>(null)
  const [coopOnly,       setCoopOnly]       = useState(false)
  const [iconicOnly,     setIconicOnly]     = useState(false)
  const [sort,           setSort]           = useState<SortKey>('az')
  const [view,           setView]           = useState<LibView>('grid')
  const [filtersOpen,    setFiltersOpen]    = useState(false)

  const { data: allGames = [], isLoading, isError, error, refetch } = useAllGames()

  const genreOptions  = useMemo(() => [...new Set(allGames.flatMap(g => g.genres ?? []))].sort(), [allGames])
  const systemOptions = useMemo(() => [...new Set(allGames.flatMap(g => g.platforms.map(p => p.system)))].sort(), [allGames])
  const seriesOptions = useMemo(() => [...new Set(allGames.map(g => g.series_name).filter(Boolean) as string[])].sort(), [allGames])

  // One description of each group, used by both the buttons and the panel so
  // the two can never disagree about what a group contains. Counts come from
  // the unfiltered library: a facet that reads 0 tells you it is empty, not
  // that your other choices excluded it.
  const filterGroups = useMemo(() => {
    const countBy = (pick: (g: Game) => string[]) => {
      const m = new Map<string, number>()
      for (const g of allGames) for (const v of pick(g)) m.set(v, (m.get(v) ?? 0) + 1)
      return m
    }
    const tierCounts   = countBy(g => (g.tier ? [g.tier] : []))
    const genreCounts  = countBy(g => g.genres ?? [])
    const systemCounts = countBy(g => [...new Set(g.platforms.map(p => p.system))])
    const seriesCounts = countBy(g => (g.series_name ? [g.series_name] : []))
    const opts = (values: string[], counts: Map<string, number>, label?: (v: string) => string) =>
      values.map(v => ({ value: v, label: label ? label(v) : v, count: counts.get(v) ?? 0 }))

    return [
      { key: 'tier'   as const, label: 'Tier',   selected: tierFilter,   onChange: setTierFilter,   options: opts([...TIERS], tierCounts, t => `Tier ${t}`) },
      { key: 'genre'  as const, label: 'Genre',  selected: genreFilter,  onChange: setGenreFilter,  options: opts(genreOptions, genreCounts) },
      { key: 'system' as const, label: 'System', selected: systemFilter, onChange: setSystemFilter, options: opts(systemOptions, systemCounts) },
      ...(seriesOptions.length > 0
        ? [{ key: 'series' as const, label: 'Series', selected: seriesFilter, onChange: setSeriesFilter, options: opts(seriesOptions, seriesCounts) }]
        : []),
    ]
  }, [allGames, genreOptions, systemOptions, seriesOptions, tierFilter, genreFilter, systemFilter, seriesFilter])

  const openGroup = filterGroups.find(g => g.key === openFilter) ?? null

  const filtered = useMemo(() => {
    let gs = allGames
    if (search.trim()) { const q = search.trim().toLowerCase(); gs = gs.filter(g => g.title.toLowerCase().includes(q) || (g.series_name?.toLowerCase().includes(q) ?? false)) }
    if (statusFilter)   gs = gs.filter(g => g.play_status === statusFilter)
    // Within a group the checked values are alternatives (OR); across groups
    // they narrow (AND) — the ordinary faceted-filter reading of "Genesis or
    // SNES, and only tier S".
    if (tierFilter.length)   gs = gs.filter(g => !!g.tier && tierFilter.includes(g.tier))
    if (genreFilter.length)  gs = gs.filter(g => g.genres?.some(x => genreFilter.includes(x)) ?? false)
    if (systemFilter.length) gs = gs.filter(g => g.platforms.some(p => systemFilter.includes(p.system)))
    if (seriesFilter.length) gs = gs.filter(g => !!g.series_name && seriesFilter.includes(g.series_name))
    if (coopOnly)       gs = gs.filter(g => g.is_coop)
    if (iconicOnly)     gs = gs.filter(g => g.is_iconic)
    if (view === 'series') return gs
    return sortGames(gs, sort)
  }, [allGames, search, statusFilter, tierFilter, genreFilter, systemFilter, seriesFilter, coopOnly, iconicOnly, sort, view])

  const pickedCount = tierFilter.length + genreFilter.length + systemFilter.length + seriesFilter.length
  const hasFilters = !!(search || statusFilter || coopOnly || iconicOnly) || pickedCount > 0

  const clearFilters = useCallback(() => {
    setSearch(''); setStatusFilter(null); setTierFilter([])
    setGenreFilter([]); setSystemFilter([]); setSeriesFilter([])
    setCoopOnly(false); setIconicOnly(false)
  }, [])

  // Every checked box counts, so the badge reflects how much is actually
  // narrowing the list rather than how many groups are in use.
  const activeFilterCount = [search.trim(), statusFilter, coopOnly, iconicOnly].filter(Boolean).length + pickedCount

  const filterControls = (
    <>
      <div className="relative mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search games, series…"
          className="w-full min-h-[44px] pl-9 pr-12 py-2.5 text-sm rounded-xl border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">🔍</span>
        {search && (
          <button onClick={() => setSearch('')} aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-500 hover:text-ink-800">✕</button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 scrollbar-none scroll-fade-x">
        <button onClick={() => setStatusFilter(null)}
          className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[44px] flex-shrink-0 ${!statusFilter ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'}`}
        >All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[44px] flex-shrink-0 ${statusFilter === s ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'}`}
          >{STATUS_LABEL[s]}</button>
        ))}
      </div>

      {/* Desktop: one bordered toolbar, three internally-divided groups
          (Filter / Only show / Display) so it reads as ONE control cluster
          instead of a wall of same-looking buttons — the real complaint
          with the old stacked-full-width-rows layout. Mobile (the Sheet)
          keeps the original stacked-block look — nothing here is gated
          behind sm: for it since the Sheet is only ever opened at phone
          widths regardless of viewport breakpoint classes. */}
      <div className="sm:flex sm:items-stretch sm:flex-wrap sm:gap-0 sm:border sm:border-ink-200 sm:rounded-xl sm:bg-cream-50/70 sm:p-2 sm:mb-2 space-y-2 sm:space-y-0">
        <div className="flex items-center gap-2 flex-wrap sm:pr-3">
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider text-ink-400 mr-0.5">Filter</span>
          {filterGroups.map(g => (
            <FilterGroupButton
              key={g.key}
              label={g.label}
              selected={g.selected}
              open={openFilter === g.key}
              onToggle={() => setOpenFilter(openFilter === g.key ? null : g.key)}
            />
          ))}
        </div>

        <div className="hidden sm:block w-px bg-ink-200 mx-1 self-stretch" />

        <div className="flex items-center gap-2 flex-wrap sm:px-3">
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider text-ink-400 mr-0.5">Only show</span>
          <button onClick={() => setCoopOnly(v => !v)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[44px] ${coopOnly ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'}`}
          >2P Co-op</button>
          <button onClick={() => setIconicOnly(v => !v)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[44px] ${iconicOnly ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'}`}
          >⭐ Iconic</button>
        </div>

        <div className="hidden sm:block w-px bg-ink-200 mx-1 self-stretch" />

        <div className="flex items-center gap-2 flex-wrap sm:pl-3 sm:ml-auto overflow-x-auto sm:overflow-visible pb-1 sm:pb-0 scrollbar-none scroll-fade-x">
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider text-ink-400 mr-0.5">Display</span>
          {view !== 'series' && (
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="text-xs px-2 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[44px] flex-shrink-0">
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
              <option value="year-asc">Year ↑</option>
              <option value="year-desc">Year ↓</option>
              <option value="rating">My Rating</option>
              <option value="series">By Series</option>
            </select>
          )}
          <div className="flex border border-ink-200 rounded-lg overflow-hidden bg-cream-50 flex-shrink-0">
            {LIB_VIEWS.map(({ v, icon, label }, i) => (
              <button key={v} onClick={() => setView(v)} title={label}
                className={`min-w-[44px] min-h-[44px] px-2.5 py-2 text-sm transition-colors ${view === v ? 'bg-accent-500 text-white' : 'text-ink-500 hover:bg-ink-50'} ${i > 0 ? 'border-l border-ink-200' : ''}`}
              >{icon}</button>
            ))}
          </div>
        </div>
      </div>

      {/* The open group's checkboxes, across the full row UNDER the toolbar —
          not a dropdown over the grid. Only one group is open at a time, so
          the content below shifts once instead of jumping per group. */}
      {openGroup && (
        <CheckboxFilterPanel
          label={openGroup.label}
          options={openGroup.options}
          selected={openGroup.selected}
          onChange={openGroup.onChange}
        />
      )}
    </>
  )

  return (
    <div>
      <div className="sm:hidden flex items-center gap-2 mb-3">
        <button type="button" onClick={() => { haptic('light'); setFiltersOpen(true) }}
          className="press-feedback relative inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-ink-200 bg-cream-50 text-sm font-medium text-ink-700">
          <span aria-hidden>⚙</span> Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-bold leading-none">{activeFilterCount}</span>
          )}
        </button>
        <p className="text-xs text-ink-400 ml-auto">{filtered.length} game{filtered.length !== 1 ? 's' : ''}</p>
        {hasFilters && <button onClick={clearFilters} className="text-xs text-accent-600 min-h-[44px] px-1">Clear</button>}
      </div>

      <div className="hidden sm:block">
        {filterControls}
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs text-ink-400">{filtered.length} game{filtered.length !== 1 ? 's' : ''}{hasFilters && ' (filtered)'}</p>
          {hasFilters && <button onClick={clearFilters} className="text-xs text-accent-600 hover:text-accent-800 transition-colors">Clear filters</button>}
        </div>
      </div>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div className="flex items-center gap-2">
            <button type="button" onClick={clearFilters} disabled={!hasFilters}
              className="press-feedback flex-1 min-h-[44px] rounded-xl border border-ink-200 text-sm font-medium text-ink-600 disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setFiltersOpen(false)}
              className="press-feedback flex-1 min-h-[44px] rounded-xl bg-accent-500 text-white text-sm font-semibold">Show {filtered.length} game{filtered.length !== 1 ? 's' : ''}</button>
          </div>
        }
      >
        <div className="p-4">{filterControls}</div>
      </Sheet>

      {isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading games…</div>}

      {/* A failed load must never render as "your library is empty" — that told
          the user their data was gone when the real cause was a request this
          page could not make. Both states now say what actually happened. */}
      {!isLoading && isError && (
        <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 dark:bg-red-500/10 dark:border-red-500/30">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Could not load your library</p>
          <p className="text-xs text-red-600/90 dark:text-red-400/80 mt-1 break-words">
            {(error as Error | null)?.message ?? 'Unknown error'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 min-h-[44px] px-3 text-sm rounded-lg border border-red-300 bg-cream-50 text-red-700 hover:border-red-400 transition-colors dark:bg-transparent dark:text-red-400"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !isError && allGames.length === 0 && (
        <div className="text-center py-16 text-ink-400">
          <p className="text-3xl mb-3">🎮</p>
          <p className="text-sm font-medium text-ink-700">Your library is empty</p>
          <p className="text-xs mt-1">Use "＋ Add game" above to add your first one.</p>
        </div>
      )}

      {!isLoading && allGames.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3">
          {filtered.map(g => <GameCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'compact' && (
        <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 lg:grid-cols-12 2xl:grid-cols-16 gap-1.5">
          {filtered.map(g => <CompactCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'poster' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
          {filtered.map(g => <PosterCard key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'list' && (
        <div className="space-y-2">
          {filtered.map(g => <GameListItem key={g.id} game={g} onClick={() => onOpenDetail(g.id)} />)}
        </div>
      )}
      {!isLoading && view === 'table' && (
        <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-ink-100 text-left">
                <th className="py-2.5 pl-3 pr-2 w-8" />
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Title</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Status</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Tier</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Mine</th>
                <th className="py-2.5 pr-3 text-xs font-semibold text-ink-400 uppercase tracking-wide">Systems</th>
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
      {!isLoading && view === 'series' && <SeriesView games={filtered} onSelect={onOpenDetail} />}
      {!isLoading && allGames.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-ink-400 text-sm">No games match your filters</div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { t: MainTab; icon: string; label: string }[] = [
  { t: 'library', icon: '📚', label: 'Library' },
  { t: 'tiers',   icon: '🏆', label: 'Tiers'   },
  { t: 'queue',   icon: '▶',  label: 'Queue'   },
  { t: 'review',  icon: '🔎', label: 'Review'  },
  { t: 'stats',   icon: '📊', label: 'Stats'   },
]

const PLATFORM_TABS: { t: PlatformTab; icon: string; label: string }[] = [
  { t: 'retro',       icon: '🕹️', label: 'Retro Games' },
  { t: 'playstation', icon: '🎮', label: 'PlayStation'  },
  { t: 'steam',       icon: '🖥️', label: 'Steam'        },
]

export function GamesPage() {
  const [platform, setPlatform] = useState<PlatformTab>('retro')
  const [tab, setTab] = useState<MainTab>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const { data: allGames = [] } = useAllGames()
  const { data: needsReview = [] } = useGamesNeedingReview()

  function pickRandom() {
    if (!allGames.length) return
    setSelectedId(allGames[Math.floor(Math.random() * allGames.length)].id)
  }

  return (
    // Deliberate full-width exception to this app's usual "content-sized,
    // left-aligned" layout rule — explicit user request for this page. No
    // max-w cap at all, unlike the "2xl:max-w-none" opt-out pattern Training
    // uses elsewhere.
    <div className="min-h-full w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
      <div className="flex items-center gap-3 mb-4 sm:mb-6 flex-wrap">
        <h1 className="text-lg font-bold text-ink-900">🎮 Games</h1>
        {platform === 'retro' && (
          <>
            <button onClick={() => setAddOpen(true)}
              className="min-h-[44px] px-3 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors">
              ＋ Add game
            </button>
            <button onClick={pickRandom} disabled={!allGames.length}
              className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors disabled:opacity-40">
              🎲 Random
            </button>
          </>
        )}
      </div>

      {/* Platform split — one level above the Retro Games tab bar. Own row,
          own visual weight (bordered pills vs the library's filled tab bar
          below) so the two tab levels don't read as one flat row. */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto scrollbar-none">
        {PLATFORM_TABS.map(({ t, icon, label }) => (
          <button key={t} onClick={() => setPlatform(t)}
            className={`min-h-[44px] px-4 text-sm font-semibold rounded-xl border transition-colors whitespace-nowrap flex items-center gap-1.5 ${platform === t ? 'bg-ink-900 text-white border-ink-900' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'}`}
          >
            <span>{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* Both of these render reverse-engineered payloads (Sony has no
          official API at all), so a field whose real shape differs from the
          declared type would otherwise throw DURING render and blank the
          whole page. The boundary keeps the failure inside the tab. */}
      {platform === 'playstation' && (
        <ErrorBoundary label="PlayStation" action="psn_tab_render">
          <PlayStationTab />
        </ErrorBoundary>
      )}
      {platform === 'steam' && (
        <ErrorBoundary label="Steam" action="steam_tab_render">
          <SteamTab />
        </ErrorBoundary>
      )}

      {platform === 'retro' && (
        <>
          <div className="flex items-center gap-1 mb-5 bg-cream-50 rounded-xl border border-ink-200 p-1 shadow-sm overflow-x-auto scrollbar-none">
            {TABS.map(({ t, icon, label }) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 min-h-[44px] px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${tab === t ? 'bg-accent-500 text-white shadow-sm' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'}`}
              >
                <span>{icon}</span>{label}
                {t === 'review' && needsReview.length > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 rounded-full ${tab === t ? 'bg-white/30' : 'bg-orange-100 text-orange-700'}`}>{needsReview.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'library' && <LibraryTab onOpenDetail={setSelectedId} />}
          {tab === 'tiers'   && <TierEditorTab />}
          {tab === 'queue'   && <PlayQueueTab />}
          {/* The scraper sits with Review because they are the same job seen
              from two ends: Review lists what is missing, this fills it. */}
          {tab === 'review'  && (
            <div className="space-y-4">
              <ErrorBoundary label="ScreenScraper" action="screenscraper_panel">
                <ScreenScraperPanel />
              </ErrorBoundary>
              <NeedsReviewTab onOpenDetail={setSelectedId} />
            </div>
          )}
          {tab === 'stats'   && <StatsPanel />}

          {selectedId && <GameDetailModal gameId={selectedId} onClose={() => setSelectedId(null)} />}
          <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
        </>
      )}
    </div>
  )
}
