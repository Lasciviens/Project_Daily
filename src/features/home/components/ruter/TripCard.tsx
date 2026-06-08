import { TRANSPORT_ICON, TRANSPORT_COLOR, type TripPattern, type TripLeg } from '../../api/ruterApi'
import { minsUntil, fmtTime, fmtDuration, fmtDistance } from './transitUtils'

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

// ─── Component ────────────────────────────────────────────────────────────────

export function TripCard({ trip, now, isBest = false }: TripCardProps) {
  const mins   = minsUntil(trip.departure, now)
  const isPast = mins < -2
  const isNow  = mins <= 0 && !isPast

  return (
    <div className={`border rounded-xl shadow-sm overflow-hidden transition-shadow duration-150 hover:shadow-md ${
      isPast ? 'opacity-50 border-ink-100' : isBest ? 'border-accent-300' : 'border-ink-200'
    }`}>
      {/* Header */}
      <div className={`px-3 py-2 border-b ${isBest ? 'bg-accent-50 border-accent-100' : 'bg-cream-50 border-ink-100'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {isBest && (
              <span className="text-[10px] font-semibold text-accent-600 uppercase tracking-wide bg-accent-100 px-1.5 py-0.5 rounded">
                Best
              </span>
            )}
            <span className={`text-sm font-semibold ${
              isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-800'
            }`}>
              {isPast ? 'Departed' : isNow ? 'Departing now' : `Leave in ${mins} min`}
            </span>
            <span className="text-xs text-ink-400">{fmtDuration(trip.duration)}</span>
            {trip.walkDistance > 100 && (
              <span className="text-xs text-ink-400">{fmtDistance(trip.walkDistance)} walk</span>
            )}
          </div>
          <span className="text-xs text-ink-400 flex-shrink-0">arr {fmtTime(trip.arrival)}</span>
        </div>
      </div>

      {/* Legs */}
      <div className="px-3 divide-y divide-ink-50">
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
    </div>
  )
}
