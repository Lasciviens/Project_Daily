import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHourlyBuckets } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { HealthRange } from './sectionTypes'
import { rangeForAnchor, labelForAnchor } from './dateNav'
import { compactAxisTick } from './axisFormat'
import { useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../chartKit'
import { HeadlineStat, SectionCard } from './sectionKit'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function EnergySection({ range }: { range: HealthRange }) {
  const today = todayStr()
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()

  const isDay = period === 'day'
  // Measured values only — no synthetic top-up for a Watch-off hour (e.g. the
  // Watch charging through the morning). Basal energy is continuous by
  // definition, so an hour with no row is a real measurement gap, not a
  // zero — summing only the hours that exist and printing it as "basal"
  // would state a partial number as a whole-day one, so the coverage is
  // shown next to the value instead (see basalCoverage below).
  const { data: anchorActive = [], isLoading } = useHealthMetricSeries('active_energy', anchor, anchor)
  const { data: anchorBasal = [] } = useHealthMetricSeries('basal_energy_burned', anchor, anchor)
  const activeToday = Math.round(computeDailySeries('active_energy', anchorActive)[0]?.value ?? 0)
  const basalToday = Math.round(computeDailySeries('basal_energy_burned', anchorBasal)[0]?.value ?? 0)
  // Basal metabolic rate is continuous BY DEFINITION — you burn it every hour,
  // awake or asleep — so an hour with no row is a measurement gap, never a
  // real zero. Counting the hours that actually carry a value is what turns
  // "444 kcal" into the honest "444 kcal, 6 of 24 hours measured".
  const basalHoursCovered = computeHourlyBuckets('basal_energy_burned', anchorBasal)
    .filter(b => b.value > 0).length

  const { from, to } = rangeForAnchor(period, anchor)
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', from, to)
  const { data: basalPoints = [] } = useHealthMetricSeries('basal_energy_burned', from, to)

  let chartData: { label: string; date?: string; active: number; basal: number }[]
  if (period === 'day') {
    const a = computeHourlyBuckets('active_energy', activePoints)
    const b = computeHourlyBuckets('basal_energy_burned', basalPoints)
    chartData = a.map((row, i) => ({ label: row.label, active: Math.round(row.value), basal: Math.round(b[i]?.value ?? 0) }))
  } else {
    const a = computeDailySeries('active_energy', activePoints)
    const b = computeDailySeries('basal_energy_burned', basalPoints)
    const byDate = new Map<string, { label: string; date: string; active: number; basal: number }>()
    for (const d of a) byDate.set(d.date, { label: fmtDay(d.date), date: d.date, active: Math.round(d.value), basal: 0 })
    for (const d of b) {
      const row = byDate.get(d.date) ?? { label: fmtDay(d.date), date: d.date, active: 0, basal: 0 }
      row.basal = Math.round(d.value)
      byDate.set(d.date, row)
    }
    chartData = [...byDate.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([, v]) => v)
  }

  // Bar click only opens/updates the tooltip now (Tooltip's trigger="click")
  // — it no longer jumps straight to that day by itself. "See details"
  // inside the tooltip (rendered below) is the only thing that navigates,
  // so glancing at a day's numbers doesn't also navigate away from the
  // chart you were looking at.
  function goToDay(date?: string) {
    if (period !== 'day' && date) { setPeriod('day'); setAnchor(date) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  function EnergyTooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    const date: string | undefined = payload[0]?.payload?.date
    return (
      <div className={TOOLTIP_BOX}>
        <p className="font-medium text-fg-muted">{label}</p>
        {payload.map((p: { dataKey?: string; name?: string; color?: string; value?: number }) => (
          <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
            {p.value} kcal {p.name}
          </p>
        ))}
        {period !== 'day' && date && (
          <button type="button" onClick={() => goToDay(date)} className="flex min-h-[44px] items-center py-1.5 text-meta font-semibold text-accent-600">
            Go to this day →
          </button>
        )}
      </div>
    )
  }

  // Week/Month headline = daily averages over days that actually have data,
  // straight from chartData (same numbers the bars show, no extra queries).
  // Two exclusions, both about the same thing: a day whose numbers are not
  // finished yet must not drag the average down.
  //   1. TODAY is in progress by definition — at 09:00 it carries a few
  //      hundred kcal against a real day's ~2600, and averaging that in made
  //      the week/month headline read low every single time it was opened.
  //   2. MIN_COMPLETE_DAY_KCAL catches the same shape on a day that is over
  //      but under-delivered (the Watch off the wrist, a sync that never
  //      landed): basal alone is ~1600-2400 for this user, so a day totalling
  //      under this floor is a coverage gap, not a genuinely light day.
  // Both only narrow what the AVERAGE is computed from — every day still
  // renders its own real bar, nothing is hidden (NEVER_HIDES).
  const MIN_COMPLETE_DAY_KCAL = 1550
  const dataDays = !isDay
    ? chartData.filter(d => d.date !== today && d.active + d.basal > MIN_COMPLETE_DAY_KCAL)
    : []
  const avgActive = dataDays.length ? Math.round(dataDays.reduce((s, d) => s + d.active, 0) / dataDays.length) : 0
  const avgBasal = dataDays.length ? Math.round(dataDays.reduce((s, d) => s + d.basal, 0) / dataDays.length) : 0

  const headActive = isDay ? activeToday : avgActive
  const headBasal = isDay ? basalToday : avgBasal

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={<>Energy {isDay
            ? (anchor === today ? 'today' : `· ${labelForAnchor('day', anchor)}`)
            : period === 'week' ? '· weekly average' : '· monthly average'}</>}
          value={isLoading ? '…' : (headActive + headBasal).toLocaleString('en-GB')}
          unit={`kcal${!isDay ? ' /day' : ''}`}
        />
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-lead font-bold tabular-nums" style={{ color: c.series[3] }}>{headActive}</p>
            <p className="text-micro font-normal text-fg-muted">{isDay ? 'active' : 'avg active'}</p>
          </div>
          <div>
            <p className="text-lead font-bold tabular-nums text-fg-2">{headBasal}</p>
            <p className="text-micro font-normal text-fg-muted">{isDay ? 'basal' : 'avg basal'}</p>
            {/* Only on a real, incomplete day — never on a period average
                (where "hours covered" has no single meaning) and never on a
                fully-measured day (nothing to warn about). */}
            {isDay && !isLoading && basalHoursCovered > 0 && basalHoursCovered < 24 && (
              <p
                data-tone="warn"
                className="tone-text text-micro font-medium"
                title={`Basal energy is only recorded for ${basalHoursCovered} of 24 hours on this day — the rest has no measurement (typically the Watch off the wrist). The figure above is the measured hours only, never an estimate.`}
              >
                {basalHoursCovered}/24 h measured
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
            <Tooltip cursor={false} content={EnergyTooltipContent} wrapperStyle={{ pointerEvents: 'auto' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
            {/* maxBarSize: with a single day of data one stacked bar would
                otherwise span the whole plot area and read as a solid slab. */}
            <Bar
              dataKey="basal" name="Basal" stackId="e" fill={c.series[5]} radius={[0, 0, 0, 0]} activeBar={false}
              maxBarSize={28}
              cursor={period !== 'day' ? 'pointer' : 'default'}
            />
            <Bar
              dataKey="active" name="Active" stackId="e" fill={c.series[3]} radius={[3, 3, 0, 0]} activeBar={false}
              maxBarSize={28}
              cursor={period !== 'day' ? 'pointer' : 'default'}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}
