import { useState, useRef, useEffect } from 'react'
import { useDepartures, useStopSearch } from '../hooks/useHomeData'
import { TRANSPORT_ICON, DEFAULT_STOP, type StopResult } from '../api/ruterApi'

const STOP_KEY = 'home_ruter_stop'

function loadStop(): StopResult {
  try {
    const raw = localStorage.getItem(STOP_KEY)
    if (raw) return JSON.parse(raw) as StopResult
  } catch { /* ignore */ }
  return DEFAULT_STOP
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
}

export function RuterWidget() {
  const [stop, setStop] = useState<StopResult>(loadStop)
  const [searchQ, setSearchQ] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, error } = useDepartures(stop.id)
  const { data: results } = useStopSearch(searchQ)

  function selectStop(s: StopResult) {
    setStop(s)
    localStorage.setItem(STOP_KEY, JSON.stringify(s))
    setSearchQ('')
    setShowSearch(false)
  }

  useEffect(() => {
    if (showSearch) inputRef.current?.focus()
  }, [showSearch])

  return (
    <div className="bg-white rounded-xl border border-ink-200 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Departures</h3>
        <button
          onClick={() => setShowSearch(v => !v)}
          className="text-xs text-accent-600 hover:text-accent-700"
        >
          {showSearch ? 'Cancel' : '⬡ ' + stop.name}
        </button>
      </div>

      {/* Stop search */}
      {showSearch && (
        <div className="mb-3 relative">
          <input
            ref={inputRef}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search stop…"
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50"
          />
          {results && results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-ink-200 rounded-lg shadow-lg text-sm overflow-hidden">
              {results.slice(0, 6).map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => selectStop(r)}
                    className="w-full text-left px-3 py-2 hover:bg-cream-50 text-ink-800"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Departures */}
      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error && <div className="text-ink-400 text-sm">Unavailable</div>}
      {data && (
        <div className="space-y-2">
          {data.departures.length === 0 && (
            <div className="text-ink-400 text-sm">No departures found</div>
          )}
          {data.departures.slice(0, 8).map((dep, i) => {
            const mins = minutesUntil(dep.expected)
            const isNow = mins <= 0
            return (
              <div key={i} className="flex items-center gap-2.5">
                <span className="text-base w-5 text-center flex-shrink-0">
                  {TRANSPORT_ICON[dep.transport] ?? '🚐'}
                </span>
                <span className="text-sm font-semibold text-ink-900 w-8 flex-shrink-0">{dep.line}</span>
                <span className="text-sm text-ink-600 flex-1 truncate">{dep.destination}</span>
                <span className={`text-sm font-medium flex-shrink-0 ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-700'}`}>
                  {isNow ? 'Now' : `${mins} min`}
                </span>
                {!dep.realtime && <span className="text-[10px] text-ink-300">~</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
