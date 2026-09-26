import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, Footprints } from 'lucide-react'
import { TRANSPORT_ICON, type TripPattern, type TripLeg } from '../../api/ruterApi'
import { cx } from '../../../../shared/ui'
import { fmtTime, fmtDuration, fmtDistance, lineStyle, modeFallbackStyle, situationTone } from './transitUtils'

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

function LineBadge({ leg }: { leg: TripLeg }) {
  if (!leg.line) return null
  const style = lineStyle(leg.lineColour, leg.lineTextColour)
  const hasSituation = (leg.situations?.length ?? 0) > 0
  return (
    <span className="relative inline-flex flex-shrink-0">
      <span
        className="inline-flex items-center justify-center text-micro font-bold px-2 py-0.5 rounded min-w-[1.75rem] leading-tight"
        style={style ?? modeFallbackStyle(leg.mode)}
      >
        {leg.line}
      </span>
      {/* Visible even collapsed — tap the row to expand and read the alert */}
      {hasSituation && (
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-danger border border-surface" title="Service alert on this line" />
      )}
    </span>
  )
}

function WalkChip({ leg }: { leg: TripLeg }) {
  const mins = Math.round(leg.duration / 60)
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-2 py-0.5 text-micro tabular-nums text-fg-muted">
      <Footprints aria-label="Walk" className="h-3 w-3" /> {mins}m
    </span>
  )
}

// Compact horizontal journey summary: badges + walk chips
function JourneySummaryStrip({ legs }: { legs: TripLeg[] }) {
  const items: { key: string; el: ReactNode }[] = []
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
          {idx > 0 && <span className="text-fg-faint text-micro select-none">›</span>}
          {item.el}
        </span>
      ))}
    </div>
  )
}

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
            <span className="text-meta font-medium text-fg truncate">
              {TRANSPORT_ICON[leg.mode] ?? '🚐'} towards {leg.destination}
            </span>
          )}
          {leg.realtime && (
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block flex-shrink-0" title="Realtime" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-meta text-fg-muted flex-wrap">
          {leg.departure && (
            <span className={delayed ? 'text-warn' : ''}>
              {delayed && leg.aimed && (
                <span className="line-through text-fg-faint mr-1 font-normal">{fmtTime(leg.aimed)}</span>
              )}
              dep {fmtTime(leg.departure)}
            </span>
          )}
          {leg.arrivalTime && (
            <span>arr {fmtTime(leg.arrivalTime)}</span>
          )}
          {leg.quayCode && (
            <span className="bg-surface-2 px-1.5 py-0.5 rounded text-micro">
              Platform {leg.quayCode}{leg.quayDescription ? ` · ${leg.quayDescription}` : ''}
            </span>
          )}
        </div>
        {/* Live disruption/alert for this line — e.g. "Cancelled today" */}
        {leg.situations && leg.situations.length > 0 && (
          <div data-tone={situationTone(leg.situations[0].severity)} className="tone-soft tone-text mt-1 flex items-start gap-1 rounded px-1.5 py-0.5 text-micro">
            <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{leg.situations[0].summary}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function WalkLeg({ leg }: { leg: TripLeg }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-meta text-fg-muted">
      <Footprints aria-hidden className="h-4 w-5 shrink-0 text-fg-faint" />
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
      <div className="flex-1 border-t border-dashed border-line" />
      <span className="text-micro font-medium text-fg-faint uppercase tracking-wider flex-shrink-0">
        {waitMins !== null ? `${waitMins} min transfer` : 'Transfer'}
      </span>
      <div className="flex-1 border-t border-dashed border-line" />
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
    <div className={cx(
      'overflow-hidden rounded-row border transition-shadow duration-150',
      isPast ? 'border-line opacity-40' : isBest ? 'border-accent-500/40' : 'border-line',
    )}>
      {/* Summary row — tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="min-h-[52px] w-full bg-surface px-3 pb-2.5 pt-3 text-left"
      >
        {/* "Leave in X" is the one number a user glances at first — a bare bold
            time (no label) read ambiguously as duration/arrival/etc, so it's
            explicit now, and de-emphasized (was the same bold size as the
            arrival time, competing for attention rather than leading it). */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-body font-semibold flex-shrink-0 ${
            isNow ? 'text-danger' : isPast ? 'text-fg-muted' : 'text-accent-700'
          }`}>
            {isBest && <span className="mr-1.5 rounded bg-accent-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider text-accent-600">Best</span>}
            {isNow ? 'Leaving now' : diffMin <= 90 ? `Leave in ${diffMin} min` : `Leave at ${fmtTime(trip.departure)}`}
          </span>
          <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform duration-150', expanded && 'rotate-180')} />
        </div>

        {/* Departure/arrival times + duration — secondary detail, smaller */}
        <div className="flex items-center gap-2 mb-1.5 text-meta text-fg-muted tabular-nums">
          <span>{fmtTime(trip.departure)}</span>
          <span className="text-fg-faint">→</span>
          <span>{fmtTime(trip.arrival)}</span>
          <span className="text-fg-faint">·</span>
          <span>{durationMin} min</span>
          {transfers > 0 && (
            <>
              <span className="text-fg-faint">·</span>
              <span>{transfers} transfer{transfers !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {/* Journey strip: line badges + walk chips */}
        <JourneySummaryStrip legs={trip.legs} />
      </button>

      {/* Expandable leg details */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-line bg-surface divide-y divide-line">
          <p className="section-label pb-1 pt-2">Journey details</p>
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
