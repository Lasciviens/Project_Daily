import { useState } from 'react'
import { TRANSPORT_ICON, type TripPattern, type TripLeg } from '../../api/ruterApi'

// Colour by severity — grey/neutral for informational, amber for moderate, red
// for severe. Matches EnTur's own Severity enum.
function situationColor(severity: string): string {
  if (severity === 'severe' || severity === 'verySevere') return 'text-red-600 bg-red-50 border-red-200'
  if (severity === 'slight' || severity === 'normal')     return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-ink-500 bg-ink-50 border-ink-200'
}
import { fmtTime, fmtDuration, fmtDistance, lineStyle, MODE_FALLBACK_BG } from './transitUtils'

interface TripCardProps {
  trip:    TripPattern
  now:     number
  isBest?: boolean
}

function isDelayed(leg: TripLeg): boolean {
  if (!leg.aimed || !leg.departure) return false
  return Math.abs(new Date(leg.departure).getTime() - new Date(leg.aimed).getTime()) > 60_000
}

function transferWaitMins(prev: TripLeg, next: TripLeg): number | null {
  if (!prev.arrivalTime || !next.departure) return null
  const diff = Math.round(
    (new Date(next.departure).getTime() - new Date(prev.arrivalTime).getTime()) / 60_000
  )
  return diff >= 0 ? diff : null
}

// Fallback solid colors when no presentation data
function LineBadge({ leg }: { leg: TripLeg }) {
  if (!leg.line) return null
  const style = lineStyle(leg.lineColour, leg.lineTextColour)
  const fallbackBg = MODE_FALLBACK_BG[leg.mode] ?? '#555'
  const hasSituation = (leg.situations?.length ?? 0) > 0
  return (
    <span className="relative inline-flex flex-shrink-0">
      <span
        className="inline-flex items-center justify-center text-[11px] font-bold px-2 py-0.5 rounded min-w-[1.75rem] leading-tight"
        style={style ?? { backgroundColor: fallbackBg, color: '#ffffff' }}
      >
        {leg.line}
      </span>
      {/* Visible even collapsed — tap the row to expand and read the alert */}
      {hasSituation && (
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 border border-cream-50" title="Service alert on this line" />
      )}
    </span>
  )
}

function WalkChip({ leg }: { leg: TripLeg }) {
  const mins = Math.round(leg.duration / 60)
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-500 bg-ink-100 px-2 py-0.5 rounded flex-shrink-0">
      🚶 {mins}m
    </span>
  )
}

// Compact horizontal journey summary: badges + walk chips
function JourneySummaryStrip({ legs }: { legs: TripLeg[] }) {
  const items: { key: string; el: React.ReactNode }[] = []
  let i = 0
  for (const leg of legs) {
    if (leg.mode === 'foot') {
      const mins = Math.round(leg.duration / 60)
      if (mins >= 2) {
        items.push({ key: `foot-${i}`, el: <WalkChip leg={leg} /> })
      }
    } else {
      items.push({ key: `transit-${i}`, el: <LineBadge leg={leg} /> })
    }
    i++
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map((item, idx) => (
        <span key={item.key} className="flex items-center gap-1.5">
          {idx > 0 && <span className="text-ink-200 text-[10px] select-none">›</span>}
          {item.el}
        </span>
      ))}
    </div>
  )
}

import type React from 'react'

function TransitLeg({ leg }: { leg: TripLeg }) {
  const delayed = isDelayed(leg)
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex-shrink-0 mt-0.5">
        <LineBadge leg={leg} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {leg.destination && (
            <span className="text-xs font-medium text-ink-800 truncate">
              {TRANSPORT_ICON[leg.mode] ?? '🚐'} towards {leg.destination}
            </span>
          )}
          {leg.realtime && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-500 flex-wrap">
          {leg.departure && (
            <span className={delayed ? 'text-orange-500' : ''}>
              {delayed && leg.aimed && (
                <span className="line-through text-ink-300 mr-1 font-normal">{fmtTime(leg.aimed)}</span>
              )}
              dep {fmtTime(leg.departure)}
            </span>
          )}
          {leg.arrivalTime && (
            <span>arr {fmtTime(leg.arrivalTime)}</span>
          )}
          {leg.quayCode && (
            <span className="bg-ink-100 px-1.5 py-0.5 rounded text-[10px]">
              Platform {leg.quayCode}{leg.quayDescription ? ` · ${leg.quayDescription}` : ''}
            </span>
          )}
        </div>
        {/* Live disruption/alert for this line — e.g. "Cancelled today" */}
        {leg.situations && leg.situations.length > 0 && (
          <div className={`text-[10px] px-1.5 py-0.5 rounded border mt-1 ${situationColor(leg.situations[0].severity)}`}>
            ⚠ {leg.situations[0].summary}
          </div>
        )}
      </div>
    </div>
  )
}

function WalkLeg({ leg }: { leg: TripLeg }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-xs text-ink-400">
      <span className="text-sm w-5 text-center flex-shrink-0">🚶</span>
      <span className="flex-1 truncate">
        {leg.to !== leg.from ? `Walk to ${leg.to}` : 'Walk'}
      </span>
      <span className="flex-shrink-0 tabular-nums">
        {fmtDuration(leg.duration)}
        {leg.distance > 50 ? ` · ${fmtDistance(leg.distance)}` : ''}
      </span>
    </div>
  )
}

function TransferMarker({ waitMins }: { waitMins: number | null }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="flex-1 border-t border-dashed border-ink-100" />
      <span className="text-[9px] font-medium text-ink-300 uppercase tracking-wider flex-shrink-0">
        {waitMins !== null ? `${waitMins} min transfer` : 'Transfer'}
      </span>
      <div className="flex-1 border-t border-dashed border-ink-100" />
    </div>
  )
}

export function TripCard({ trip, now, isBest = false }: TripCardProps) {
  const [expanded, setExpanded] = useState(false)

  const depMs    = new Date(trip.departure).getTime()
  const arrMs    = new Date(trip.arrival).getTime()
  const diffMin  = Math.round((depMs - now) / 60_000)
  const isPast   = depMs < now - 2 * 60_000
  const isNow    = diffMin <= 0 && !isPast
  const durationMin = Math.round((arrMs - depMs) / 60_000)

  const transitLegs = trip.legs.filter(l => l.mode !== 'foot')
  const transfers   = Math.max(0, transitLegs.length - 1)

  return (
    <div className={`rounded-xl border overflow-hidden transition-shadow duration-150 hover:shadow-sm ${
      isPast ? 'opacity-40 border-ink-100' : isBest ? 'border-accent-300' : 'border-ink-200'
    }`}>
      {/* Summary row — tap to expand */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-3 pt-3 pb-2.5 text-left min-h-[52px] bg-cream-50"
      >
        {/* "Leave in X" is the one number a user glances at first — a bare bold
            time (no label) read ambiguously as duration/arrival/etc, so it's
            explicit now, and de-emphasized (was the same bold size as the
            arrival time, competing for attention rather than leading it). */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-sm font-semibold flex-shrink-0 ${
            isNow ? 'text-red-500' : isPast ? 'text-ink-400' : 'text-accent-700'
          }`}>
            {isBest && <span className="text-[9px] font-bold uppercase tracking-wider text-accent-600 bg-accent-100 px-1.5 py-0.5 rounded mr-1.5">Best</span>}
            {isNow ? 'Leaving now' : diffMin <= 90 ? `Leave in ${diffMin} min` : `Leave at ${fmtTime(trip.departure)}`}
          </span>
          <span className="text-[10px] text-ink-300 flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>

        {/* Departure/arrival times + duration — secondary detail, smaller */}
        <div className="flex items-center gap-2 mb-1.5 text-xs text-ink-500 tabular-nums">
          <span>{fmtTime(trip.departure)}</span>
          <span className="text-ink-300">→</span>
          <span>{fmtTime(trip.arrival)}</span>
          <span className="text-ink-300">·</span>
          <span>{durationMin} min</span>
          {transfers > 0 && (
            <>
              <span className="text-ink-300">·</span>
              <span>{transfers} transfer{transfers !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {/* Journey strip: line badges + walk chips */}
        <JourneySummaryStrip legs={trip.legs} />
      </button>

      {/* Expandable leg details */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-ink-50 bg-cream-50 divide-y divide-ink-50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 pt-2 pb-1">Journey details</p>
          {trip.legs.map((leg, i) => {
            const prevLeg       = trip.legs[i - 1]
            const isTransit     = leg.mode !== 'foot'
            const prevIsTransit = i > 0 && prevLeg.mode !== 'foot'
            const waitMins      = (isTransit && prevIsTransit)
              ? transferWaitMins(prevLeg, leg)
              : null

            return (
              <div key={i}>
                {isTransit && prevIsTransit && <TransferMarker waitMins={waitMins} />}
                {leg.mode === 'foot'
                  ? <WalkLeg leg={leg} />
                  : <TransitLeg leg={leg} />
                }
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
