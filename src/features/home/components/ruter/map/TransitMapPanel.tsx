import { useState, useEffect } from 'react'
import { TransitMap } from './TransitMap'
import type { StopPin } from './types'

interface TransitMapPanelProps {
  stop:                     StopPin | null
  userLocation?:            [number, number] | null
  trackedServiceJourneyId?: string | null
  height?:                  number
}

export function TransitMapPanel({ stop, userLocation, trackedServiceJourneyId, height = 280 }: TransitMapPanelProps) {
  const [open, setOpen] = useState(false)

  // Auto-collapse when stop changes
  useEffect(() => { setOpen(false) }, [stop?.id])

  // Auto-open when journey tracking starts
  useEffect(() => {
    if (trackedServiceJourneyId) setOpen(true)
  }, [trackedServiceJourneyId])

  if (!stop) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg
          border transition-colors duration-150 min-h-[36px]
          ${open ? 'bg-ink-800 text-white border-ink-800' : 'text-ink-600 border-ink-200 hover:border-ink-400 bg-white'}`}
      >
        <span>{open ? '✕' : '🗺'}</span>
        <span>{open ? 'Hide map' : trackedServiceJourneyId ? 'Live tracking' : 'Show map'}</span>
        {open && trackedServiceJourneyId && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block ml-0.5" />
        )}
      </button>

      {open && (
        <div className="mt-2">
          <TransitMap
            stop={stop}
            userLocation={userLocation}
            trackedServiceJourneyId={trackedServiceJourneyId}
            height={height}
          />
          {!trackedServiceJourneyId && (
            <p className="text-[10px] text-ink-400 mt-1 px-0.5">
              Tap a departure below to track that bus live
            </p>
          )}
        </div>
      )}
    </div>
  )
}
