import { useChartColors } from '../../../shared/ui'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { HealthTrendChart, type TrendPoint } from '../components/HealthTrendChart'
import { fmtDayMonth } from '../components/healthFormat'
import { daysBetween, type CutReport } from './energyBalance'

/** Weigh-ins as dots, the 7-day average and the fitted trend line. */
export function CutWeightChart({ r, from, to, goalKg }: { r: CutReport; from: string; to: string; goalKg: number | null }) {
  const c = useChartColors()
  const byDate = new Map(r.weight.series.map(p => [p.date, p]))
  const end = shiftDateStr(to, 1)
  const slope = r.weight.slopeKgPerDay
  const last = r.weight.series[r.weight.series.length - 1]
  const data: TrendPoint[] = []
  for (let d = from; d <= end; d = shiftDateStr(d, 1)) {
    const p = byDate.get(d)
    // The fitted line, anchored at the current trend weight on the last weigh-in.
    const fit = slope != null && r.weight.currentTrendKg != null && last
      ? Math.round((r.weight.currentTrendKg + slope * daysBetween(last.date, d)) * 100) / 100 : null
    data.push({ label: fmtDayMonth(d), date: d, kg: p?.kg ?? null, avg7: p?.avg7 ?? null, trend: fit })
  }
  if (!r.weight.series.length) return <p className="py-6 text-center text-meta text-fg-muted">No weigh-ins in this window.</p>
  const values = r.weight.series.map(p => p.kg)
  const showGoal = goalKg != null && goalKg >= Math.min(...values) - 3
  return (
    <HealthTrendChart data={data} unit="kg" height={170} formatValue={v => v.toFixed(1)}
      ariaLabel="Weigh-ins with 7-day average and trend line"
      refLines={showGoal ? [{ y: goalKg, label: `Goal ${goalKg} kg` }] : undefined}
      series={[
        { key: 'kg', label: 'weigh-in', color: c.series[1], kind: 'line', dotsOnly: true },
        { key: 'avg7', label: '7-day average', color: c.series[1], kind: 'line', connectNulls: true },
        { key: 'trend', label: 'trend', color: c.neutral, kind: 'line', dashed: true, connectNulls: true },
      ]} />
  )
}
