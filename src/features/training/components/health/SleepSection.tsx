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

// "Correct manually" link inside the tooltip (not a standalone "+ Manual"
// button) — clicking a bar (or an empty gap, which still has a date even
// with no bar to show) opens the manual-entry form pre-filled for exactly
// that night, pre-filled with its existing manual total if there is one
// (see manualHoursForDate) so re-opening it reads as "correct" rather than
// "add a second, conflicting entry".
function makeSleepTooltipContent(sourcesByDate: Map<string, Set<string>>, onCorrect: (date: string) => void) {
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
        {date && (
          <button
            type="button"
            onClick={() => onCorrect(date)}
            className="text-accent-600 underline text-[10px] pt-1 block"
          >
            Correct manually
          </button>
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
  const [isCorrectingExisting, setIsCorrectingExisting] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  // Existing manual total for a date, if any — read from whatever's already
  // loaded for the currently-displayed range (the clicked bar is always
  // within `points`, since that's what rendered it). Reuses
  // computeSleepSummary's own manual-vs-synced priority logic rather than
  // re-deriving it here.
  function manualHoursForDate(date: string): number | null {
    const manualPts = points.filter(p => p.date === date && p.source === 'manual')
    if (!manualPts.length) return null
    return computeSleepSummary(manualPts)[0]?.total ?? null
  }

  function openCorrectForm(date: string) {
    const existing = manualHoursForDate(date)
    setManualDate(date)
    setManualHours(existing != null ? String(Math.round(existing * 100) / 100) : '')
    setIsCorrectingExisting(existing != null)
    setShowManualForm(true)
  }

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
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">😴 Last Night's Sleep</p>
        <div className="flex items-center gap-2">
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : last ? fmtHrs(last.total) : '—'}
          </p>
          {last && (sourcesByDate.get(last.date)?.has('Manual') ?? false) && (
            <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              Manual
            </span>
          )}
        </div>
      </div>

      {showManualForm && (
        <form onSubmit={handleManualSubmit} className="flex flex-wrap items-end gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 relative">
          <button
            type="button"
            onClick={() => setShowManualForm(false)}
            aria-label="Cancel"
            className="absolute top-1.5 right-1.5 min-w-[28px] min-h-[28px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-sm leading-none"
          >
            ×
          </button>
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
            {addManualSleep.isPending ? 'Saving…' : isCorrectingExisting ? 'Save correction' : 'Save'}
          </button>
          <p className="text-[10px] text-ink-400 basis-full pr-6">
            {isCorrectingExisting
              ? 'Overwrites your previous manual entry for this night only — Watch-synced nights are never touched.'
              : `Logged as source "Manual" — Deep/Core/REM split estimated from your ${stageProportions ? 'own' : 'default'} sleep-stage average.`}
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
            {/* pointerEvents:auto is required or the "Correct manually" button
                inside the tooltip never receives its click (recharts sets the
                tooltip wrapper to pointer-events:none by default). */}
            <Tooltip cursor={false} trigger="click" wrapperStyle={{ pointerEvents: 'auto' }} content={makeSleepTooltipContent(sourcesByDate, openCorrectForm)} />
            <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} activeBar={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Sleep Extras" metrics={SLEEP_EXTRA_METRICS} />

      {/* Raw incoming rows — the actual health_metrics stored for this range,
          so what the webhook received can be inspected directly (each value is
          the raw exported point). Handy for spotting missing/collided sessions
          vs what iPhone Health shows. */}
      <div className="border-t border-ink-100 pt-2">
        <button
          type="button"
          onClick={() => setShowRaw(v => !v)}
          className="text-[11px] text-ink-400 hover:text-ink-700 min-h-[28px]"
        >
          {showRaw ? '▲ Hide raw data' : `🔍 Raw data (${points.length} rows)`}
        </button>
        {showRaw && (
          <div className="mt-1 max-h-64 overflow-y-auto flex flex-col gap-1">
            {[...points]
              .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))
              .map((p, i) => {
                const v = p.value as Record<string, unknown>
                const isSession = typeof v?.totalSleep === 'number'
                const hhmm = (s: unknown) => (typeof s === 'string' && s.length >= 16 ? s.slice(11, 16) : '?')
                return (
                  <div key={i} className="text-[10px] font-mono bg-cream-100 rounded px-2 py-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span className="text-ink-500">{p.date}</span>
                    <span className={p.source === 'manual' ? 'text-indigo-600 font-semibold' : 'text-ink-400'}>{p.source || '—'}</span>
                    {isSession ? (
                      <>
                        <span className="text-ink-700">{hhmm(v.sleepStart)}→{hhmm(v.sleepEnd)}</span>
                        <span className="text-ink-900 font-semibold">{Number(v.totalSleep).toFixed(2)}h</span>
                        <span className="text-ink-400">C{Number(v.core ?? 0).toFixed(1)} R{Number(v.rem ?? 0).toFixed(1)} D{Number(v.deep ?? 0).toFixed(1)} A{Number(v.awake ?? 0).toFixed(1)}</span>
                      </>
                    ) : (
                      <span className="text-ink-700">{String(v?.value ?? '?')} {typeof v?.qty === 'number' ? `${v.qty.toFixed(2)}h` : ''}</span>
                    )}
                  </div>
                )
              })}
            {points.length === 0 && <p className="text-[11px] text-ink-400">No rows in this range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
