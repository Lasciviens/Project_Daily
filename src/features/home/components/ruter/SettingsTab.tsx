import { useTransitStops } from '../../hooks/useTransitStops'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsTab() {
  const { stops, removeStop, setDefault } = useTransitStops()
  const { routes, removeRoute }           = useTransitRoutes()

  return (
    <div className="space-y-5">
      {/* Favorite Stops */}
      <section>
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide mb-2">
          Favorite Stops
        </h4>
        {stops.length === 0 && (
          <p className="text-xs text-ink-400">No stops saved yet. Search in the Departures tab.</p>
        )}
        <ul className="space-y-1">
          {stops.map(s => (
            <li key={s.id} className="flex items-center gap-2 min-h-[44px]">
              <button
                onClick={() => setDefault(s.id).catch(console.error)}
                className="flex-1 text-left"
                title="Set as default"
              >
                <span className="text-sm text-ink-800">{s.stop_name}</span>
                {s.stop_locality && (
                  <span className="text-xs text-ink-400 ml-1.5">{s.stop_locality}</span>
                )}
              </button>
              {s.is_default && (
                <span className="text-[10px] text-accent-500 font-medium flex-shrink-0">default</span>
              )}
              <button
                onClick={() => removeStop(s.id).catch(console.error)}
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
                onClick={() => removeRoute(r.id).catch(console.error)}
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
