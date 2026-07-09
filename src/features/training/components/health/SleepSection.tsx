import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeSleepSummary } from '../../healthAggregate'
import { todayStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
import { DateNav } from './DateNav'
import { rangeForAnchor, stepAnchor, labelForAnchor } from './dateNav'
import { useAnchorDate } from './useAnchorDate'
import { MetricMiniGrid } from './MetricMiniGrid'
import { SLEEP_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

function fmtHrs(h: number): string {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}h ${mins}m`
}

const STAGES = [
  { key: 'deep' as const, label: 'Deep',  color: '#4338ca' },
  { key: 'core' as const, label: 'Core',  color: '#6366f1' },
  { key: 'rem'  as const, label: 'REM',   color: '#a5b4fc' },
  { key: 'awake' as const, label: 'Awake', color: '#f87171' },
]

type TrendPeriod = 'week' | 'month'

export function SleepSection() {
  const today = todayStr()
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('week')
  const [anchor, setAnchor] = useAnchorDate()
  const { from, to } = rangeForAnchor(trendPeriod, anchor)
  const { data: points = [], isLoading } = useHealthMetricSeries('sleep_analysis', from, to)
  const summary = computeSleepSummary(points)
  const last = summary[summary.length - 1]

  // Left-join onto every date in range so a night with no synced data still
  // shows as a gap on the axis instead of silently disappearing.
  const summaryByDate = new Map(summary.map(s => [s.date, s]))
  const chartData = datesBetweenStr(from, to).map(date => {
    const s = summaryByDate.get(date)
    return { label: fmtDay(date), total: s ? Math.round(s.total * 10) / 10 : null }
  })

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">😴 Last Night's Sleep</p>
        <p className="text-3xl font-bold text-ink-900 leading-tight">
          {isLoading ? '…' : last ? fmtHrs(last.total) : '—'}
        </p>
      </div>

      {last && (
        <>
          <div className="h-4 rounded-full overflow-hidden flex w-full bg-ink-100">
            {STAGES.map(s => {
              const val = last[s.key]
              const pct = last.total > 0 ? (val / last.total) * 100 : 0
              return pct > 0 ? (
                <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} title={`${s.label}: ${fmtHrs(val)}`} />
              ) : null
            })}
          </div>
          <div className="flex gap-3 flex-wrap">
            {STAGES.map(s => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-ink-500">{s.label}</span>
                <span className="font-semibold text-ink-800">{fmtHrs(last[s.key])}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateNav
          label={labelForAnchor(trendPeriod, anchor)}
          onPrev={() => setAnchor(a => stepAnchor(trendPeriod, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(trendPeriod, a, 1))}
          canGoNext={anchor !== today}
          value={anchor}
          onPick={setAnchor}
        />
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {(['week', 'month'] as TrendPeriod[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => { setTrendPeriod(p); setAnchor(today) }}
              className={`px-2.5 min-h-[28px] rounded-md text-[11px] font-semibold transition-colors ${
                trendPeriod === p ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {p === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={trendPeriod === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip cursor={false} formatter={(v) => [`${v} hr`, 'Total sleep']} />
            <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Sleep Extras" metrics={SLEEP_EXTRA_METRICS} />
    </div>
  )
}
