import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { DateInput } from '../../../../shared/components/DateInput'
import { useHealthMetricSeries, useAddManualSleep } from '../../hooks/useHealthExport'
import { computeSleepSummary, estimateSleepStageProportions } from '../../healthAggregate'
import { todayStr, daysAgoStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
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

function makeSleepTooltipContent(sourcesByDate: Map<string, Set<string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  return function TooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    const point = payload[0]
    const date: string | undefined = point?.payload?.date
    const sources = date ? sourcesByDate.get(date) : null
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs space-y-0.5">
        <p className="text-ink-400 font-medium">{label}</p>
        <p className="font-semibold text-indigo-600">{point.value != null ? `${point.value} hr` : '—'}</p>
        {sources && sources.size > 0 && (
          <p className="text-ink-400">{[...sources].join(', ')}</p>
        )}
      </div>
    )
  }
}

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
    return { label: fmtDay(date), date, total: s ? Math.round(s.total * 10) / 10 : null }
  })

  // Shown in the trend chart's tooltip so it's clear which nights are
  // Watch-tracked vs manually logged.
  const sourcesByDate = new Map<string, Set<string>>()
  for (const p of points) {
    const set = sourcesByDate.get(p.date) ?? new Set<string>()
    set.add(p.source === 'manual' ? 'Manual' : (p.source || 'Unknown'))
    sourcesByDate.set(p.date, set)
  }

  // A wider, fixed history (independent of the Week/Month toggle above) so
  // the Deep/Core/REM estimate for a manual entry is based on a stable
  // sample, not just whatever's currently in view.
  const { data: historyPoints = [] } = useHealthMetricSeries('sleep_analysis', daysAgoStr(29), today)
  const stageProportions = estimateSleepStageProportions(computeSleepSummary(historyPoints))

  const addManualSleep = useAddManualSleep()
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualDate, setManualDate] = useState(daysAgoStr(1))
  const [manualHours, setManualHours] = useState('')

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const hours = parseFloat(manualHours)
    if (!manualDate || !hours || hours <= 0) return
    addManualSleep.mutate(
      { date: manualDate, totalHours: hours, stageProportions },
      { onSuccess: () => { setShowManualForm(false); setManualHours('') } },
    )
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">😴 Last Night's Sleep</p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : last ? fmtHrs(last.total) : '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowManualForm(v => !v)}
          className="min-h-[32px] px-3 rounded-lg text-xs font-semibold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
        >
          + Manual
        </button>
      </div>

      {showManualForm && (
        <form onSubmit={handleManualSubmit} className="flex flex-wrap items-end gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Night of</label>
            {/* DateInput (not a raw <input type="date">) — native date inputs
                render in the browser/OS locale regardless of the stored
                value's format, which silently showed MM/DD/YYYY for
                anyone not on an en-GB locale. CLAUDE.md mandates DD/MM/YYYY
                everywhere, no exceptions. */}
            <DateInput
              value={manualDate} max={today} onChange={setManualDate}
              className="min-h-[36px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Hours slept</label>
            <input
              type="number" step="0.25" min="0" max="24" placeholder="7.5" value={manualHours}
              onChange={e => setManualHours(e.target.value)}
              className="min-h-[36px] w-20 px-2 text-sm border border-ink-200 rounded-lg bg-cream-50"
            />
          </div>
          <button
            type="submit" disabled={addManualSleep.isPending}
            className="min-h-[36px] px-3 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {addManualSleep.isPending ? 'Saving…' : 'Save'}
          </button>
          <p className="text-[10px] text-ink-400 basis-full">
            Logged as source “Manual” — Deep/Core/REM split estimated from your {stageProportions ? 'own' : 'default'} sleep-stage average.
          </p>
        </form>
      )}

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
                trendPeriod === p ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
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
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={trendPeriod === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip cursor={false} trigger="click" content={makeSleepTooltipContent(sourcesByDate)} />
            <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Sleep Extras" metrics={SLEEP_EXTRA_METRICS} />
    </div>
  )
}
