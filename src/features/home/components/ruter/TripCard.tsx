import { TRANSPORT_ICON, TRANSPORT_COLOR, type TripPattern, type TripLeg } from '../../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripCardProps {
  trip: TripPattern
  now:  number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minsUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

function fmtDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`
}

function isDelayed(leg: TripLeg): boolean {
  if (!leg.aimed || !leg.departure) return false
  return Math.abs(new Date(leg.departure).getTime() - new Date(leg.aimed).getTime()) > 60_000
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LineBadge({ line, mode }: { line: string; mode: string }) {
  const colorClass = TRANSPORT_COLOR[mode] ?? 'bg-ink-100 text-ink-700'
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${colorClass}`}>
      {line}
    </span>
  )
}

function RealtimeDot({ realtime }: { realtime: boolean | undefined }) {
  if (realtime === undefined) return null
  return realtime
    ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block flex-shrink-0" title="Realtime" />
    : <span className="text-ink-300 text-xs flex-shrink-0" title="Scheduled">~</span>
}

function LegRow({ leg }: { leg: TripLeg }) {
  const icon = TRANSPORT_ICON[leg.mode] ?? '🚐'
  const delayed = isDelayed(leg)

  if (leg.mode === 'foot') {
    return (
      <div className="flex items-start gap-2 py-1.5">
        <span className="text-sm w-5 text-center flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs text-ink-600">Walk to {leg.to}</span>
        </div>
        <span className="text-xs text-ink-400 flex-shrink-0">
          {fmtDuration(leg.duration)} · {fmtDistance(leg.distance)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-sm w-5 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {leg.line && <LineBadge line={leg.line} mode={leg.mode} />}
          {leg.destination && (
            <span className="text-xs text-ink-700 truncate">{leg.destination}</span>
          )}
          <RealtimeDot realtime={leg.realtime} />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {leg.departure && (
            <>
              {delayed && leg.aimed && (
                <span className="text-[10px] text-ink-300 line-through">{fmtTime(leg.aimed)}</span>
              )}
              <span className={`text-[10px] ${delayed ? 'text-orange-500' : 'text-ink-400'}`}>
                dep {fmtTime(leg.departure)}
              </span>
            </>
          )}
          {(leg.quayCode || leg.quayDescription) && (
            <span className="text-[10px] text-ink-400">
              {leg.quayCode && `Platform ${leg.quayCode}`}
              {leg.quayCode && leg.quayDescription && ' · '}
              {leg.quayDescription}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TripCard({ trip, now }: TripCardProps) {
  const mins    = minsUntil(trip.departure, now)
  const isPast  = mins < -2
  const isNow   = mins <= 0 && !isPast

  return (
    <div className={`border border-ink-200 rounded-xl shadow-sm overflow-hidden transition-shadow duration-150 hover:shadow-md ${isPast ? 'opacity-50' : ''}`}>
      {/* Header */}
      <div className="px-3 py-2 bg-cream-50 border-b border-ink-100">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isNow ? 'text-red-500' : mins <= 2 ? 'text-orange-500' : 'text-ink-800'}`}>
            {isPast ? 'Departed' : isNow ? 'Departing now' : `Departs in ${mins} min`}
          </span>
          <span className="text-ink-300 text-xs">·</span>
          <span className="text-xs text-ink-500">{fmtDuration(trip.duration)} total</span>
          {trip.walkDistance > 100 && (
            <>
              <span className="text-ink-300 text-xs">·</span>
              <span className="text-xs text-ink-400">{fmtDistance(trip.walkDistance)} walk</span>
            </>
          )}
        </div>
      </div>

      {/* Legs */}
      <div className="px-3 divide-y divide-ink-50">
        {trip.legs.map((leg, i) => {
          const isTransitLeg   = leg.mode !== 'foot'
          const prevIsTransit  = i > 0 && trip.legs[i - 1].mode !== 'foot'
          const showTransfer   = isTransitLeg && prevIsTransit

          return (
            <div key={i}>
              {showTransfer && (
                <div className="py-1 text-center">
                  <span className="text-[10px] text-ink-300 uppercase tracking-wide">transfer</span>
                </div>
              )}
              <LegRow leg={leg} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
