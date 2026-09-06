import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { shiftStr } from './dateNav'
import { computeDailySeries } from '../../healthAggregate'
import { BarLineChart } from './BarLineChart'
import { MetricMiniGrid } from './MetricMiniGrid'
import { BODY_EXTRA_METRICS } from './miniMetrics'
import { BodyCompositionPanel } from './BodyCompositionPanel'

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
  icon: string
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

function BodyMiniChart({ title, icon, unit, color, series, decimals = 1, viewedDate }: MiniChartProps) {
  const chartData = series.map(d => ({ label: fmtDay(d.date), value: Math.round(d.value * 10 ** decimals) / 10 ** decimals }))
  const latestPoint = series[series.length - 1]
  const latest = latestPoint?.value
  const staleDays = latestPoint ? daysBetween(latestPoint.date, viewedDate) : null

  return (
    <div className="flex-1 min-w-[220px] flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{icon} {title}</p>
        <div className="text-right">
          <p className="text-sm font-bold text-ink-900">
            {latest != null ? latest.toFixed(decimals) : '—'} <span className="text-[10px] font-normal text-ink-400">{unit}</span>
          </p>
          {staleDays != null && staleDays >= STALE_AFTER_DAYS && (
            <p
              className="text-[10px] font-medium text-amber-600"
              title={`The last ${title.toLowerCase()} reading is from ${fmtDay(latestPoint!.date)} — ${staleDays} days before the day you're viewing. Nothing newer has synced.`}
            >
              {staleDays}d old
            </p>
          )}
        </div>
      </div>
      {chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-6 text-center">No data yet.</p>
      ) : (
        <BarLineChart data={chartData} dataKey="value" color={color} unit={unit} tooltipLabel={title} />
      )}
    </div>
  )
}

export function BodySection({ dateStr }: { dateStr: string }) {
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

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">⚖️ Body (last 90 days)</p>
      <div className="flex flex-wrap gap-5">
        <BodyMiniChart title="Weight" icon="⚖️" unit="kg" color="#7c3aed" series={weight} decimals={1} viewedDate={dateStr} />
        <BodyMiniChart title="Body Fat" icon="📏" unit="%" color="#f59e0b" series={fat} decimals={1} viewedDate={dateStr} />
        <BodyMiniChart title="BMI" icon="📐" unit="" color="#0ea5e9" series={bmi} decimals={1} viewedDate={dateStr} />
      </div>

      <MetricMiniGrid title="Lifestyle & Environment" metrics={BODY_EXTRA_METRICS} />

      <BodyCompositionPanel />
    </div>
  )
}
