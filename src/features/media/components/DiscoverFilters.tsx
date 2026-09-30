import { Button, Skeleton } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useGenres } from '../hooks/useDiscover'
import { useWatchProviders } from '../hooks/useTMDB'
import { useMediaPrefs } from '../mediaPrefsStore'
import { NO_FILTERS, activeFilterCount, type DiscoverFilters, type DiscoverSort } from '../discoverModel'
import type { MediaType } from '../types'
import { POSTER_GRID } from './PosterTile'

const YEARS = [2025, 2020, 2010, 2000, 1990, 1980]
const RATINGS = [6, 7, 8]
const SORTS: { value: DiscoverSort; label: string }[] = [
  { value: 'popularity', label: 'Most popular' },
  { value: 'rating', label: 'Best rated' },
  { value: 'newest', label: 'Newest' },
]

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className={POSTER_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <Skeleton rounded="rounded-md" className="aspect-[2/3] w-full" />
          <Skeleton className="mt-1.5 h-3 w-3/4" />
        </div>
      ))}
    </div>
  )
}

export function FilterRow({ type, filters, onChange, trending }: { type: MediaType; filters: DiscoverFilters; onChange: (f: DiscoverFilters) => void; trending: boolean }) {
  const { data: genres = [] } = useGenres(type)
  const num = (v: string) => (v ? Number(v) : null)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-row border border-line bg-surface-2/50 p-2">
      <select aria-label="Genre" className="input w-auto" value={filters.genre ?? ''} onChange={e => onChange({ ...filters, genre: num(e.target.value) })}>
        <option value="">Any genre</option>
        {genres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <select aria-label="Released from" className="input w-auto" value={filters.fromYear ?? ''} onChange={e => onChange({ ...filters, fromYear: num(e.target.value) })}>
        <option value="">Any year</option>
        {YEARS.map(y => <option key={y} value={y}>{y} or later</option>)}
      </select>
      <select aria-label="TMDB score" className="input w-auto" value={filters.minRating ?? ''} onChange={e => onChange({ ...filters, minRating: num(e.target.value) })}>
        <option value="">Any score</option>
        {RATINGS.map(r => <option key={r} value={r}>TMDB {r}+</option>)}
      </select>
      {!trending && (
        <select aria-label="Sort" className="input w-auto" value={filters.sort ?? ''} onChange={e => onChange({ ...filters, sort: (e.target.value || null) as DiscoverSort | null })}>
          <option value="">Default order</option>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      <label className="flex min-h-[44px] items-center gap-2 px-1 text-meta text-fg-2 sm:min-h-[36px]">
        <input type="checkbox" checked={filters.hideLibrary} onChange={e => onChange({ ...filters, hideLibrary: e.target.checked })} />
        Hide titles in my library
      </label>
      {activeFilterCount(filters, trending ? 'today' : 'popular') > 0 && <Button size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}>Clear</Button>}
    </div>
  )
}

export function ServicesPicker({ type, onDone }: { type: MediaType; onDone?: () => void }) {
  const { services, toggleService } = useMediaPrefs()
  const providers = useWatchProviders(type, true)
  return (
    <div className="space-y-2">
      <p className="text-meta text-fg-muted">Pick the services you pay for in Norway.</p>
      {providers.isLoading ? <SkeletonGrid count={6} /> : (
        <div className="flex flex-wrap gap-2">
          {(providers.data ?? []).slice(0, 24).map(p => (
            <button key={p.provider_id} type="button" aria-pressed={services.includes(p.provider_id)} onClick={() => toggleService(p.provider_id)}
              className="press-feedback flex min-h-[44px] items-center gap-2 rounded-control border border-line px-2 aria-pressed:border-accent-500 aria-pressed:bg-accent-50">
              <img src={posterUrl(p.logo_path, 'w92')} alt="" className="h-7 w-7 rounded-md" />
              <span className="text-meta font-medium text-fg">{p.provider_name}</span>
            </button>
          ))}
        </div>
      )}
      {services.length > 0 && onDone && <Button size="sm" variant="primary" onClick={onDone}>Show titles</Button>}
    </div>
  )
}

