import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTransitStops } from '../../hooks/useTransitStops'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import { useGeolocation } from '../../hooks/useGeolocation'
import { fetchNearestStops, type StopResult } from '../../api/ruterApi'
import { StopSearchInput } from './StopSearchInput'
import { QuaySavePanel } from './QuaySavePanel'
import { toast } from '../../../../app/store'

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsTab() {
  const { stops, addStop, removeStop, setDefault } = useTransitStops()
  const { routes, removeRoute }                    = useTransitRoutes()
  const { data: geo } = useGeolocation()

  const [newStop, setNewStop] = useState<StopResult | null>(null)

  // Real nearby stops for one-tap add — the point being asked for: adding a
  // "Home"/"Work" stop shouldn't require typing its name if you're standing there.
  const { data: nearby = [] } = useQuery({
    queryKey:  ['nearby-stops', geo?.lat, geo?.lon],
    queryFn:   () => fetchNearestStops(geo!.lat, geo!.lon),
    enabled:   geo?.source === 'gps',
    staleTime: 5 * 60_000,
    retry:     false,
  })

  async function handleSaveNewStop(quayId: string | null, quayDescription: string | null, label: string) {
    if (!newStop) return
    const tid = toast.loading('Saving stop…')
    try {
      await addStop(newStop, quayId ?? undefined, quayDescription ?? undefined, label !== newStop.name ? label : undefined)
      toast.dismiss(tid)
      toast.success('Stop saved ✓')
      setNewStop(null)
    } catch (e) {
      toast.dismiss(tid)
      toast.error((e as Error).message ?? 'Failed to save')
    }
  }

  return (
    <div className="space-y-5">
      {/* Add a stop */}
      <section>
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide mb-2">
          Add a Stop
        </h4>

        {!newStop && nearby.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] text-ink-400 mb-1.5">📍 Near you</p>
            <div className="flex flex-wrap gap-1.5">
              {nearby.map(n => (
                <button
                  key={n.id}
                  onClick={() => setNewStop({ id: n.id, name: n.name, layer: 'venue' })}
                  className="text-xs px-3 py-2 rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 transition-colors duration-150 min-h-[44px]"
                >
                  {n.name} <span className="opacity-60">· {n.distance}m</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!newStop && (
          <StopSearchInput placeholder="Search any stop…" onSelect={setNewStop} stopsOnly={true} />
        )}

        {newStop && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-ink-800 font-medium">{newStop.name}</span>
              <button
                onClick={() => setNewStop(null)}
                className="text-ink-400 hover:text-ink-700 text-xs min-h-[36px] px-1"
              >
                Change
              </button>
            </div>
            <QuaySavePanel
              stopId={newStop.id}
              stopName={newStop.name}
              onSave={handleSaveNewStop}
              onCancel={() => setNewStop(null)}
            />
          </>
        )}
      </section>

      <div className="border-t border-ink-100" />

      {/* Favorite Stops */}
      <section>
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide mb-2">
          Favorite Stops
        </h4>
        {stops.length === 0 && (
          <p className="text-xs text-ink-400">No stops saved yet — add one above.</p>
        )}
        <ul className="space-y-1">
          {stops.map(s => (
            <li key={s.id} className="flex items-center gap-2 min-h-[44px]">
              <button
                onClick={() => setDefault(s.id).catch(e => toast.error((e as Error).message ?? 'Failed'))}
                className="flex-1 text-left"
                title="Set as default"
              >
                <span className="text-sm text-ink-800">{s.label ?? s.stop_name}</span>
                {s.label && <span className="text-xs text-ink-400 ml-1.5">{s.stop_name}</span>}
                {s.stop_locality && (
                  <span className="text-xs text-ink-400 ml-1.5">{s.stop_locality}</span>
                )}
              </button>
              {s.is_default && (
                <span className="text-[10px] text-accent-500 font-medium flex-shrink-0">default</span>
              )}
              <button
                onClick={() => removeStop(s.id).catch(e => toast.error((e as Error).message ?? 'Failed'))}
                className="text-ink-300 hover:text-red-500 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
                title="Remove"
              >✕</button>
            </li>
          ))}
        </ul>
      </section>

      <div className="border-t border-ink-100" />

      {/* Favorite Routes */}
      <section>
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide mb-2">
          Favorite Routes
        </h4>
        {routes.length === 0 && (
          <p className="text-xs text-ink-400">No routes saved yet. Use the Routes tab to plan and save.</p>
        )}
        <ul className="space-y-1">
          {routes.map(r => (
            <li key={r.id} className="flex items-center gap-2 min-h-[44px]">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-ink-800">{r.label}</span>
                <p className="text-xs text-ink-400 truncate">{r.from_stop_name} → {r.to_stop_name}</p>
              </div>
              <button
                onClick={() => removeRoute(r.id).catch(e => toast.error((e as Error).message ?? 'Failed'))}
                className="text-ink-300 hover:text-red-500 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
                title="Remove"
              >✕</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
