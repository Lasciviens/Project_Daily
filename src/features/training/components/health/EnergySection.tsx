import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHourlyBuckets, computeBasalEnergyDailySeries } from '../../healthAggregate'
import { todayStr, shiftDateStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
import { PeriodToggle, type Period } from './PeriodToggle'
import { DateNav } from './DateNav'
import { rangeForAnchor, stepAnchor, labelForAnchor } from './dateNav'
import { useAnchorDate } from './useAnchorDate'
import { MetricMiniGrid } from './MetricMiniGrid'
import { ENERGY_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function EnergySection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useAnchorDate()

  // Headline follows the anchor (whichever day is selected), not always the
  // literal calendar today — basal fetches one extra buffer day before it so
  // computeBasalEnergyDailySeries has a reference rate for gap-filling.
  const { data: anchorActive = [], isLoading } = useHealthMetricSeries('active_energy', anchor, anchor)
  const { data: anchorBasalBuffered = [] } = useHealthMetricSeries('basal_energy_burned', shiftDateStr(anchor, -1), anchor)
  const activeToday = Math.round(computeDailySeries('active_energy', anchorActive)[0]?.value ?? 0)
  const basalToday = Math.round(computeBasalEnergyDailySeries(anchorBasalBuffered, [anchor])[0]?.value ?? 0)

  const { from, to } = rangeForAnchor(period, anchor)
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', from, to)
  const { data: basalPointsBuffered = [] } = useHealthMetricSeries('basal_energy_burned', shiftDateStr(from, -1), to)

  let chartData: { label: string; date?: string; active: number; basal: number }[]
  if (period === 'day') {
    const a = computeHourlyBuckets('active_energy', activePoints)
    const b = computeHourlyBuckets('basal_energy_burned', basalPointsBuffered.filter(p => p.date === from))
    chartData = a.map((row, i) => ({ label: row.label, active: Math.round(row.value), basal: Math.round(b[i]?.value ?? 0) }))
  } else {
    const a = computeDailySeries('active_energy', activePoints)
    const b = computeBasalEnergyDailySeries(basalPointsBuffered, datesBetweenStr(from, to))
    const byDate = new Map<string, { label: string; date: string; active: number; basal: number }>()
    for (const d of a) byDate.set(d.date, { label: fmtDay(d.date), date: d.date, active: Math.round(d.value), basal: 0 })
    for (const d of b) {
      const row = byDate.get(d.date) ?? { label: fmtDay(d.date), date: d.date, active: 0, basal: 0 }
      row.basal = Math.round(d.value)
      byDate.set(d.date, row)
    }
    chartData = [...byDate.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([, v]) => v)
  }

  function handleBarClick(barData: { payload?: { date?: string } }) {
    const date = barData?.payload?.date
    if (period !== 'day' && date) { setPeriod('day'); setAnchor(date) }
  }

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            🔥 Energy {anchor === today ? 'Today' : `· ${labelForAnchor('day', anchor)}`}
          </p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : (activeToday + basalToday).toLocaleString('en-GB')} <span className="text-sm font-normal text-ink-400">kcal</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-lg font-bold text-rose-500">{activeToday}</p>
            <p className="text-[10px] text-ink-400">active</p>
          </div>
          <div>
            <p className="text-lg font-bold text-ink-500">{basalToday}</p>
            <p className="text-[10px] text-ink-400">basal</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateNav
          label={labelForAnchor(period, anchor)}
          onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
          canGoNext={anchor !== today}
          value={anchor}
          onPick={setAnchor}
        />
        <PeriodToggle value={period} onChange={p => { setPeriod(p); setAnchor(today) }} />
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip cursor={false} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="basal" name="Basal" stackId="e" fill="#94a3b8" radius={[0, 0, 0, 0]}
              cursor={period !== 'day' ? 'pointer' : 'default'} onClick={handleBarClick}
            />
            <Bar
              dataKey="active" name="Active" stackId="e" fill="#f43f5e" radius={[3, 3, 0, 0]}
              cursor={period !== 'day' ? 'pointer' : 'default'} onClick={handleBarClick}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Nutrition" metrics={ENERGY_EXTRA_METRICS} />
    </div>
  )
}
