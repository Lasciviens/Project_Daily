import { useChartColors } from '../../../shared/ui'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { HealthTrendChart, type TrendPoint } from '../components/HealthTrendChart'
import { fmtDayMonth } from '../components/healthFormat'
import { daysBetween, type EnergyReport } from './energyBalance'

/** The weigh-ins as a plain line (no dot per reading) and the fitted trend
 *  line the pace comes from, with the goal weight when it's in view. */
export function WeightTrendChart({ r, from, to, goalKg }: { r: EnergyReport; from: string; to: string; goalKg: number | null }) {
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
    data.push({ label: fmtDayMonth(d), date: d, kg: p?.kg ?? null, trend: fit })
  }
  if (!r.weight.series.length) return <p className="py-6 text-center text-meta text-fg-muted">No weigh-ins in this window.</p>
  const values = r.weight.series.map(p => p.kg)
  const showGoal = goalKg != null && goalKg >= Math.min(...values) - 3 && goalKg <= Math.max(...values) + 3
  return (
    <HealthTrendChart data={data} unit="kg" height={170} formatValue={v => v.toFixed(1)}
      ariaLabel="Weigh-ins with the fitted trend line"
      refLines={showGoal ? [{ y: goalKg, label: `Goal ${goalKg} kg` }] : undefined}
      series={[
        { key: 'kg', label: 'weigh-in', color: c.series[1], kind: 'line', plain: true, connectNulls: true },
        { key: 'trend', label: 'trend', color: c.neutral, kind: 'line', dashed: true, connectNulls: true },
      ]} />
  )
}
