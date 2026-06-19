import { useState } from 'react'
import { TRANSPORT_ICON, TRANSPORT_COLOR, type TripPattern, type TripLeg } from '../../api/ruterApi'
import { fmtTripDeparture, fmtTime, fmtDuration, fmtDistance } from './transitUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripCardProps {
  trip:    TripPattern
  now:     number
  isBest?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isDelayed(leg: TripLeg): boolean {
  if (!leg.aimed || !leg.departure) return false
  return Math.abs(new Date(leg.departure).getTime() - new Date(leg.aimed).getTime()) > 60_000
}

// Minutes between the arrival of one transit leg and the departure of the next
function transferWaitMins(prev: TripLeg, next: TripLeg): number | null {
  if (!prev.arrivalTime || !next.departure) return null
  const diff = Math.round(
    (new Date(next.departure).getTime() - new Date(prev.arrivalTime).getTime()) / 60_000
  )
  return diff >= 0 ? diff : null
}

// Bolder solid colors for the leg strip visual
const LEG_STRIP_COLOR: Record<string, string> = {
  bus:   'bg-blue-500',
  tram:  'bg-green-500',
  metro: 'bg-purple-500',
  rail:  'bg-gray-600',
  ferry: 'bg-cyan-500',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LineBadge({ line, mode }: { line: string; mode: string }) {
  const colorClass = TRANSPORT_COLOR[mode] ?? 'bg-ink-100 text-ink-700'
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 ${colorClass}`}>
      {line}
    </span>
  )
}

function RealtimeDot({ realtime }: { realtime?: boolean }) {
  if (realtime === undefined) return null
  return realtime
    ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
    : <span className="text-ink-300 text-xs flex-shrink-0" title="Scheduled">~</span>
}

function WalkingLeg({ leg }: { leg: TripLeg }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-sm w-5 text-center flex-shrink-0">{TRANSPORT_ICON.foot}</span>
      <span className="flex-1 text-xs text-ink-500 truncate">Walk to {leg.to}</span>
      <span className="text-xs text-ink-400 flex-shrink-0">
        {fmtDuration(leg.duration)} · {fmtDistance(leg.distance)}
      </span>
    </div>
  )
}

function TransitLeg({ leg }: { leg: TripLeg }) {
  const icon    = TRANSPORT_ICON[leg.mode] ?? '🚐'
  const delayed = isDelayed(leg)

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-sm w-5 text-center flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        {/* Line + direction + realtime */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {leg.line && <LineBadge line={leg.line} mode={leg.mode} />}
          {leg.destination && (
            <span className="text-xs text-ink-700 truncate">towards {leg.destination}</span>
          )}
          <RealtimeDot realtime={leg.realtime} />
        </div>
        {/* Departure time + platform */}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {leg.departure && (
            <span className="text-[10px] text-ink-400">
              {delayed && leg.aimed && (
                <span className="line-through text-ink-300 mr-1">{fmtTime(leg.aimed)}</span>
              )}
              <span className={delayed ? 'text-orange-500' : ''}>dep {fmtTime(leg.departure)}</span>
            </span>
          )}
          {leg.arrivalTime && (
            <span className="text-[10px] text-ink-400">arr {fmtTime(leg.arrivalTime)}</span>
          )}
          {(leg.quayCode || leg.quayDescription) && (
            <span className="text-[10px] text-ink-400">
              {leg.quayCode ? `Platform ${leg.quayCode}` : ''}
              {leg.quayCode && leg.quayDescription ? ' · ' : ''}
              {leg.quayDescription ?? ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function TransferBadge({ waitMins }: { waitMins: number | null }) {
  return (
    <div className="py-0.5 flex items-center gap-2">
      <div className="flex-1 border-t border-dashed border-ink-100" />
      <span className="text-[10px] text-ink-300 uppercase tracking-wide flex-shrink-0">
        {waitMins !== null ? `Transfer · ${waitMins} min wait` : 'Transfer'}
      </span>
      <div className="flex-1 border-t border-dashed border-ink-100" />
    </div>
  )
}

// Horizontal proportional leg strip — visual overview of the whole journey
function LegStrip({ legs }: { legs: TripLeg[] }) {
  const totalSecs = legs.reduce((s, l) => s + l.duration, 0)
  if (totalSecs === 0) return null

  return (
    <div className="flex items-center gap-0.5 w-full h-6 px-3 pt-2">
      {legs.map((leg, i) => {
        const pct = (leg.duration / totalSecs) * 100
        if (leg.mode === 'foot') {
          // Walking legs: narrow grey notch
          return (
            <div
              key={i}
              style={{ flexBasis: `${Math.max(pct, 3)}%` }}
              className="flex-shrink-0 h-1.5 rounded-full bg-ink-200"
            />
          )
        }
        const color = LEG_STRIP_COLOR[leg.mode] ?? 'bg-ink-400'
        return (
          <div
            key={i}
            style={{ flexBasis: `${Math.max(pct, 8)}%` }}
            className={`flex-shrink-0 h-5 rounded-sm flex items-center justify-center overflow-hidden ${color}`}
          >
            {leg.line && (
              <span className="text-[10px] font-bold text-white truncate px-1 leading-none">
                {leg.line}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TripCard({ trip, now, isBest = false }: TripCardProps) {
  const [expanded, setExpanded] = useState(false)

  const depMs  = new Date(trip.departure).getTime()
  const isPast = depMs < now - 2 * 60_000
  const isNow  = depMs <= now && !isPast
  const label  = isPast ? 'Departed' : fmtTripDeparture(trip.departure, now)

  return (
    <div className={`border rounded-xl overflow-hidden transition-shadow duration-150 hover:shadow-md ${
      isPast ? 'opacity-50 border-ink-100' : isBest ? 'border-accent-300 shadow-sm' : 'border-ink-200'
    }`}>
      {/* Visual leg strip */}
      <LegStrip legs={trip.legs} />

      {/* Summary row — tap to expand/collapse leg details */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-3 pt-1.5 pb-2 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isBest && (
              <span className="text-[10px] font-semibold text-accent-600 bg-accent-100 px-1.5 py-0.5 rounded flex-shrink-0">
                Best
              </span>
            )}
            <span className={`text-sm font-semibold flex-shrink-0 ${isNow ? 'text-red-500' : 'text-ink-800'}`}>
              {label}
            </span>
            <span className="text-xs text-ink-400 flex-shrink-0">{fmtDuration(trip.duration)}</span>
            {trip.walkDistance > 100 && (
              <span className="text-xs text-ink-400 flex-shrink-0">{fmtDistance(trip.walkDistance)} walk</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs text-ink-500">arr {fmtTime(trip.arrival)}</span>
            <span className="text-[10px] text-ink-300">{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
      </button>

      {/* Expandable leg details */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-ink-50 divide-y divide-ink-50">
          {trip.legs.map((leg, i) => {
            const prevLeg       = trip.legs[i - 1]
            const isTransit     = leg.mode !== 'foot'
            const prevIsTransit = i > 0 && prevLeg.mode !== 'foot'
            const waitMins      = (isTransit && prevIsTransit)
              ? transferWaitMins(prevLeg, leg)
              : null

            return (
              <div key={i}>
                {isTransit && prevIsTransit && <TransferBadge waitMins={waitMins} />}
                {leg.mode === 'foot'
                  ? <WalkingLeg leg={leg} />
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
