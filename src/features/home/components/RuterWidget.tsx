import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchDepartures, fetchTrips, searchStops,
  TRANSPORT_ICON, DEFAULT_STOP, PRESET_ROUTES,
  type StopResult, type Departure, type TripPattern,
} from '../api/ruterApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { useRuterFavorites, type FavoriteRoute } from '../hooks/useRuterFavorites'
import { WidgetShell } from './WidgetShell'

type Tab = 'departures' | 'routes'

function minsUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getBrowserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('No geolocation')); return }
    navigator.geolocation.getCurrentPosition(
      p  => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      err => reject(err),
      { timeout: 5000 }
    )
  })
}

function StopSearchInline({
  placeholder = 'Search stop…',
  onSelect,
  onAddFav,
  autoFocus = false,
}: {
  placeholder?: string
  onSelect:     (s: StopResult) => void
  onAddFav?:    (s: StopResult) => void
  autoFocus?:   boolean
}) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (autoFocus) ref.current?.focus() }, [autoFocus])

  const { data: results } = useQuery({
    queryKey: ['stopSearch', q],
    queryFn:  () => searchStops(q),
    enabled:  q.length >= 2,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="relative">
      <input
        ref={ref}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
      />
      {results && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg overflow-y-auto max-h-[60vh] text-sm">
          {results.slice(0, 6).map((r: StopResult) => (
            <li key={r.id} className="flex items-center px-3 py-1 hover:bg-cream-50 min-h-[44px]">
              <button onClick={() => { onSelect(r); setQ('') }} className="flex-1 min-h-[44px] text-left text-ink-800">
                {r.name}
              </button>
              {onAddFav && (
                <button onClick={() => onAddFav(r)} className="min-w-[44px] min-h-[44px] text-xs text-accent-500 hover:text-accent-700 ml-2" title="Pin to favorites">★</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const [geoAsked, setGeoAsked] = useState(() => !!localStorage.getItem('ruter_geo_asked'))

  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const fav = useRuterFavorites(DEFAULT_STOP)

  const allRoutes: FavoriteRoute[] = [
    ...PRESET_ROUTES.map(r => ({ id: `${r.from.id}|${r.to.id}`, ...r })),
    ...fav.favRoutes.filter(r => !PRESET_ROUTES.some(p => `${p.from.id}|${p.to.id}` === r.id)),
  ]

  useEffect(() => {
    if (!ws.collapsed && !geoAsked) {
      setGeoAsked(true)
      localStorage.setItem('ruter_geo_asked', '1')
      getBrowserLocation().catch(() => { })
    }
  }, [ws.collapsed, geoAsked])

  const tabBar = (
    <div className="flex gap-1">
      {(['departures', 'routes'] as Tab[]).map(t => (
        <button key={t} onClick={() => setTab(t)}
          className={`min-h-[44px] px-2 text-[10px] rounded font-medium capitalize transition-colors duration-150 ${
            tab === t ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
          }`}
        >{t}</button>
      ))}
    </div>
  )

  return (
    <WidgetShell title="Departures" ws={ws} headerRight={tabBar}>
      {tab === 'departures' && <DeparturesTab fav={fav} ws={ws} />}
      {tab === 'routes'     && <RoutesTab allRoutes={allRoutes} ws={ws} fav={fav} />}
    </WidgetShell>
  )
}

function DeparturesTab({
  fav,
  ws,
}: {
  fav: ReturnType<typeof useRuterFavorites>
  ws:  ReturnType<typeof useWidgetState>
}) {
  const [editMode, setEditMode]     = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['departures', fav.activeStop.id],
    queryFn:         () => fetchDepartures(fav.activeStop.id),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed,
  })

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {fav.favStops.map(s => (
          <button key={s.id} onClick={() => fav.setActiveStop(s)}
            className={`min-h-[44px] text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              fav.activeStop.id === s.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >{s.name}</button>
        ))}
        <button onClick={() => setEditMode(v => !v)} className="min-h-[44px] px-2 text-xs text-ink-400 hover:text-ink-700" title="Edit stops">✎</button>
        <button onClick={() => setShowSearch(v => !v)} className="min-h-[44px] px-2 text-xs text-ink-400 hover:text-accent-600">+ Stop</button>
      </div>

      {editMode && (
        <div className="mb-3 p-2 bg-cream-50 rounded-lg border border-ink-200 space-y-1 text-xs">
          {fav.favStops.map(s => (
            <div key={s.id} className="flex justify-between items-center gap-2 min-h-[44px]">
              <span className="text-ink-700 truncate">{s.name}</span>
              <button onClick={() => fav.removeStop(s.id)} className="min-w-[44px] min-h-[44px] text-red-400 hover:text-red-600">✕</button>
            </div>
          ))}
          <button onClick={() => setEditMode(false)} className="min-h-[44px] px-2 text-ink-400 hover:text-ink-700 mt-1">Done</button>
        </div>
      )}

      {showSearch && (
        <div className="mb-3">
          <StopSearchInline
            autoFocus
            placeholder="Search stop to add…"
            onSelect={s => { fav.setActiveStop(s); fav.addStop(s); setShowSearch(false) }}
            onAddFav={s => fav.addStop(s)}
          />
        </div>
      )}

      <button onClick={() => { refetch(); ws.markSynced() }}
        className="min-h-[44px] text-[10px] text-ink-400 hover:text-accent-600 mb-2 block">↻ Refresh</button>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error     && <div className="text-ink-400 text-sm">Unavailable</div>}
      {data && (
        <div className="space-y-2.5">
          {data.departures.length === 0 && <div className="text-ink-400 text-sm">No departures</div>}
          {data.departures.map((dep: Departure, i: number) => (
            <DepartureRow key={i} dep={dep} />
          ))}
        </div>
      )}
    </div>
  )
}

function DepartureRow({ dep }: { dep: Departure }) {
  const mins  = minsUntil(dep.expected)
  const isNow = mins <= 0
  return (
    <div className="flex items-start gap-2 min-h-[44px] py-1">
      <span className="text-base w-5 text-center flex-shrink-0">{TRANSPORT_ICON[dep.transport] ?? '🚐'}</span>
      <span className="text-sm font-bold text-ink-900 w-8 flex-shrink-0">{dep.line}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-700 truncate">{dep.destination}</div>
        {(dep.platform || dep.direction) && (
          <div className="text-[10px] text-ink-400">
            {dep.platform && `Platform ${dep.platform}`}
            {dep.platform && dep.direction && ' · '}
            {dep.direction}
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <span className={`text-sm font-medium ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-700'}`}>
          {isNow ? 'Now' : `${mins} min`}
        </span>
        {!dep.realtime && <span className="text-[10px] text-ink-300 ml-0.5" title="Scheduled (not real-time)">~</span>}
      </div>
    </div>
  )
}

type AddStep = 'from' | 'to' | null

function RoutesTab({
  allRoutes,
  ws,
  fav,
}: {
  allRoutes: FavoriteRoute[]
  ws:        ReturnType<typeof useWidgetState>
  fav:       ReturnType<typeof useRuterFavorites>
}) {
  const [activeRouteId, setActiveRouteId] = useState(allRoutes[0]?.id)
  const [addStep, setAddStep]   = useState<AddStep>(null)
  const [addFrom, setAddFrom]   = useState<StopResult | null>(null)
  const [addTo,   setAddTo]     = useState<StopResult | null>(null)

  const route = allRoutes.find(r => r.id === activeRouteId) ?? allRoutes[0]

  const { data, isLoading, error } = useQuery({
    queryKey:        ['trip', route?.from.id, route?.to.id],
    queryFn:         () => fetchTrips(route.from.id, route.to.id),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && !!route,
  })

  function startAddRoute() { setAddStep('from'); setAddFrom(null); setAddTo(null) }
  function cancelAddRoute() { setAddStep(null);  setAddFrom(null); setAddTo(null) }

  function handleFromPicked(s: StopResult) {
    setAddFrom(s)
    setAddStep('to')
  }

  function handleToPicked(s: StopResult) {
    if (!addFrom) return
    setAddTo(s)
    fav.addRoute(addFrom, s, `${addFrom.name} → ${s.name}`)
    setActiveRouteId(`${addFrom.id}|${s.id}`)
    setAddStep(null)
    setAddFrom(null)
    setAddTo(null)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {allRoutes.map(r => (
          <button key={r.id} onClick={() => setActiveRouteId(r.id)}
            className={`min-h-[44px] text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              route?.id === r.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >{r.label}</button>
        ))}
        <button onClick={startAddRoute} className="min-h-[44px] px-2 text-xs text-ink-400 hover:text-accent-600">+ Route</button>
      </div>

      {fav.favRoutes.length > 0 && (
        <div className="mb-2 space-y-1 text-xs text-ink-400">
          {fav.favRoutes.map(r => (
            <div key={r.id} className="flex justify-between items-center gap-2 min-h-[44px]">
              <span className="truncate">{r.label}</span>
              <button onClick={() => fav.removeRoute(r.id)} className="min-w-[44px] min-h-[44px] text-red-400 hover:text-red-600">✕</button>
            </div>
          ))}
        </div>
      )}

      {addStep !== null && (
        <div className="mb-3 p-3 bg-cream-50 rounded-lg border border-ink-200 space-y-2 text-xs">
          <div className="flex items-center gap-2 min-h-[32px]">
            <span className="text-ink-500 w-8 flex-shrink-0">From:</span>
            <span className={`flex-1 min-w-0 truncate font-medium ${addFrom ? 'text-green-700' : 'text-ink-400'}`}>
              {addFrom?.name ?? '–'}
            </span>
            {addFrom && <span className="text-green-500">✓</span>}
          </div>

          <div className="flex items-center gap-2 min-h-[32px]">
            <span className="text-ink-500 w-8 flex-shrink-0">To:</span>
            <span className={`flex-1 min-w-0 truncate font-medium ${addTo ? 'text-green-700' : 'text-ink-400'}`}>
              {addTo?.name ?? '–'}
            </span>
            {addTo && <span className="text-green-500">✓</span>}
          </div>

          <div className="pt-1">
            <p className="text-[10px] text-ink-500 mb-1">
              {addStep === 'from' ? 'Search for departure stop:' : 'Search for destination stop:'}
            </p>
            <StopSearchInline
              autoFocus
              placeholder={addStep === 'from' ? 'From stop…' : 'To stop…'}
              onSelect={addStep === 'from' ? handleFromPicked : handleToPicked}
            />
          </div>

          <button onClick={cancelAddRoute} className="min-h-[44px] px-2 text-ink-400 hover:text-ink-700 text-[10px]">Cancel</button>
        </div>
      )}

      {route && (
        <div className="text-xs text-ink-500 mb-2 break-words">
          {route.from.name} → {route.to.name}
        </div>
      )}

      {isLoading && <div className="text-ink-400 text-sm">Loading trips…</div>}
      {error     && <div className="text-ink-400 text-sm">Unavailable</div>}
      {data && (
        <div className="space-y-3">
          {data.length === 0 && <div className="text-ink-400 text-sm">No trips found</div>}
          {(data as TripPattern[]).map((trip, i) => (
            <TripRow key={i} trip={trip} />
          ))}
        </div>
      )}
    </div>
  )
}

function TripRow({ trip }: { trip: TripPattern }) {
  const mins    = minsUntil(trip.departure)
  const isNow   = mins <= 0
  const mainLeg = trip.legs.find(l => l.mode !== 'foot')
  return (
    <div className="flex items-start gap-2 sm:gap-3 py-2 border-b border-ink-100 last:border-0 min-h-[44px]">
      <div className="flex-shrink-0 text-right min-w-[42px] sm:min-w-[48px]">
        <div className={`text-sm font-bold ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-900'}`}>
          {isNow ? 'Now' : `${mins} min`}
        </div>
        <div className="text-[10px] text-ink-400">{fmtTime(trip.departure)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {trip.legs.filter(l => l.mode !== 'foot').map((leg, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-ink-100 text-ink-700 rounded px-1.5 py-0.5 max-w-full truncate">
              {TRANSPORT_ICON[leg.mode] ?? '🚐'} {leg.line}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-ink-400 mt-0.5 break-words">
          {fmtDuration(trip.duration)}
          {mainLeg && ` · from ${mainLeg.from}`}
        </div>
      </div>
    </div>
  )
}
