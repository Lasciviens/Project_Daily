import { useState } from 'react'
import { Truncate, useChartColors } from '../../../shared/ui'
import type { AreaChart, DayChart, ReportChart } from '../claude/reportFigures'

// The weekly report's small charts (THEME §2.5): one series each, its colour from `useChartColors()` (never the accent),
// bars from zero with rounded ends, a dashed line for the target or the week before. The bars grow once on opening
// (`motion-safe:animate-barGrow`; reduced motion drops it). Each day's value is on the bar's button: hover with a mouse,
// a tap or the keyboard writes it in the line under the chart (never a hover-only tooltip, W5).

/** Each chart's series, by its key: Food's calories keep Food's colour (series 2). */
const SERIES: Record<string, number> = { volume: 0, steps: 0, sleep: 2, kcal: 1, time: 0 }

function DayBars({ chart }: { chart: DayChart }) {
  const c = useChartColors()
  const [picked, setPicked] = useState<number | null>(null)
  const color = c.series[SERIES[chart.key] ?? 0]
  const top = Math.max(...chart.values.map(v => v ?? 0), chart.reference?.value ?? 0) || 1
  const line = picked !== null ? `${chart.days[picked]} · ${chart.texts[picked] ?? 'nothing recorded'}` : chart.summary
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="section-label">{chart.label}</span>
        {chart.reference && (
          <span className="flex shrink-0 items-center gap-1 text-meta tabular-nums text-fg-muted">
            <span aria-hidden className="w-3 border-t-2 border-dashed" style={{ borderColor: c.axis }} />
            {chart.reference.label}
          </span>
        )}
      </figcaption>
      <div className="relative mt-2 h-16" role="group" aria-label={chart.label}>
        <div aria-hidden className="absolute inset-x-0 bottom-0 border-t" style={{ borderColor: c.grid }} />
        <div className="flex h-full items-end gap-1">
          {chart.values.map((v, i) => (
            <button
              key={i} type="button" aria-label={`${chart.days[i]}: ${chart.texts[i] ?? 'nothing recorded'}`} aria-pressed={picked === i}
              className="flex h-full min-w-0 flex-1 items-end justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              onPointerEnter={e => { if (e.pointerType === 'mouse') setPicked(i) }}
              onPointerLeave={e => { if (e.pointerType === 'mouse') setPicked(null) }}
              onFocus={() => setPicked(i)} onBlur={() => setPicked(null)}
              onClick={() => setPicked(i)}
            >
              <span
                aria-hidden
                className="block w-full max-w-[1.75rem] origin-bottom rounded-t-[4px] transition-opacity duration-150 motion-safe:animate-barGrow"
                style={{
                  height: v === null ? 2 : `${Math.max(4, (v / top) * 100)}%`,
                  background: v === null ? c.grid : color,
                  opacity: picked !== null && picked !== i ? 0.4 : 1,
                  animationDelay: `${i * 30}ms`,
                }}
              />
            </button>
          ))}
        </div>
        {/* After the bars, so the line is drawn over them. */}
        {chart.reference && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed"
            style={{ bottom: `${(chart.reference.value / top) * 100}%`, borderColor: c.axis }} />
        )}
      </div>
      <div aria-hidden className="mt-1 flex gap-1">
        {chart.days.map((d, i) => <span key={i} className="flex-1 text-center text-meta text-fg-muted">{d.slice(0, 1)}</span>)}
      </div>
      <Truncate as="p" className="mt-0.5 text-meta tabular-nums text-fg-2">{line || ' '}</Truncate>
    </figure>
  )
}

function AreaBars({ chart }: { chart: AreaChart }) {
  const c = useChartColors()
  const color = c.series[SERIES[chart.key] ?? 0]
  const top = Math.max(...chart.rows.map(r => r.value)) || 1
  return (
    <figure className="min-w-0">
      <figcaption className="section-label">{chart.label}</figcaption>
      <ul className="mt-2 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5">
        {chart.rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="contents">
            <Truncate className="text-meta capitalize text-fg-2">{r.label}</Truncate>
            <span aria-hidden className="h-2.5 overflow-hidden rounded-[4px]" style={{ background: c.grid }}>
              <span className="block h-full origin-left rounded-[4px] motion-safe:animate-barGrowX" style={{ width: `${Math.max(3, (r.value / top) * 100)}%`, background: color, animationDelay: `${i * 40}ms` }} />
            </span>
            <span className="text-meta tabular-nums text-fg">{r.text}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function ReportChartView({ chart }: { chart: ReportChart }) {
  return chart.kind === 'days' ? <DayBars chart={chart} /> : <AreaBars chart={chart} />
}
