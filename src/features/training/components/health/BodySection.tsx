import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { shiftStr, rangeForAnchor } from './dateNav'
import { computeDailySeries } from '../../healthAggregate'
import { BarLineChart } from './BarLineChart'
import { MetricMiniGrid } from './MetricMiniGrid'
import { BODY_EXTRA_METRICS } from './miniMetrics'
import { BodyCompositionPanel } from './BodyCompositionPanel'
import type { HealthRange } from './sectionTypes'
import { useChartColors } from '../../../../shared/ui'
import { SectionCard } from './sectionKit'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Whole calendar days between two 'yyyy-MM-dd' strings (b - a). Local-time
// construction (never a bare Date.parse of the string) so DST transitions
// can't shift the count by an hour into the wrong day.
function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00')
  const d2 = new Date(b + 'T00:00:00')
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000)
}

interface MiniChartProps {
  title: string
  unit: string
  color: string
  series: { date: string; value: number }[]
  decimals?: number
  /** The day Health's shared selector is currently showing — used only to
   *  judge staleness (see the amber note below), never to filter the series
   *  itself (the 90-day window already ends there). */
  viewedDate: string
}

// Real bug fixed: this metric's own aggType is 'latest' (a point-in-time
// reading, correct for a scale that only reports when you step on it) —
// but "latest" was rendered as the headline number with NO regard for how
// old it actually is. A scale that stops writing one specific metric (see
// BodySection's own header comment on the MovingLife/weight gap) still had
// its LAST real reading displayed as if it were current, day after day,
// with nothing distinguishing a fresh number from one that's weeks stale.
// Mirrors EnergySection's "N/24h measured" honesty pattern: never estimate,
// just say plainly when the number on screen isn't from today.
const STALE_AFTER_DAYS = 3

function BodyMiniChart({ title, unit, color, series, decimals = 1, viewedDate }: MiniChartProps) {
  const chartData = series.map(d => ({ label: fmtDay(d.date), value: Math.round(d.value * 10 ** decimals) / 10 ** decimals }))
  const latestPoint = series[series.length - 1]
  const latest = latestPoint?.value
  const staleDays = latestPoint ? daysBetween(latestPoint.date, viewedDate) : null

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="section-label">{title}</p>
        <div className="text-right">
          <p className="text-body font-bold tabular-nums text-fg">
            {latest != null ? latest.toFixed(decimals) : '—'} <span className="text-micro font-normal text-fg-muted">{unit}</span>
          </p>
          {staleDays != null && staleDays >= STALE_AFTER_DAYS && (
            <p
              data-tone="warn"
              className="tone-text text-micro font-medium"
              title={`The last ${title.toLowerCase()} reading is from ${fmtDay(latestPoint!.date)} — ${staleDays} days before the day you're viewing. Nothing newer has synced.`}
            >
              {staleDays}d old
            </p>
          )}
        </div>
      </div>
      {chartData.length === 0 ? (
        <p className="py-6 text-center text-body text-fg-muted">No data yet.</p>
      ) : (
        <BarLineChart data={chartData} dataKey="value" color={color} unit={unit} tooltipLabel={title} />
      )}
    </div>
  )
}

export function BodySection({ range }: { range: HealthRange }) {
  const dateStr = range.anchor
  // The mini cards follow the page's own date/period control; the weight
  // charts below keep their own wide 90-day window (see the comment there).
  const miniWindow = { ...rangeForAnchor(range.period, range.anchor), period: range.period }
  // Weight/body composition metrics are sparse, event-based (only update when
  // you step on the scale) — a wide window so charts aren't mostly empty.
  // The window ENDS at the day being viewed (Health's one shared day
  // selector) rather than always at today, so stepping back a day moves this
  // section with the rest of the page instead of ignoring the control.
  const to = dateStr
  const from = shiftStr(dateStr, -89)
  const { data: weightPoints = [] } = useHealthMetricSeries('weight_body_mass', from, to)
  const { data: fatPoints = [] } = useHealthMetricSeries('body_fat_percentage', from, to)
  const { data: bmiPoints = [] } = useHealthMetricSeries('body_mass_index', from, to)
  // Lean Mass mini-chart (Apple Health's lean_body_mass) removed on explicit
  // user request (2026-09-06) — the Smart Scale Reports panel below already
  // covers lean mass (and everything else) for the scale actually in use.

  const weight = computeDailySeries('weight_body_mass', weightPoints)
  const fat = computeDailySeries('body_fat_percentage', fatPoints)
  const bmi = computeDailySeries('body_mass_index', bmiPoints)
  const c = useChartColors()

  return (
    <SectionCard className="gap-4">
      <p className="section-label">Body (last 90 days)</p>
      <div className="flex flex-wrap gap-5">
        <BodyMiniChart title="Weight" unit="kg" color={c.series[1]} series={weight} decimals={1} viewedDate={dateStr} />
        <BodyMiniChart title="Body fat" unit="%" color={c.series[2]} series={fat} decimals={1} viewedDate={dateStr} />
        <BodyMiniChart title="BMI" unit="" color={c.series[0]} series={bmi} decimals={1} viewedDate={dateStr} />
      </div>

      <MetricMiniGrid title="Lifestyle & environment" metrics={BODY_EXTRA_METRICS} window={miniWindow} />

      <BodyCompositionPanel />
    </SectionCard>
  )
}
