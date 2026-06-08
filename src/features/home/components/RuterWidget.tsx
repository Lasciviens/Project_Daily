import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchDepartures, fetchTrips, searchStops,
  TRANSPORT_ICON,
  type StopResult, type Departure, type TripPattern,
} from '../api/ruterApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'departures' | 'routes'

// Temporary compat shim — will be removed when this widget is fully rewritten.
// The new useTransitStops hook persists to Supabase; this keeps local state only.
function useRuterFavorites(defaultStop: StopResult) {
  const [activeStop, setActiveStopState] = useState<StopResult>(() => {
    try {
      const raw = localStorage.getItem('ruter_active_stop')
      return raw ? (JSON.parse(raw) as StopResult) : defaultStop
    } catch { return defaultStop }
  })
  const [favStops, setFavStopsState] = useState<StopResult[]>(() => {
    try {
      const raw = localStorage.getItem('ruter_fav_stops')
      return raw ? (JSON.parse(raw) as StopResult[]) : [defaultStop]
    } catch { return [defaultStop] }
  })

  function setActiveStop(stop: StopResult) {
    setActiveStopState(stop)
    try { localStorage.setItem('ruter_active_stop', JSON.stringify(stop)) } catch { /* quota */ }
  }
  function addStop(stop: StopResult) {
    if (favStops.some(s => s.id === stop.id)) return
    const next = [...favStops, stop]
    setFavStopsState(next)
    try { localStorage.setItem('ruter_fav_stops', JSON.stringify(next)) } catch { /* quota */ }
  }
  function removeStop(id: string) {
    const next = favStops.filter(s => s.id !== id)
    setFavStopsState(next)
    try { localStorage.setItem('ruter_fav_stops', JSON.stringify(next)) } catch { /* quota */ }
    if (activeStop.id === id && next.length > 0) setActiveStop(next[0])
  }

  return { activeStop, setActiveStop, favStops, addStop, removeStop }
}

const DEFAULT_STOP: StopResult = { id: 'NSR:StopPlace:5492', name: 'Visperud' }

const PRESET_ROUTES: { label: string; from: StopResult; to: StopResult }[] = [
  {
    label: '🏠 Home',
    from:  { id: 'NSR:StopPlace:58221', name: 'Sinsenveien' },
    to:    { id: 'NSR:StopPlace:5492',  name: 'Visperud' },
  },
  {
    label: '💼 Work',
    from:  { id: 'NSR:StopPlace:5492',  name: 'Visperud' },
    to:    { id: 'NSR:StopPlace:58221', name: 'Sinsenveien' },
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minsUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000)
}

// Ticks every 30s so departure countdowns stay accurate without refetching
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── Geolocation helper ───────────────────────────────────────────────────────

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

// ─── Stop search input ────────────────────────────────────────────────────────

// Shows a text input + dropdown. When a stop is selected, calls onSelect and
// displays the stop name in the input (replacing the search text).
function StopInput({
  label,
  value,
  onSelect,
  placeholder,
}: {
  label:       string
  value:       StopResult | null
  onSelect:    (s: StopResult) => void
  placeholder: string
}) {
  const [q, setQ]         = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLInputElement>(null)

  // When value changes externally (e.g. preset button), clear the search text
  useEffect(() => { if (value) setQ('') }, [value])

  const { data: results } = useQuery({
    queryKey:  ['stopSearch', q],
    queryFn:   () => searchStops(q),
    enabled:   q.length >= 2,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="relative flex items-center gap-2">
      <span className="text-[10px] font-semibold text-ink-400 w-7 flex-shrink-0 uppercase">{label}</span>
      <div className="relative flex-1">
        <input
          ref={ref}
          value={value && !q ? value.name : q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => { if (value) setQ(''); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
        />
        {open && results && results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg overflow-hidden text-sm">
            {results.slice(0, 6).map((r: StopResult) => (
              <li key={r.id}>
                <button
                  onMouseDown={() => { onSelect(r); setQ(''); setOpen(false) }}
                  className="w-full text-left px-3 py-2 hover:bg-cream-50 text-ink-800"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value && (
        <button
          onClick={() => { onSelect({ id: '', name: '' }); setQ('') }}
          className="text-ink-300 hover:text-ink-600 text-xs flex-shrink-0"
          title="Clear"
        >✕</button>
      )}
    </div>
  )
}

// ─── Shared stop search box (used in departures tab) ─────────────────────────

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  const { data: results } = useQuery({
    queryKey: ['stopSearch', q],
    queryFn:  () => searchStops(q),
    enabled:  q.length >= 2,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
      />
      {results && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg overflow-hidden text-sm">
          {results.slice(0, 6).map((r: StopResult) => (
            <li key={r.id} className="flex items-center px-3 py-2 hover:bg-cream-50">
              <button onClick={() => { onSelect(r); setQ('') }} className="flex-1 text-left text-ink-800">
                {r.name}
              </button>
              {onAddFav && (
                <button onClick={() => onAddFav(r)} className="text-xs text-accent-500 hover:text-accent-700 ml-2" title="Pin">★</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export function RuterWidget() {
  const [tab, setTab] = useState<Tab>('departures')
  const [geoAsked, setGeoAsked] = useState(() => !!localStorage.getItem('ruter_geo_asked'))

  const ws  = useWidgetState('ruter', { collapsed: true, intervalMs: 60_000 })
  const fav = useRuterFavorites(DEFAULT_STOP)
  const now = useNow()

  useEffect(() => {
    if (!ws.collapsed && !geoAsked) {
      setGeoAsked(true)
      localStorage.setItem('ruter_geo_asked', '1')
      getBrowserLocation().catch(() => {})
    }
  }, [ws.collapsed, geoAsked])

  const tabBar = (
    <div className="flex gap-1">
      {(['departures', 'routes'] as Tab[]).map(t => (
        <button key={t} onClick={() => setTab(t)}
          className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize transition-colors duration-150 ${
            tab === t ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
          }`}
        >{t}</button>
      ))}
    </div>
  )

  return (
    <WidgetShell title="Departures" ws={ws} headerRight={tabBar}>
      {tab === 'departures' && <DeparturesTab fav={fav} ws={ws} now={now} />}
      {tab === 'routes'     && <RoutesTab ws={ws} now={now} />}
    </WidgetShell>
  )
}

// ─── Departures tab ───────────────────────────────────────────────────────────

function DeparturesTab({
  fav,
  ws,
  now,
}: {
  fav: ReturnType<typeof useRuterFavorites>
  ws:  ReturnType<typeof useWidgetState>
  now: number
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
      {/* Favorite stop tabs */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {fav.favStops.map(s => (
          <button key={s.id} onClick={() => fav.setActiveStop(s)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              fav.activeStop.id === s.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >{s.name}</button>
        ))}
        <button onClick={() => setEditMode(v => !v)} className="text-xs text-ink-400 hover:text-ink-700" title="Edit stops">✎</button>
        <button onClick={() => setShowSearch(v => !v)} className="text-xs text-ink-400 hover:text-accent-600">+ Stop</button>
      </div>

      {editMode && (
        <div className="mb-3 p-2 bg-cream-50 rounded-lg border border-ink-200 space-y-1 text-xs">
          {fav.favStops.map(s => (
            <div key={s.id} className="flex justify-between items-center">
              <span className="text-ink-700">{s.name}</span>
              <button onClick={() => fav.removeStop(s.id)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
          ))}
          <button onClick={() => setEditMode(false)} className="text-ink-400 hover:text-ink-700 mt-1">Done</button>
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

      <div className="flex items-center justify-between mb-2">
        {data && <span className="text-[11px] text-ink-500 font-medium">📍 {data.stopName}</span>}
        <button onClick={() => { refetch(); ws.markSynced() }}
          className="text-[10px] text-ink-400 hover:text-accent-600">↻ Refresh</button>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error && (
        <div className="text-ink-400 text-xs">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : '⚠ Unavailable'}
        </div>
      )}
      {data && (
        <div className="space-y-2.5">
          {data.departures.length === 0 && <div className="text-ink-400 text-sm">No departures</div>}
          {data.departures.map((dep: Departure, i: number) => (
            <DepartureRow key={i} dep={dep} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}

function DepartureRow({ dep, now }: { dep: Departure; now: number }) {
  const mins  = minsUntil(dep.expected, now)
  const isNow = mins <= 0
  return (
    <div className="flex items-start gap-2">
      <span className="text-base w-5 text-center flex-shrink-0">{TRANSPORT_ICON[dep.transport] ?? '🚐'}</span>
      <span className="text-sm font-bold text-ink-900 w-8 flex-shrink-0">{dep.line}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-700 truncate">{dep.destination}</div>
        {(dep.quayCode || dep.quayDescription) && (
          <div className="text-[10px] text-ink-400">
            {dep.quayCode && `Platform ${dep.quayCode}`}
            {dep.quayCode && dep.quayDescription && ' · '}
            {dep.quayDescription}
          </div>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <span className={`text-sm font-medium ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-700'}`}>
          {isNow ? 'Now' : `${mins} min`}
        </span>
        {!dep.realtime && <span className="text-[10px] text-ink-300 ml-0.5" title="Scheduled">~</span>}
      </div>
    </div>
  )
}

// ─── Routes tab ───────────────────────────────────────────────────────────────

// Simple From / To pickers with preset quick-buttons.
// No saved-route management — presets cover the main use case.
function RoutesTab({
  ws,
  now,
}: {
  ws:  ReturnType<typeof useWidgetState>
  now: number
}) {
  const [from, setFrom] = useState<StopResult | null>(null)
  const [to,   setTo]   = useState<StopResult | null>(null)

  function applyPreset(preset: typeof PRESET_ROUTES[number]) {
    setFrom(preset.from)
    setTo(preset.to)
  }

  function swapStops() {
    setFrom(to)
    setTo(from)
  }

  const canFetch = !!(from?.id && to?.id)

  const { data, isLoading, error } = useQuery({
    queryKey:        ['trip', from?.id, to?.id],
    queryFn:         () => fetchTrips(from!.id, to!.id),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && canFetch,
  })

  return (
    <div>
      {/* Preset quick-pick buttons */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {PRESET_ROUTES.map(r => (
          <button
            key={`${r.from.id}|${r.to.id}`}
            onClick={() => applyPreset(r)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              from?.id === r.from.id && to?.id === r.to.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* From / To inputs */}
      <div className="space-y-2 mb-3">
        <StopInput
          label="From"
          value={from}
          onSelect={s => setFrom(s.id ? s : null)}
          placeholder="Search departure stop…"
        />
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <StopInput
              label="To"
              value={to}
              onSelect={s => setTo(s.id ? s : null)}
              placeholder="Search destination stop…"
            />
          </div>
          <button
            onClick={swapStops}
            title="Swap"
            className="text-ink-400 hover:text-accent-600 text-sm px-1 flex-shrink-0"
          >⇅</button>
        </div>
      </div>

      {!canFetch && (
        <p className="text-xs text-ink-300">Pick departure and destination stops above</p>
      )}

      {isLoading && <div className="text-ink-400 text-sm">Loading trips…</div>}
      {error && (
        <div className="text-ink-400 text-xs">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : '⚠ Unavailable'}
        </div>
      )}
      {data && (
        <div className="space-y-3">
          {data.length === 0 && <div className="text-ink-400 text-sm">No trips found</div>}
          {(data as TripPattern[]).map((trip, i) => (
            <TripRow key={i} trip={trip} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}

function TripRow({ trip, now }: { trip: TripPattern; now: number }) {
  const mins    = minsUntil(trip.departure, now)
  const isNow   = mins <= 0
  const mainLeg = trip.legs.find(l => l.mode !== 'foot')
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-ink-100 last:border-0">
      <div className="flex-shrink-0 text-right min-w-[48px]">
        <div className={`text-sm font-bold ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-900'}`}>
          {isNow ? 'Now' : `${mins} min`}
        </div>
        <div className="text-[10px] text-ink-400">{fmtTime(trip.departure)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {trip.legs.filter(l => l.mode !== 'foot').map((leg, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-ink-100 text-ink-700 rounded px-1.5 py-0.5">
              {TRANSPORT_ICON[leg.mode] ?? '🚐'} {leg.line}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-ink-400 mt-0.5">
          {fmtDuration(trip.duration)}
          {mainLeg && ` · from ${mainLeg.from}`}
        </div>
      </div>
    </div>
  )
}
