import { useState, useEffect } from 'react'
import { RouteMap } from './RouteMap'
import type { TripLeg } from '../../../api/ruterApi'

interface RouteMapPanelProps {
  legs: TripLeg[] | null
}

export function RouteMapPanel({ legs }: RouteMapPanelProps) {
  const [open, setOpen] = useState(false)

  // Auto-collapse when legs change (new search)
  useEffect(() => { setOpen(false) }, [legs])

  if (!legs || legs.length === 0) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[36px] ${
          open ? 'bg-ink-800 text-white border-ink-800' : 'text-ink-600 border-ink-200 hover:border-ink-400 bg-white'
        }`}
      >
        <span>{open ? '✕' : '🗺'}</span>
        <span>{open ? 'Hide map' : 'Show route map'}</span>
      </button>
      {open && (
        <div className="mt-2">
          <RouteMap legs={legs} height={260} />
        </div>
      )}
    </div>
  )
}
