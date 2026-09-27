import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { todayStr, shiftDateStr } from '../../../shared/utils/dateUtils'
import { collapsedPoints } from '../healthAggregate'
import { getAggregationType } from '../healthMetrics'
import { baselineDeviation, type DayValue } from '../healthWindowStats'
import { useHealthDaily } from '../hooks/useHealthExport'
import type { HealthMetric, LatestHealthValue } from '../api/healthApi'
import { miniCardSummary } from './miniCardSummary'
import { MiniCardHistory } from './MiniCardHistory'
import { fmtDayMonth } from './healthFormat'
import type { MiniMetricConfig, MiniMetricWindow } from './miniMetrics'

interface Props {
  config: MiniMetricConfig
  window: MiniMetricWindow
  /** This metric's points / daily values in the window (from the grid's one batch read). */
  points: readonly HealthMetric[]
  daily: readonly DayValue[]
  latest: LatestHealthValue | null | undefined
  onViewDay?: (date: string) => void
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function MetricMiniCard({ config, window, points, daily, latest, onViewDay }: Props) {
  const { metric, title, unit, decimals, description, showTodayCount, showTodayTimes, deviation } = config
  const [open, setOpen] = useState(false)
  const isLatest = getAggregationType(metric) === 'latest'
  // A one-day window has no trend to expand into; point-in-time metrics
  // always can (their history is the last year of readings).
  const canExpand = isLatest || window.from !== window.to
  const summary = miniCardSummary(getAggregationType(metric), daily, latest, window, todayStr())
  const displayUnit = latest?.unit || points.find(p => p.unit)?.unit || unit

  // Counts and times come from the COLLAPSED rows the total is made of — a
  // re-delivered hour used to print "4× that day" for two brushings (H-14).
  const dayRows = (showTodayCount || showTodayTimes) ? collapsedPoints(metric, points.filter(p => p.date === window.to) as HealthMetric[]) : []
  const dayTimes = showTodayTimes ? [...new Set(dayRows.map(p => clock(p.recorded_at)))].sort() : []

  return (
    <div className="flex flex-col rounded-row border border-line bg-surface">
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-1">
          <p className="section-label flex items-center gap-1 leading-tight">
            {title}
            <InfoBubble label={`About ${title}`}>{description}</InfoBubble>
          </p>
          <span className="shrink-0 text-micro font-normal text-fg-faint">
            {summary.label}{summary.days ? ` · ${summary.days}d` : ''}
          </span>
        </div>
        {deviation
          ? <DeviationValue metric={metric} upTo={window.to} unit={displayUnit} decimals={decimals} fallback={summary.value} />
          : (
            <p className="text-head font-bold leading-tight tabular-nums text-fg">
              {summary.value != null ? summary.value.toFixed(decimals) : '—'}
              {summary.value != null && <span className="ml-1 text-meta font-normal text-fg-muted">{displayUnit}</span>}
            </p>
          )}
        {summary.latestDate && summary.latestDate !== window.to && (
          <p className="text-micro font-normal text-fg-faint">from {fmtDayMonth(summary.latestDate)}</p>
        )}
        {showTodayCount && dayRows.length > 0 && (
          <p className="text-meta font-semibold text-fg-2">{dayRows.length}× {window.from === window.to ? 'that day' : `on ${fmtDayMonth(window.to)}`}</p>
        )}
        {dayTimes.length > 0 && <p className="text-micro font-normal tabular-nums text-fg-muted">{dayTimes.join(', ')}</p>}
      </div>
      {canExpand && <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-1 border-t border-line px-3 text-micro font-semibold text-accent-600"
      >
        <ChevronDown aria-hidden className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide history' : isLatest ? 'History (last year)' : 'History'}
      </button>}
      {open && canExpand && (
        <div className="px-3 pb-3">
          <MiniCardHistory metric={metric} title={title} unit={displayUnit} decimals={decimals}
            window={window} daily={daily} isLatest={isLatest} onViewDay={onViewDay} />
        </div>
      )}
    </div>
  )
}

// Wrist temperature: the newest night against the median of the 60 before it.
// Values already under ±5 are taken to be deviations as exported.
function DeviationValue({ metric, upTo, unit, decimals, fallback }: {
  metric: string; upTo: string; unit: string; decimals: number; fallback: number | null
}) {
  const { data = [] } = useHealthDaily(metric, shiftDateStr(upTo, -61), upTo)
  const last = data[data.length - 1]
  if (last && Math.abs(last.value) < 5) {
    return <Signed value={last.value} unit={unit} decimals={decimals} sub="vs your baseline" />
  }
  const d = baselineDeviation(data, upTo, { lookbackDays: 60, minPoints: 5 })
  if (!d) {
    return (
      <p className="text-head font-bold leading-tight tabular-nums text-fg">
        {fallback != null ? fallback.toFixed(decimals) : '—'}
        {fallback != null && <span className="ml-1 text-meta font-normal text-fg-muted">{unit} · too few nights for a baseline</span>}
      </p>
    )
  }
  return <Signed value={d.deviation} unit={unit} decimals={decimals}
    sub={`${d.value.toFixed(decimals)} ${unit} vs usual ${d.baseline.toFixed(decimals)} (${d.n} nights)`} />
}

function Signed({ value, unit, decimals, sub }: { value: number; unit: string; decimals: number; sub: string }) {
  const r = Number(value.toFixed(decimals))
  return (
    <div>
      <p className="text-head font-bold leading-tight tabular-nums text-fg">
        {r > 0 ? '+' : r < 0 ? '−' : '±'}{Math.abs(r).toFixed(decimals)}
        <span className="ml-1 text-meta font-normal text-fg-muted">{unit}</span>
      </p>
      <p className="text-micro font-normal text-fg-muted">{sub}</p>
    </div>
  )
}
