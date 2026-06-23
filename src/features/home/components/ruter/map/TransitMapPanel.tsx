/**
 * TransitMapPanel
 *
 * The collapsible wrapper used inside DeparturesTab.
 * Shows a "Map" toggle button; expands to reveal <TransitMap>.
 *
 * Keeps the map hidden (and Leaflet paused) when collapsed,
 * so it doesn't waste fetch cycles or battery.
 *
 * Props:
 *   stop          — the stop whose area to show on the map
 *   userLocation  — GPS coords to mark as "you are here"
 */

import { useState, useEffect } from 'react'
import { TransitMap } from './TransitMap'
import type { StopPin } from './types'

interface TransitMapPanelProps {
  stop:          StopPin | null
  userLocation?: [number, number] | null
}

export function TransitMapPanel({ stop, userLocation }: TransitMapPanelProps) {
  const [open, setOpen] = useState(false)

  // Auto-collapse if the stop changes (new stop → user may not want the old map)
  useEffect(() => {
    setOpen(false)
  }, [stop?.id])

  if (!stop) return null   // nothing to show without a stop

  return (
    <div className="mt-3">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`
          flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg
          border transition-colors duration-150 min-h-[36px]
          ${open
            ? 'bg-ink-800 text-white border-ink-800'
            : 'text-ink-600 border-ink-200 hover:border-ink-400 bg-white'
          }
        `}
      >
        <span>{open ? '✕' : '🗺'}</span>
        <span>{open ? 'Hide map' : 'Show map'}</span>
        {open && <span className="text-[9px] opacity-70 ml-1">live</span>}
      </button>

      {/* Map — only mounted when open (saves memory + stops polling) */}
      {open && (
        <div className="mt-2">
          <TransitMap stop={stop} userLocation={userLocation} height={240} />
          <p className="text-[10px] text-ink-400 mt-1 px-0.5">
            Colored dots = live Ruter vehicles near this stop
            · <span className="inline-block w-2 h-2 rounded-full bg-green-500 align-middle" /> on time
            · <span className="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" /> slight delay
            · <span className="inline-block w-2 h-2 rounded-full bg-red-500 align-middle" /> late
          </p>
        </div>
      )}
    </div>
  )
}
