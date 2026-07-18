import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { DateInput } from '../../../../shared/components/DateInput'
import { useHealthMetricSeries, useAddManualSleep } from '../../hooks/useHealthExport'
import { computeSleepSummary, estimateSleepStageProportions, extractSleepSessions, computeSleepScore, computeSleepEfficiency } from '../../healthAggregate'
import { todayStr, daysAgoStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
import { DateNav } from './DateNav'
import { shiftStr, rangeForAnchor, stepAnchor, labelForAnchor } from './dateNav'
import { PeriodToggle, type Period } from './PeriodToggle'
import { useAnchorDate } from './useAnchorDate'
import { MetricMiniGrid } from './MetricMiniGrid'
import { SLEEP_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

function fmtDayLong(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
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

const fmtClock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Night timeline at SESSION granularity — when you fell asleep, woke up, and
// any interruption gap between distinct sessions. Deliberately NOT a
// per-stage hypnogram: the exported data carries only whole-session stage
// TOTALS (verified against every live row), so exact stage start/end times
// simply don't exist — drawing them would be invented precision.
function SessionTimeline({ sessions }: { sessions: { startMs: number; endMs: number }[] }) {
  if (sessions.length === 0) return null
  const pad = 20 * 60_000
  const min = sessions[0].startMs - pad
  const max = sessions[sessions.length - 1].endMs + pad
  const span = max - min
  const pct = (ms: number) => ((ms - min) / span) * 100

  return (
    <div>
      <div className="relative h-6 rounded-lg bg-ink-100 overflow-hidden">
        {sessions.map((s, i) => (
          <div
            key={i}
            className="absolute top-0.5 bottom-0.5 rounded-md bg-indigo-500/85"
            style={{ left: `${pct(s.startMs)}%`, width: `${pct(s.endMs) - pct(s.startMs)}%` }}
            title={`${fmtClock(s.startMs)} – ${fmtClock(s.endMs)}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-0.5 text-[10px] text-ink-400 tabular-nums">
        <span>😴 {fmtClock(sessions[0].startMs)}</span>
        {sessions.length > 1 && (
          <span className="text-amber-600">
            {sessions.length - 1} interruption{sessions.length > 2 ? 's' : ''}
            {' '}({sessions.slice(1).map((s, i) => `${fmtClock(sessions[i].endMs)}–${fmtClock(s.startMs)}`).join(', ')})
          </span>
        )}
        <span>⏰ {fmtClock(sessions[sessions.length - 1].endMs)}</span>
      </div>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

// Efficiency bands (clinical rule of thumb: ≥85% good, 75–85% fair, <75% poor).
function effColor(pct: number): string {
  if (pct >= 85) return 'bg-green-100 text-green-700 border-green-200'
  if (pct >= 75) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

// A compact stat "chip" — a big number over a small label, color-banded.
function StatChip({ value, label, cls, title }: { value: string; label: string; cls: string; title?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border px-3 py-1 ${cls}`} title={title}>
      <span className="text-lg font-bold leading-none tabular-nums">{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70 mt-0.5">{label}</span>
    </div>
  )
}

// "Correct manually" + "View this day" links inside the tooltip (not standalone
// buttons) — clicking a bar (or an empty gap, which still has a date even with
// no bar to show) can either open the manual-entry form pre-filled for exactly
// that night, or jump the section to that night's Day view.
function makeSleepTooltipContent(
  sourcesByDate: Map<string, Set<string>>,
  onCorrect: (date: string) => void,
  onViewDay: (date: string) => void,
) {
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
          <div className="flex flex-col">
            {point.value != null && (
              <button
                type="button"
                onClick={() => onViewDay(date)}
                className="text-indigo-600 underline text-xs py-1.5 text-left min-h-[32px]"
              >
                View this day →
              </button>
            )}
            <button
              type="button"
              onClick={() => onCorrect(date)}
              className="text-accent-600 underline text-xs py-1.5 text-left min-h-[32px]"
            >
              Correct manually
            </button>
          </div>
        )}
      </div>
    )
  }
}

export function SleepSection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useAnchorDate()

  // In Day mode the chart still shows a 7-night CONTEXT window ending at the
  // anchor (a 1-bar chart is useless) while the detail block below reflects
  // just the anchored night. Week/Month behave as a normal trend range.
  const chartRange = period === 'day'
    ? { from: shiftStr(anchor, -6), to: anchor }
    : rangeForAnchor(period, anchor)
  const { data: points = [], isLoading } = useHealthMetricSeries('sleep_analysis', chartRange.from, chartRange.to)
  const summary = computeSleepSummary(points)
  const summaryByDate = new Map(summary.map(s => [s.date, s]))

  // The night whose full detail (stages, timeline, score, efficiency) is shown:
  // Day mode → the anchored night; Week/Month → the most recent night WITH data
  // in range (so "Last Night's Sleep" is never a blank today-not-synced-yet).
  const detailDate = period === 'day'
    ? anchor
    : (summary.length ? summary[summary.length - 1].date : anchor)
  const detail = summaryByDate.get(detailDate) ?? null
  const detailSessions = detail ? extractSleepSessions(points, detailDate) : []
  const sleepScore = detail ? computeSleepScore(detail, Math.max(detailSessions.length, 1)) : null
  const efficiency = detail ? computeSleepEfficiency(detail, detailSessions) : null

  const detailIsToday = detailDate === today
  const headline = period === 'day'
    ? (detailIsToday ? "Today's Sleep" : `Sleep · ${fmtDayLong(detailDate)}`)
    : "Last Night's Sleep"

  // Left-join onto every date in range so a night with no synced data still
  // shows as a gap on the axis instead of silently disappearing.
  const chartData = datesBetweenStr(chartRange.from, chartRange.to).map(date => {
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

  // A wider, fixed history (independent of the Day/Week/Month toggle above) so
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

  // Jump to a specific night's Day view (from the trend tooltip).
  function viewDay(date: string) {
    setPeriod('day')
    setAnchor(date)
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
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">😴 {headline}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : detail ? fmtHrs(detail.total) : '—'}
          </p>
          {sleepScore != null && (
            <StatChip
              value={String(sleepScore)}
              label="Score · est"
              cls={scoreColor(sleepScore)}
              title="Estimated 0–100 score from duration (vs 8h), deep/REM share and interruptions — not a medical metric"
            />
          )}
          {efficiency != null && (
            <StatChip
              value={`${efficiency}%`}
              label="Efficiency"
              cls={effColor(efficiency)}
              title="Sleep efficiency — % of time in bed actually spent asleep (≥85% is generally good)"
            />
          )}
          {detail && (sourcesByDate.get(detailDate)?.has('Manual') ?? false) && (
            <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              Manual
            </span>
          )}
        </div>
        {period === 'day' && !detail && !isLoading && (
          <p className="text-xs text-ink-400 mt-1">No sleep data for this night — use ‹ › to pick another day, or add it manually below.</p>
        )}
      </div>

      {/* Night timeline — session windows + interruption gaps */}
      {detailSessions.length > 0 && <SessionTimeline sessions={detailSessions} />}

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

      {detail && (
        <>
          <div className="h-4 rounded-full overflow-hidden flex w-full bg-ink-100">
            {STAGES.map(s => {
              const val = detail[s.key]
              const pct = detail.total > 0 ? (val / detail.total) * 100 : 0
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
                <span className="font-semibold text-ink-800">{fmtHrs(detail[s.key])}</span>
              </div>
            ))}
          </div>
        </>
      )}

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

      {/* Day mode shows ONE night — the stage breakdown + session timeline
          above ARE that night's graph. The multi-bar trend chart is only for
          Week/Month (in Day mode it read as a week, which is exactly what the
          user flagged). */}
      {period !== 'day' && (
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
              {/* pointerEvents:auto is required or the links inside the tooltip
                  never receive their click (recharts sets the tooltip wrapper to
                  pointer-events:none by default). */}
              <Tooltip cursor={false} wrapperStyle={{ pointerEvents: 'auto' }} content={makeSleepTooltipContent(sourcesByDate, openCorrectForm, viewDay)} />
              <Bar dataKey="total" radius={[3, 3, 0, 0]} activeBar={false} fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
