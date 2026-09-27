import { useChartColors } from '../../../shared/ui'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useHealthDaily } from '../hooks/useHealthExport'
import { fillDays, type DayValue } from '../healthWindowStats'
import { HealthTrendChart } from './HealthTrendChart'
import { fmtAxisDay, fmtDayMonth } from './healthFormat'
import type { MiniMetricWindow } from './miniMetrics'

// A mini card's expanded history. Window metrics chart the page's own window
// (nulls = gaps); point-in-time metrics chart every reading of the last year,
// fetched only once the card is opened.

interface Props {
  metric: string
  title: string
  unit: string
  decimals: number
  window: MiniMetricWindow
  daily: readonly DayValue[]
  isLatest: boolean
  onViewDay?: (date: string) => void
}

export function MiniCardHistory({ metric, title, unit, decimals, window, daily, isLatest, onViewDay }: Props) {
  const c = useChartColors()
  const yearFrom = shiftDateStr(window.to, -364)
  const year = useHealthDaily(metric, yearFrom, window.to, { enabled: isLatest })
  const fmt = (v: number) => v.toFixed(decimals)

  const data = isLatest
    ? (year.data ?? []).map(d => ({ label: fmtDayMonth(d.date), date: d.date, value: d.value }))
    : fillDays(daily, window.from, window.to).map(d => ({ label: fmtAxisDay(d.date), date: d.date, value: d.value }))

  if (isLatest && year.isLoading) return <p className="py-3 text-center text-meta text-fg-muted">Loading…</p>
  if (data.filter(d => d.value != null).length < 2) {
    return <p className="py-3 text-center text-meta text-fg-muted">Not enough readings for a trend yet.</p>
  }
  return (
    <HealthTrendChart
      data={data}
      series={[{ key: 'value', label: title, color: c.series[1], kind: 'line', connectNulls: isLatest }]}
      unit={unit}
      ariaLabel={`${title} history`}
      height={120}
      formatValue={fmt}
      onViewDay={onViewDay}
    />
  )
}
