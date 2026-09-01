import { useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { DateInput } from '../../../../shared/components/DateInput'
import { useHealthMetricSeries, useAddManualSleep } from '../../hooks/useHealthExport'
import { computeSleepSummary, estimateSleepStageProportions, extractSleepSessions } from '../../healthAggregate'
import { todayStr, daysAgoStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
import { shiftStr, rangeForAnchor } from './dateNav'
import type { HealthRange } from './sectionTypes'
import { MetricMiniGrid } from './MetricMiniGrid'
import { SLEEP_EXTRA_METRICS } from './miniMetrics'
import { compactAxisTick } from './axisFormat'

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

// The Day-mode "WHEN YOU SLEPT" clock — one clear, self-explanatory timeline:
// a prominent bedtime → wake header plus a real hour-axis band showing the
// asleep window(s) and any awake interruption between them. This is the SINGLE
// timeline for a night (the old separate SessionTimeline was redundant and
// removed). Deliberately NOT a per-stage hypnogram — the export carries
// whole-night stage TOTALS only (no per-stage timestamps), so stage timing on
// an axis would be invented precision; the stage split is shown separately as
// its own labelled bar.
function NightChart({ sessions }: { sessions: { startMs: number; endMs: number }[] }) {
  const bedtime = sessions[0].startMs
  const wake    = sessions[sessions.length - 1].endMs
  const inBedH  = (wake - bedtime) / 3_600_000

  const PAD_MS = 20 * 60_000
  const min = bedtime - PAD_MS
  const max = wake + PAD_MS
  const span = Math.max(max - min, 60_000)
  const W = 640, H = 70, TOP = 8, BAND_H = 34, AXIS_Y = TOP + BAND_H + 15
  const x = (ms: number) => ((ms - min) / span) * W

  // Hour ticks — every 2h for long windows so labels don't crowd/overlap.
  const stepH = span > 11 * 3_600_000 ? 2 : 1
  const ticks: number[] = []
  const first = new Date(min); first.setMinutes(0, 0, 0)
  for (let t = first.getTime(); t <= max; t += stepH * 3_600_000) if (t >= min) ticks.push(t)

  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50 px-3 py-3 max-w-2xl">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">🕐 When you slept</p>
        <p className="text-xs text-ink-600 tabular-nums">
          <span className="font-semibold">😴 {fmtClock(bedtime)}</span>
          <span className="text-ink-300"> → </span>
          <span className="font-semibold">⏰ {fmtClock(wake)}</span>
          <span className="text-ink-400"> · {fmtHrs(inBedH)} in bed</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-hidden="true">
        {/* awake gaps between sessions */}
        {sessions.slice(1).map((s, i) => {
          const gapStart = sessions[i].endMs
          const gapEnd = s.startMs
          if (gapEnd <= gapStart) return null
          const w = x(gapEnd) - x(gapStart)
          return (
            <g key={`gap-${i}`}>
              <rect x={x(gapStart)} y={TOP} width={w} height={BAND_H} rx={4} fill="#fecaca" />
              {w > 26 && <text x={(x(gapStart) + x(gapEnd)) / 2} y={TOP + BAND_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#dc2626">awake</text>}
            </g>
          )
        })}
        {/* asleep session bands */}
        {sessions.map((s, i) => (
          <rect key={i} x={x(s.startMs)} y={TOP} width={Math.max(x(s.endMs) - x(s.startMs), 2)} height={BAND_H} rx={6} fill="#6366f1" fillOpacity={0.9} />
        ))}
        {/* hour axis */}
        <line x1={0} y1={AXIS_Y - 8} x2={W} y2={AXIS_Y - 8} stroke="rgb(var(--ink-200))" strokeWidth={1} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} y1={AXIS_Y - 11} x2={x(t)} y2={AXIS_Y - 5} stroke="rgb(var(--ink-300))" strokeWidth={1} />
            <text x={x(t)} y={AXIS_Y + 4} textAnchor="middle" fontSize={8.5} fill="rgb(var(--ink-400))">
              {new Date(t).getHours().toString().padStart(2, '0')}
            </text>
          </g>
        ))}
      </svg>
      {sessions.length > 1 && (
        <p className="text-[10px] text-amber-600 mt-1">{sessions.length - 1} interruption{sessions.length > 2 ? 's' : ''} overnight (woke up, then back to sleep)</p>
      )}
    </div>
  )
}

// (Both derived chips — the estimated "sleep score" AND the efficiency % —
// were removed on explicit user decision: only measured values are shown.
// Don't reintroduce derived sleep metrics without asking.)

// Hover tooltip shows VALUES ONLY. Links inside a hover tooltip were
// unreachable in practice — the tooltip re-anchors/hides the moment the
// mouse moves toward it ("mouse hareket ettiği anda gidiyor"). Actions live
// in a PINNED POPOVER anchored AT the clicked bar (looks and sits like the
// info box itself, per explicit request — NOT a separate strip below the
// chart): clicking a bar pins it, ✕ or clicking the bar again closes it.
function makeSleepTooltipContent(sourcesByDate: Map<string, Set<string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  return function TooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    const point = payload[0]
    const date: string | undefined = point?.payload?.date
    const sources = date ? sourcesByDate.get(date) : null
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs space-y-0.5 pointer-events-none">
        <p className="text-ink-400 font-medium">{label}</p>
        <p className="font-semibold text-indigo-600">{point.value != null ? `${point.value} hr` : '—'}</p>
        {sources && sources.size > 0 && (
          <p className="text-ink-400">{[...sources].join(', ')}</p>
        )}
        <p className="text-[10px] text-ink-300">click bar for actions</p>
      </div>
    )
  }
}

export function SleepSection({ range }: { range: HealthRange }) {
  const today = todayStr()
  const { anchor, setAnchor, period, setPeriod } = range

  // In Day mode the chart still shows a 7-night CONTEXT window ending at the
  // anchor (a 1-bar chart is useless) while the detail block below reflects
  // just the anchored night. Week/Month behave as a normal trend range.
  const chartRange = period === 'day'
    ? { from: shiftStr(anchor, -6), to: anchor }
    : rangeForAnchor(period, anchor)
  const { data: points = [], isLoading } = useHealthMetricSeries('sleep_analysis', chartRange.from, chartRange.to)
  const summary = computeSleepSummary(points)
  const summaryByDate = new Map(summary.map(s => [s.date, s]))

  // Day mode → the anchored night's own detail. Week/Month → PERIOD AVERAGES
  // across every night with data in range (avg duration, avg stage split,
  // avg score/efficiency) — never "last night" pretending to be the period.
  const isDay = period === 'day'
  const dayDetail = isDay ? (summaryByDate.get(anchor) ?? null) : null
  const daySessions = dayDetail ? extractSleepSessions(points, anchor) : []

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  let periodDetail: (typeof summary)[number] | null = null
  let bestNight: (typeof summary)[number] | null = null
  let worstNight: (typeof summary)[number] | null = null
  if (!isDay && summary.length > 0) {
    periodDetail = {
      ...summary[summary.length - 1],
      total: mean(summary.map(n => n.total)),
      deep:  mean(summary.map(n => n.deep)),
      core:  mean(summary.map(n => n.core)),
      rem:   mean(summary.map(n => n.rem)),
      awake: mean(summary.map(n => n.awake)),
    }
    bestNight = summary.reduce((a, b) => (a.total >= b.total ? a : b))
    worstNight = summary.reduce((a, b) => (a.total <= b.total ? a : b))
  }

  const detail = isDay ? dayDetail : periodDetail
  const detailSessions = daySessions

  const headline = isDay
    ? (anchor === today ? "Today's Sleep" : `Sleep · ${fmtDayLong(anchor)}`)
    : period === 'week' ? 'Sleep · Weekly Average' : 'Sleep · Monthly Average'

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
  // Clicked-bar pinned popover — anchored at the bar's own position so the
  // actions live "in the info box", not in a separate strip below the chart.
  const [pinned, setPinned] = useState<{ date: string; x: number; y: number } | null>(null)
  const chartWrapRef = useRef<HTMLDivElement>(null)

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
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">😴 {headline}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <p className="text-2xl sm:text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : detail ? fmtHrs(detail.total) : '—'}
            {!isDay && detail && <span className="text-sm font-normal text-ink-400"> /night</span>}
          </p>
          {isDay && detail && (sourcesByDate.get(anchor)?.has('Manual') ?? false) && (
            <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              Manual
            </span>
          )}
        </div>
        {isDay && !detail && !isLoading && (
          <p className="text-xs text-ink-400 mt-1">No sleep data for this night — use ‹ › to pick another day, or add it manually below.</p>
        )}
        {!isDay && summary.length > 0 && bestNight && worstNight && (
          <p className="text-xs text-ink-400 mt-1">
            {summary.length} night{summary.length !== 1 ? 's' : ''} tracked · best {fmtHrs(bestNight.total)} ({fmtDay(bestNight.date)}) · lowest {fmtHrs(worstNight.total)} ({fmtDay(worstNight.date)})
          </p>
        )}
        {!isDay && summary.length === 0 && !isLoading && (
          <p className="text-xs text-ink-400 mt-1">No sleep data in this {period}.</p>
        )}
      </div>

      {/* Day mode: the ONE "when you slept" clock timeline, right under the
          headline (period modes show the multi-night trend chart lower down). */}
      {isDay && detailSessions.length > 0 && <NightChart sessions={detailSessions} />}

      {showManualForm && (
        // pr-12 keeps the fields clear of the absolutely-positioned 44px
        // cancel button in the top-right corner (a 28px one used to fit
        // beside the Save button on a phone row; a compliant one does not).
        <form onSubmit={handleManualSubmit} className="flex flex-wrap items-end gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 pr-12 relative">
          <button
            type="button"
            onClick={() => setShowManualForm(false)}
            aria-label="Cancel"
            className="absolute top-1.5 right-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-sm leading-none"
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
              className="min-h-[44px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Hours slept</label>
            <input
              type="number" step="0.25" min="0" max="24" placeholder="7.5" value={manualHours}
              onChange={e => setManualHours(e.target.value)}
              className="min-h-[44px] w-20 px-2 text-sm border border-ink-200 rounded-lg bg-cream-50"
            />
          </div>
          <button
            type="submit" disabled={addManualSleep.isPending}
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
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
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            🛏️ Sleep stages{!isDay && ' · avg/night'}
          </p>
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

      {/* Day mode gets the NIGHT CHART below instead; the multi-bar trend is
          only for Week/Month. Hover = value tooltip only; CLICK a bar pins a
          popover AT the bar (looks like the tooltip, but stable) carrying the
          actions — links in a hover tooltip were unreachable, and a separate
          strip below the chart was explicitly rejected. */}
      {period !== 'day' && (
        <div className="relative" ref={chartWrapRef}>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
                {/* Hide the hover tooltip while a bar is pinned — otherwise the
                    pinned popover AND the hover tooltip both render = two info
                    boxes at once (user-reported). The popover already shows the
                    date + hours, so nothing is lost. */}
                {!pinned && <Tooltip cursor={false} content={makeSleepTooltipContent(sourcesByDate)} />}
                {/* Click handled on the Bar itself — its handler receives the
                    rendered bar's own x/y/width, which is what lets the
                    popover anchor exactly at the clicked bar. */}
                <Bar
                  dataKey="total"
                  radius={[3, 3, 0, 0]}
                  activeBar={false}
                  fill="#6366f1"
                  className="cursor-pointer"
                  onClick={(d) => {
                    const bar = d as unknown as { x?: number; y?: number; width?: number; payload?: { date?: string }; date?: string }
                    const date = bar.payload?.date ?? bar.date
                    if (!date || typeof bar.x !== 'number') return
                    // Clamp here (event time — refs must not be read during
                    // render) so the popover never sticks out of the card.
                    const wrapW = chartWrapRef.current?.offsetWidth ?? 600
                    const x = Math.min(Math.max(bar.x + (bar.width ?? 0) / 2, 100), wrapW - 100)
                    setPinned(p => (p?.date === date ? null : { date, x, y: bar.y ?? 0 }))
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pinned popover — the "info box" itself, anchored at the bar */}
          {pinned && (() => {
            const night = summaryByDate.get(pinned.date)
            return (
              <div
                className="absolute z-20 w-[200px] bg-cream-50 border border-ink-200 rounded-lg shadow-lg px-2.5 py-2 text-xs"
                style={{ left: pinned.x, top: pinned.y, transform: 'translate(-50%, calc(-100% - 6px))' }}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <p className="text-ink-400 font-medium">{fmtDayLong(pinned.date)}</p>
                    <p className="font-semibold text-indigo-600">{night ? fmtHrs(night.total) : 'no data'}</p>
                  </div>
                  <button type="button" onClick={() => setPinned(null)} aria-label="Close"
                    className="min-w-[44px] min-h-[44px] -mr-1 -mt-1 flex items-center justify-center text-ink-400 hover:text-ink-700">✕</button>
                </div>
                <div className="flex flex-col items-start mt-0.5">
                  <button type="button" onClick={() => { viewDay(pinned.date); setPinned(null) }}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 min-h-[44px] flex items-center">
                    View this day →
                  </button>
                  <button type="button" onClick={() => { openCorrectForm(pinned.date); setPinned(null) }}
                    className="text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[44px] flex items-center">
                    Correct manually
                  </button>
                </div>
              </div>
            )
          })()}
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
          className="text-[11px] text-ink-500 hover:text-ink-700 min-h-[44px] flex items-center"
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
