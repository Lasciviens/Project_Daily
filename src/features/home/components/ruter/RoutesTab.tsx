import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrips, type StopResult } from '../../api/ruterApi'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import type { WidgetStateResult } from '../../hooks/useWidgetState'
import { StopSearchInput } from './StopSearchInput'
import { TripCard } from './TripCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutesTabProps {
  ws:  WidgetStateResult
  now: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoutesTab({ ws, now }: RoutesTabProps) {
  const { routes, addRoute } = useTransitRoutes()

  const [from, setFrom] = useState<StopResult | null>(null)
  const [to, setTo]     = useState<StopResult | null>(null)
  const [saveLabel, setSaveLabel]     = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saveMsg, setSaveMsg]         = useState<string | null>(null)

  function applyPreset(r: { from_stop_id: string; from_stop_name: string; to_stop_id: string; to_stop_name: string }) {
    setFrom({ id: r.from_stop_id, name: r.from_stop_name })
    setTo({ id: r.to_stop_id, name: r.to_stop_name })
    setSaveMsg(null)
    setShowSaveForm(false)
  }

  function swapStops() {
    setFrom(to)
    setTo(from)
  }

  const canFetch = !!(from?.id && to?.id)
  const alreadySaved = canFetch && routes.some(
    r => r.from_stop_id === from!.id && r.to_stop_id === to!.id
  )

  const { data, isLoading, error } = useQuery({
    queryKey:        ['trip', from?.id, to?.id],
    queryFn:         () => fetchTrips(from!.id, to!.id),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed && canFetch,
  })

  async function handleSaveRoute() {
    if (!saveLabel.trim() || !from || !to) return
    setSaving(true)
    try {
      await addRoute(saveLabel.trim(), from, to)
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
                from?.id === r.from_stop_id && to?.id === r.to_stop_id
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
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">From</span>
          <div className="flex-1">
            {from ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg min-h-[44px]">
                <span className="flex-1 text-sm text-ink-700 truncate">{from.name}</span>
                <button onClick={() => setFrom(null)} className="text-ink-300 hover:text-ink-600 text-xs min-w-[32px] flex items-center justify-center">✕</button>
              </div>
            ) : (
              <StopSearchInput placeholder="Departure stop…" onSelect={setFrom} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-ink-400 uppercase w-8 flex-shrink-0">To</span>
          <div className="flex-1">
            {to ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg min-h-[44px]">
                <span className="flex-1 text-sm text-ink-700 truncate">{to.name}</span>
                <button onClick={() => setTo(null)} className="text-ink-300 hover:text-ink-600 text-xs min-w-[32px] flex items-center justify-center">✕</button>
              </div>
            ) : (
              <StopSearchInput placeholder="Destination stop…" onSelect={setTo} />
            )}
          </div>
          <button
            onClick={swapStops}
            disabled={!from && !to}
            title="Swap"
            className="text-ink-400 hover:text-accent-600 transition-colors duration-150 text-sm flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-30"
          >⇅</button>
        </div>
      </div>

      {/* Save route — shown when results loaded and not already saved */}
      {canFetch && !alreadySaved && data && (
        <div className="mb-3">
          {!showSaveForm ? (
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

      {/* Empty state */}
      {!canFetch && (
        <p className="text-xs text-ink-400">Select departure and destination stops above.</p>
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
