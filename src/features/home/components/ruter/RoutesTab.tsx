import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips, type StopResult, type TransitPlace } from '../../api/ruterApi'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

type LocationState = 'idle' | 'loading' | 'granted' | 'denied' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentLocation(): Promise<TransitPlace> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        kind: 'coords',
        lat:  pos.coords.latitude,
        lon:  pos.coords.longitude,
        name: 'Current location',
      }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  })
}

// ─── LocationButton ───────────────────────────────────────────────────────────

function LocationButton({ onLocate, state }: { onLocate: () => void; state: LocationState }) {
  if (state === 'loading') {
    return <span className="text-xs text-ink-400 py-2 block">Locating…</span>
  }
  if (state === 'denied') {
    return <span className="text-xs text-red-500 py-1 block">Location permission denied</span>
  }
  if (state === 'error') {
    return <span className="text-xs text-red-500 py-1 block">Could not get location</span>
  }
  return (
    <button
      onClick={onLocate}
      className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150 py-1"
    >
      📍 Use current location
    </button>
  )
}

// ─── PlaceDisplay ─────────────────────────────────────────────────────────────

function PlaceDisplay({ place, onClear }: { place: TransitPlace; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg min-h-[44px]">
      <span className="flex-1 text-sm text-ink-700 truncate">
        {place.kind === 'coords' ? '📍 ' : ''}{place.name}
      </span>
      <button
        onClick={onClear}
        className="text-ink-300 hover:text-ink-600 text-xs min-w-[32px] flex items-center justify-center"
      >✕</button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  const { routes, addRoute } = useTransitRoutes()

  const [from, setFrom] = useState<TransitPlace | null>(null)
  const [to,   setTo]   = useState<TransitPlace | null>(null)
  const [fromLocState, setFromLocState] = useState<LocationState>('idle')
  const [toLocState,   setToLocState]   = useState<LocationState>('idle')

  const [saveLabel, setSaveLabel]       = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState<string | null>(null)

  function applyPreset(r: { from_stop_id: string; from_stop_name: string; to_stop_id: string; to_stop_name: string }) {
    setFrom({ kind: 'stop', id: r.from_stop_id, name: r.from_stop_name })
    setTo(  { kind: 'stop', id: r.to_stop_id,   name: r.to_stop_name   })
    setSaveMsg(null)
    setShowSaveForm(false)
  }

  function swapStops() {
    setFrom(to)
    setTo(from)
  }

  async function locateFor(side: 'from' | 'to') {
    const setState = side === 'from' ? setFromLocState : setToLocState
    const setPlace = side === 'from' ? setFrom : setTo
    setState('loading')
    try {
      const place = await getCurrentLocation()
      setPlace(place)
      setState('granted')
    } catch (e) {
      const err = e as GeolocationPositionError
      setState(err.code === 1 ? 'denied' : 'error')
    }
  }

  const canFetch = !!(from && to)
  // Save only when both ends are named stops (not coords)
  const canSave  = canFetch && from.kind === 'stop' && to.kind === 'stop'
  const alreadySaved = canSave && routes.some(
    r => r.from_stop_id === (from as { id: string }).id && r.to_stop_id === (to as { id: string }).id
  )

  const { data, isLoading, error } = useQuery({
    queryKey:        ['trip', from?.kind === 'stop' ? from.id : `${from?.lat},${from?.lon}`, to?.kind === 'stop' ? to.id : `${to?.lat},${to?.lon}`],
    queryFn:         () => fetchTrips(from!, to!),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && canFetch,
  })

  async function handleSaveRoute() {
    if (!saveLabel.trim() || !canSave) return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), from as StopResult, to as StopResult)
      setSaveMsg('Saved ✓')
      setSaveLabel('')
      setShowSaveForm(false)
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Saved route quick-picks */}
      {routes.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {routes.map(r => (
            <button
              key={r.id}
              onClick={() => applyPreset(r)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                from?.kind === 'stop' && from.id === r.from_stop_id && to?.kind === 'stop' && to.id === r.to_stop_id
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'text-ink-600 border-ink-200 hover:border-accent-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* From / To inputs */}
      <div className="space-y-2 mb-3">
        {/* FROM */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">From</span>
          <div className="flex-1 space-y-1">
            {from
              ? <PlaceDisplay place={from} onClear={() => { setFrom(null); setFromLocState('idle') }} />
              : <>
                  <StopSearchInput placeholder="Departure stop…" onSelect={s => setFrom({ kind: 'stop', ...s })} />
                  <LocationButton state={fromLocState} onLocate={() => locateFor('from')} />
                </>
            }
          </div>
        </div>

        {/* TO */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">To</span>
          <div className="flex-1 space-y-1">
            {to
              ? <PlaceDisplay place={to} onClear={() => { setTo(null); setToLocState('idle') }} />
              : <>
                  <StopSearchInput placeholder="Destination stop…" onSelect={s => setTo({ kind: 'stop', ...s })} />
                  <LocationButton state={toLocState} onLocate={() => locateFor('to')} />
                </>
            }
          </div>
          <button
            onClick={swapStops}
            disabled={!from && !to}
            title="Swap"
            className="text-ink-400 hover:text-accent-600 transition-colors duration-150 text-sm flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-30"
          >⇅</button>
        </div>
      </div>

      {/* Save route */}
      {canFetch && data && (
        <div className="mb-3">
          {!canSave ? (
            <p className="text-[10px] text-ink-400">Routes with current location cannot be saved.</p>
          ) : alreadySaved ? null : !showSaveForm ? (
            <button
              onClick={() => setShowSaveForm(true)}
              className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150"
            >
              + Save this route
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={saveLabel}
                onChange={e => setSaveLabel(e.target.value)}
                placeholder='Label e.g. "Home" or "Work"'
                className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
                onKeyDown={e => e.key === 'Enter' && handleSaveRoute()}
              />
              <button
                onClick={handleSaveRoute}
                disabled={!saveLabel.trim() || saving}
                className="text-xs px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => { setShowSaveForm(false); setSaveLabel('') }}
                className="text-ink-400 hover:text-ink-600 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              >✕</button>
            </div>
          )}
          {saveMsg && (
            <p className={`text-xs mt-1 ${saveMsg.startsWith('Failed') ? 'text-red-500' : 'text-green-600'}`}>
              {saveMsg}
            </p>
          )}
        </div>
      )}

      {!canFetch && (
        <p className="text-xs text-ink-400">Select or locate departure and destination above.</p>
      )}

      {isLoading && <div className="text-ink-400 text-sm">Loading trips…</div>}
      {error && (
        <div className="text-red-500 text-xs py-1">
          {(error as Error).message?.includes('Rate') ? '⏳ Rate limited — wait a moment' : `⚠ ${(error as Error).message}`}
        </div>
      )}
      {data && (
        <div className="space-y-3">
          {data.length === 0 && <div className="text-ink-400 text-sm">No trips found</div>}
          {data.map((trip, i) => (
            <TripCard key={i} trip={trip} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
