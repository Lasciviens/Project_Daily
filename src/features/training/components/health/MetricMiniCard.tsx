import { useState } from 'react'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'
import { getAggregationType } from '../../healthMetrics'
import { BarLineChart } from './BarLineChart'
import type { Period } from './PeriodToggle'
import { ChevronDown } from 'lucide-react'
import { useChartColors } from '../../../../shared/ui'

export interface MiniMetricConfig {
  metric: string
  title: string
  unit: string
  decimals: number
  description: string
  // Shows how many raw events were logged on the viewed day alongside the main
  // value — for metrics where "how many times" matters as much as the total
  // (e.g. toothbrushing).
  showTodayCount?: boolean
  // Lists the time-of-day of each occurrence on the viewed day (e.g.
  // "08:44, 23:03") — for metrics where WHEN it happened is useful.
  showTodayTimes?: boolean
}

export interface MiniMetricWindow {
  from: string
  to: string
  period: Period
}

// What number this card puts on screen, for the window the Health tab's own
// date control currently has selected.
//
// This used to be hardcoded to the last 7 days ending TODAY, so the card sat
// frozen while the page's date/period control moved underneath it — a real
// complaint ("ya sabit ya yanlış"). Everything below is now derived from the
// selected window, and the window label says which one it is rather than
// always claiming "7-day avg".
interface Summary {
  value: number | null
  windowLabel: string
  days?: number
  latestDate?: string
}

function summarize(metric: string, series: { date: string; value: number }[], window: MiniMetricWindow): Summary {
  const aggType = getAggregationType(metric)
  const isDay = window.period === 'day'

  if (aggType === 'latest') {
    const last = series[series.length - 1]
    return { value: last?.value ?? null, windowLabel: 'Latest', latestDate: last?.date }
  }
  if (isDay) {
    const d = series.find(x => x.date === window.to)
    return { value: d?.value ?? null, windowLabel: 'That day' }
  }
  // A cumulative metric over a multi-day window reads as a per-day average,
  // not a window total — "18,400 stand-minutes this month" means nothing next
  // to a daily goal. Days with no row are excluded rather than counted as a
  // zero that would drag the mean down.
  const days = series.filter(d => d.value != null)
  const value = days.length ? days.reduce((s, d) => s + d.value, 0) / days.length : null
  return { value, windowLabel: aggType === 'sum' ? 'Daily avg' : 'Avg', days: days.length }
}

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function MetricMiniCard({ config, window }: { config: MiniMetricConfig; window: MiniMetricWindow }) {
  const { metric, title, unit, decimals, description, showTodayCount, showTodayTimes } = config
  const [open, setOpen] = useState(false)
  const c = useChartColors()
  const { data: points = [] } = useHealthMetricSeries(metric, window.from, window.to)
  const series = computeDailySeries(metric, points)
  const { value, windowLabel, days, latestDate } = summarize(metric, series, window)
  const displayUnit = points.find(p => p.unit)?.unit || unit
  const dayPoints = (showTodayCount || showTodayTimes) ? points.filter(p => p.date === window.to) : []
  const dayCount = showTodayCount ? dayPoints.length : null
  const dayTimes = showTodayTimes
    ? dayPoints
        .map(p => new Date(p.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        .sort()
    : null

  const chartData = series.map(d => ({
    label: fmtDay(d.date),
    value: Math.round(d.value * 10 ** decimals) / 10 ** decimals,
  }))
  // A one-point chart is a dot with no trend in it — nothing to expand into.
  const canExpand = chartData.length > 1

  return (
    <div className="flex flex-col rounded-row border border-line bg-surface">
      {/* The whole header is the expand target when there's a trend to show,
          which keeps the tap area well past 44px without a separate control
          crowding a card this small. */}
      <button
        type="button"
        onClick={() => canExpand && setOpen(o => !o)}
        aria-expanded={canExpand ? open : undefined}
        disabled={!canExpand}
        className={`flex min-h-[44px] flex-col gap-1.5 rounded-row p-3 text-left ${canExpand ? 'cursor-pointer transition-transform active:scale-[0.99]' : 'cursor-default'}`}
      >
        {/* Stacked below sm: in the 2-column phone grid the title wraps to two
            lines while the window badge stays pinned to line 1, leaving a
            ragged notch. Side-by-side from sm, where the title fits one line. */}
        <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-1">
          <p className="section-label leading-tight">{title}</p>
          <span className="shrink-0 text-micro font-normal text-fg-faint">
            {windowLabel}{days != null && days > 0 ? ` · ${days}d` : ''}
          </span>
        </div>
        <p className="text-head font-bold leading-tight tabular-nums text-fg">
          {value != null ? value.toFixed(decimals) : '—'}
          {/* No stray unit next to an em dash when the metric has no data. */}
          {value != null && <span className="ml-1 text-meta font-normal text-fg-muted">{displayUnit}</span>}
        </p>
        {latestDate && latestDate !== window.to && (
          <p className="text-micro font-normal text-fg-faint">from {fmtDay(latestDate)}</p>
        )}
        {dayCount != null && dayCount > 0 && (
          <p className="text-meta font-semibold text-fg-2">{dayCount}× that day</p>
        )}
        {dayTimes != null && dayTimes.length > 0 && (
          <p className="text-micro font-normal tabular-nums text-fg-muted">{dayTimes.join(', ')}</p>
        )}
        <p className="text-micro font-normal leading-snug text-fg-muted">{description}</p>
        {canExpand && (
          <span className="flex items-center gap-1 text-micro font-semibold text-accent-600">
            <ChevronDown aria-hidden className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? 'Hide history' : `History (${chartData.length} days)`}
          </span>
        )}
      </button>
      {open && canExpand && (
        <div className="-mt-1 flex flex-col gap-1 px-3 pb-3">
          <BarLineChart data={chartData} dataKey="value" color={c.series[1]} unit={displayUnit} tooltipLabel={title} />
          {value != null && (
            <p className="text-micro font-normal text-fg-muted">
              {windowLabel} over {fmtDay(window.from)} – {fmtDay(window.to)}:{' '}
              <span className="font-semibold tabular-nums text-fg-2">{value.toFixed(decimals)} {displayUnit}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
