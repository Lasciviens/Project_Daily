import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDepartures, searchStops, TRANSPORT_ICON, DEFAULT_STOP, type StopResult } from '../api/ruterApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FavoriteStop {
  id:   string
  name: string
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const STOP_KEY = 'ruter_active_stop'
const FAVS_KEY = 'ruter_favorite_stops'

function loadStop(): StopResult {
  try {
    const raw = localStorage.getItem(STOP_KEY)
    if (raw) return JSON.parse(raw) as StopResult
  } catch { /* ignore */ }
  return DEFAULT_STOP
}

function loadFavorites(): FavoriteStop[] {
  try {
    const raw = localStorage.getItem(FAVS_KEY)
    if (raw) return JSON.parse(raw) as FavoriteStop[]
  } catch { /* ignore */ }
  return [DEFAULT_STOP]
}

function saveFavorites(favs: FavoriteStop[]) {
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RuterWidget() {
  const [stop, setStop]           = useState<StopResult>(loadStop)
  const [favorites, setFavorites] = useState<FavoriteStop[]>(loadFavorites)
  const [searchQ, setSearchQ]     = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [editMode, setEditMode]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // RUTER departures change every minute — 1m default, collapsed by default
  const ws = useWidgetState('ruter', { collapsed: true, intervalMs: 1 * 60_000 })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['departures', stop.id],
    queryFn:         () => fetchDepartures(stop.id),
    staleTime:       ws.intervalMs,
    // Only poll when widget is open and sync is active
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['stopSearch', searchQ],
    queryFn:  () => searchStops(searchQ),
    enabled:  showSearch && searchQ.length >= 2,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (showSearch) inputRef.current?.focus()
  }, [showSearch])

  function selectStop(s: StopResult) {
    setStop(s)
    localStorage.setItem(STOP_KEY, JSON.stringify(s))
    setSearchQ('')
    setShowSearch(false)
  }

  function addFavorite(s: StopResult) {
    if (favorites.some(f => f.id === s.id)) return
    const updated = [...favorites, s]
    setFavorites(updated)
    saveFavorites(updated)
  }

  function removeFavorite(id: string) {
    const updated = favorites.filter(f => f.id !== id)
    setFavorites(updated)
    saveFavorites(updated)
  }

  return (
    <WidgetShell
      title="Departures"
      ws={ws}
      onManualSync={() => { refetch(); ws.markSynced() }}
    >
      {/* Favorite stop tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {favorites.map(f => (
          <button
            key={f.id}
            onClick={() => selectStop(f)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              stop.id === f.id
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-600 border-ink-200 hover:border-accent-300'
            }`}
          >
            {f.name}
          </button>
        ))}
        <button
          onClick={() => setEditMode(v => !v)}
          className="text-xs text-ink-400 hover:text-ink-700 px-1"
          title="Edit favorite stops"
        >
          ✎
        </button>
        <button
          onClick={() => setShowSearch(v => !v)}
          className="text-xs text-ink-400 hover:text-accent-600 px-1"
          title="Add stop"
        >
          + Search
        </button>
      </div>

      {/* Edit mode — remove favorites */}
      {editMode && (
        <div className="mb-3 p-2 bg-cream-50 rounded-lg border border-ink-200 space-y-1">
          <p className="text-[10px] text-ink-400 mb-1">Remove favorite stops:</p>
          {favorites.map(f => (
            <div key={f.id} className="flex items-center justify-between">
              <span className="text-xs text-ink-700">{f.name}</span>
              <button
                onClick={() => removeFavorite(f.id)}
                className="text-xs text-red-400 hover:text-red-600 px-1"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => setEditMode(false)}
            className="text-[10px] text-ink-400 hover:text-ink-700 mt-1"
          >
            Done
          </button>
        </div>
      )}

      {/* Stop search */}
      {showSearch && (
        <div className="mb-3 relative">
          <input
            ref={inputRef}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search stop…"
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
          />
          {searchResults && searchResults.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg text-sm overflow-hidden">
              {searchResults.slice(0, 6).map((r: StopResult) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2 hover:bg-cream-50">
                  <button onClick={() => selectStop(r)} className="flex-1 text-left text-ink-800">
                    {r.name}
                  </button>
                  <button
                    onClick={() => addFavorite(r)}
                    className="text-xs text-accent-600 hover:text-accent-700 ml-2 flex-shrink-0"
                    title="Add to favorites"
                  >
                    ★
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Departures list */}
      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error     && <div className="text-ink-400 text-sm">Unavailable</div>}

      {data && (
        <div className="space-y-2">
          {data.departures.length === 0 && (
            <div className="text-ink-400 text-sm">No departures found</div>
          )}
          {data.departures.slice(0, 10).map((dep, i) => {
            const mins  = minutesUntil(dep.expected)
            const isNow = mins <= 0
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-base w-5 text-center flex-shrink-0">
                  {TRANSPORT_ICON[dep.transport] ?? '🚐'}
                </span>
                <span className="text-sm font-bold text-ink-900 w-8 flex-shrink-0">{dep.line}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-700 truncate">{dep.destination}</div>
                  {dep.platform && (
                    <div className="text-[10px] text-ink-400">Platform {dep.platform}</div>
                  )}
                </div>
                <span className={`text-sm font-medium flex-shrink-0 ${
                  isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-700'
                }`}>
                  {isNow ? 'Now' : `${mins} min`}
                </span>
                {!dep.realtime && (
                  <span className="text-[10px] text-ink-300" title="Scheduled (not real-time)">~</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}
