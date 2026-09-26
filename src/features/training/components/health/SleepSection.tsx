import { useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { DateInput } from '../../../../shared/components/DateInput'
import { useHealthMetricSeries, useAddManualSleep } from '../../hooks/useHealthExport'
import { computeSleepSummary, estimateSleepStageProportions, extractSleepSessions, formatSleepHours as fmtHrs } from '../../healthAggregate'
import { todayStr, daysAgoStr, datesBetweenStr } from '../../../../shared/utils/dateUtils'
import { shiftStr, rangeForAnchor } from './dateNav'
import type { HealthRange } from './sectionTypes'
import { MetricMiniGrid } from './MetricMiniGrid'
import { SLEEP_EXTRA_METRICS } from './miniMetrics'
import { compactAxisTick } from './axisFormat'
import { AlarmClock, BedDouble, ChevronDown, Search, X } from 'lucide-react'
import { Button, TonePill, useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../chartKit'
import { HeadlineStat, SectionCard } from './sectionKit'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

function fmtDayLong(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Sleep-stage colours are identity data users know by colour (THEME.md §2.5):
// literal and the same in both themes. SLEEP is the "asleep" colour.
const STAGES = [
  { key: 'deep' as const, label: 'Deep',  color: '#4338ca' },
  { key: 'core' as const, label: 'Core',  color: '#6366f1' },
  { key: 'rem'  as const, label: 'REM',   color: '#a5b4fc' },
  { key: 'awake' as const, label: 'Awake', color: '#f87171' },
]
const SLEEP_COLOR = STAGES[1].color
const AWAKE_COLOR = STAGES[3].color

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
  const c = useChartColors()
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
    <div className="max-w-2xl rounded-row border border-line bg-surface px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="section-label">When you slept</p>
        <p className="flex items-center gap-1 text-meta tabular-nums text-fg-2">
          <BedDouble className="h-3.5 w-3.5 text-fg-muted" aria-label="Bedtime" /><span className="font-semibold">{fmtClock(bedtime)}</span>
          <span className="text-fg-faint"> → </span>
          <AlarmClock className="h-3.5 w-3.5 text-fg-muted" aria-label="Wake" /><span className="font-semibold">{fmtClock(wake)}</span>
          <span className="text-fg-muted"> · {fmtHrs(inBedH)} in bed</span>
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
              <rect x={x(gapStart)} y={TOP} width={w} height={BAND_H} rx={4} fill={AWAKE_COLOR} fillOpacity={0.3} />
              {w > 26 && <text x={(x(gapStart) + x(gapEnd)) / 2} y={TOP + BAND_H / 2 + 3} textAnchor="middle" fontSize={8} fill={c.danger}>awake</text>}
            </g>
          )
        })}
        {/* asleep session bands */}
        {sessions.map((s, i) => (
          <rect key={i} x={x(s.startMs)} y={TOP} width={Math.max(x(s.endMs) - x(s.startMs), 2)} height={BAND_H} rx={6} fill={SLEEP_COLOR} fillOpacity={0.9} />
        ))}
        {/* hour axis */}
        <line x1={0} y1={AXIS_Y - 8} x2={W} y2={AXIS_Y - 8} stroke={c.grid} strokeWidth={1} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} y1={AXIS_Y - 11} x2={x(t)} y2={AXIS_Y - 5} stroke={c.grid} strokeWidth={1} />
            <text x={x(t)} y={AXIS_Y + 4} textAnchor="middle" fontSize={8.5} fill={c.axis}>
              {new Date(t).getHours().toString().padStart(2, '0')}
            </text>
          </g>
        ))}
      </svg>
      {sessions.length > 1 && (
        <p data-tone="warn" className="tone-text mt-1 text-micro font-medium">{sessions.length - 1} interruption{sessions.length > 2 ? 's' : ''} overnight (woke up, then back to sleep)</p>
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
      <div className={`${TOOLTIP_BOX} pointer-events-none`}>
        <p className="font-medium text-fg-muted">{label}</p>
        <p className="font-semibold tabular-nums text-fg">{point.value != null ? fmtHrs(point.value) : '—'}</p>
        {sources && sources.size > 0 && (
          <p className="text-fg-muted">{[...sources].join(', ')}</p>
        )}
        <p className="text-micro font-normal text-fg-faint">Click the bar for actions</p>
      </div>
    )
  }
}

export function SleepSection({ range }: { range: HealthRange }) {
  const today = todayStr()
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()

  // The mini-metric cards read the SAME window the rest of the page is on
  // (they used to be pinned to the last 7 days ending today, so they sat
  // frozen while this control moved).
  const miniWindow = { ...rangeForAnchor(period, anchor), period }

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
    ? (anchor === today ? 'Sleep today' : `Sleep · ${fmtDayLong(anchor)}`)
    : period === 'week' ? 'Sleep · weekly average' : 'Sleep · monthly average'

  // Left-join onto every date in range so a night with no synced data still
  // shows as a gap on the axis instead of silently disappearing.
  const chartData = datesBetweenStr(chartRange.from, chartRange.to).map(date => {
    const s = summaryByDate.get(date)
    // NOT rounded to one decimal here: the tooltip formats this same value as
    // "6h 52m", and pre-rounding 6.87 to 6.9 would render it as 6h 54m. The Y
    // axis has its own tick formatter, so full precision costs the chart nothing.
    return { label: fmtDay(date), date, total: s ? s.total : null }
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
    <SectionCard>
      <div>
        <div className="flex flex-wrap items-end gap-2">
          <HeadlineStat
            label={headline}
            value={isLoading ? '…' : detail ? fmtHrs(detail.total) : '—'}
            unit={!isDay && detail ? '/night' : undefined}
          />
          {isDay && detail && (sourcesByDate.get(anchor)?.has('Manual') ?? false) && (
            <TonePill tone="neutral" className="mb-1">Manual</TonePill>
          )}
        </div>
        {isDay && !detail && !isLoading && (
          <p className="mt-1 text-meta text-fg-muted">No sleep data for this night — use ‹ › to pick another day, or add it manually below.</p>
        )}
        {!isDay && summary.length > 0 && bestNight && worstNight && (
          <p className="mt-1 text-meta text-fg-muted">
            {summary.length} night{summary.length !== 1 ? 's' : ''} tracked · best {fmtHrs(bestNight.total)} ({fmtDay(bestNight.date)}) · lowest {fmtHrs(worstNight.total)} ({fmtDay(worstNight.date)})
          </p>
        )}
        {!isDay && summary.length === 0 && !isLoading && (
          <p className="mt-1 text-meta text-fg-muted">No sleep data in this {period}.</p>
        )}
      </div>

      {/* Day mode: the ONE "when you slept" clock timeline, right under the
          headline (period modes show the multi-night trend chart lower down). */}
      {isDay && detailSessions.length > 0 && <NightChart sessions={detailSessions} />}

      {showManualForm && (
        // pr-12 keeps the fields clear of the absolutely-positioned 44px
        // cancel button in the top-right corner (a 28px one used to fit
        // beside the Save button on a phone row; a compliant one does not).
        <form onSubmit={handleManualSubmit} className="relative flex max-w-xl flex-wrap items-end gap-2 rounded-row border border-line bg-surface-2 p-3 pr-12">
          <button
            type="button"
            onClick={() => setShowManualForm(false)}
            aria-label="Cancel"
            className="icon-btn absolute right-1.5 top-1.5"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <div className="flex flex-col">
            <label className="field-label">Night of</label>
            {/* DateInput (not a raw <input type="date">) — native date inputs
                render in the browser/OS locale regardless of the stored
                value's format, which silently showed MM/DD/YYYY for
                anyone not on an en-GB locale. CLAUDE.md mandates DD/MM/YYYY
                everywhere, no exceptions. */}
            <DateInput
              value={manualDate} max={today} onChange={setManualDate}
              className="input w-40"
            />
          </div>
          <div className="flex flex-col">
            <label className="field-label">Hours slept</label>
            <input
              type="number" step="0.25" min="0" max="24" placeholder="7.5" value={manualHours}
              onChange={e => setManualHours(e.target.value)}
              className="input w-24"
            />
          </div>
          <Button type="submit" variant="primary" loading={addManualSleep.isPending}>
            {isCorrectingExisting ? 'Save correction' : 'Save sleep'}
          </Button>
          <p className="basis-full pr-6 text-meta text-fg-muted">
            {isCorrectingExisting
              ? 'Overwrites your previous manual entry for this night only — Watch-synced nights are never touched.'
              : `Logged as source "Manual" — Deep/Core/REM split estimated from your ${stageProportions ? 'own' : 'default'} sleep-stage average.`}
          </p>
        </form>
      )}

      {detail && (
        <>
          <p className="section-label">
            Sleep stages{!isDay && ' · avg/night'}
          </p>
          <div className="flex h-4 w-full max-w-3xl overflow-hidden rounded-full bg-surface-2">
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
              <div key={s.key} className="flex items-center gap-1.5 text-meta">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-fg-muted">{s.label}</span>
                <span className="font-semibold tabular-nums text-fg">{fmtHrs(detail[s.key])}</span>
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} interval={period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
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
                  fill={SLEEP_COLOR}
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
                className="menu absolute w-[200px] px-2.5 py-2 text-meta"
                style={{ left: pinned.x, top: pinned.y, transform: 'translate(-50%, calc(-100% - 6px))' }}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <p className="font-medium text-fg-muted">{fmtDayLong(pinned.date)}</p>
                    <p className="font-semibold tabular-nums text-fg">{night ? fmtHrs(night.total) : 'no data'}</p>
                  </div>
                  <button type="button" onClick={() => setPinned(null)} aria-label="Close"
                    className="icon-btn -mr-1 -mt-1"><X className="h-4 w-4" aria-hidden /></button>
                </div>
                <div className="flex flex-col items-start mt-0.5">
                  <button type="button" onClick={() => { viewDay(pinned.date); setPinned(null) }}
                    className="flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
                    View this day →
                  </button>
                  <button type="button" onClick={() => { openCorrectForm(pinned.date); setPinned(null) }}
                    className="flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
                    Correct manually
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      <MetricMiniGrid title="Sleep extras" metrics={SLEEP_EXTRA_METRICS} window={miniWindow} />

      {/* Raw incoming rows — the actual health_metrics stored for this range,
          so what the webhook received can be inspected directly (each value is
          the raw exported point). Handy for spotting missing/collided sessions
          vs what iPhone Health shows. */}
      <div className="border-t border-line pt-2">
        <button
          type="button"
          aria-expanded={showRaw}
          onClick={() => setShowRaw(v => !v)}
          className="btn-ghost btn-sm gap-1 px-2 text-meta"
        >
          {showRaw ? <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
          {showRaw ? 'Hide raw data' : `Raw data (${points.length} rows)`}
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
                  <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 rounded bg-surface-2 px-2 py-1 font-mono text-micro font-normal">
                    <span className="text-fg-muted">{p.date}</span>
                    <span className={p.source === 'manual' ? 'font-semibold text-fg' : 'text-fg-faint'}>{p.source || '—'}</span>
                    {isSession ? (
                      <>
                        <span className="text-fg-2">{hhmm(v.sleepStart)}→{hhmm(v.sleepEnd)}</span>
                        <span className="font-semibold text-fg">{fmtHrs(Number(v.totalSleep))}</span>
                        <span className="text-fg-faint">C{fmtHrs(Number(v.core ?? 0))} R{fmtHrs(Number(v.rem ?? 0))} D{fmtHrs(Number(v.deep ?? 0))} A{fmtHrs(Number(v.awake ?? 0))}</span>
                      </>
                    ) : (
                      <span className="text-fg-2">{String(v?.value ?? '?')} {typeof v?.qty === 'number' ? fmtHrs(v.qty) : ''}</span>
                    )}
                  </div>
                )
              })}
            {points.length === 0 && <p className="text-meta text-fg-muted">No rows in this range.</p>}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
