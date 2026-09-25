import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTicks, type TgaColumn } from './tgAnalyticsSeries'
import { useReducedMotion } from './tgAnalyticsClock'
import { fmtInt } from './tgAnalyticsFormat'

interface Noun { one: string; many: string }
const say = (n: number, noun: Noun) => `${fmtInt(n)} ${n === 1 ? noun.one : noun.many}`

const AXIS_TICK = { fontSize: 11, fill: 'var(--tg-muted)' }

interface TickProps { x?: number | string; y?: number | string; payload?: { value?: unknown } }

/** Two-line axis label: the month (or day), and under it the year (or month) where that changes. */
function AxisTick({ x, y, label }: TickProps & { label?: { line1: string; line2?: string } }) {
  if (!label) return null
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <text textAnchor="middle" dy={11} fontSize={11} fill="var(--tg-muted)">{label.line1}</text>
      {label.line2 && <text textAnchor="middle" dy={25} fontSize={10.5} fontWeight={600} fill="var(--tg-faint)">{label.line2}</text>}
    </g>
  )
}

/** Value first and strong, the column's name second — the reader already knows the series. */
function Tip({ column, noun }: { column?: TgaColumn; noun: Noun }) {
  if (!column) return null
  return (
    <div className="rounded-[10px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] px-3 py-2 shadow-[shadow:var(--tg-menu-shadow)]">
      <p className="text-[13px] font-semibold text-[var(--tg-text)]">{say(column.count, noun)}</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--tg-muted)]">{column.full}</p>
    </div>
  )
}

/**
 * One series of columns in the accent: 24px at most, 4px rounded data-ends,
 * a hairline grid. Only the tallest column carries its number; the tooltip
 * (hover, or arrow keys once the chart has focus) and a screen-reader table
 * carry every other value.
 */
export function TgAnalyticsColumns({ columns, height, noun, caption, allTicks = false }: {
  columns: TgaColumn[]
  height: number
  noun: Noun
  /** Names the table twin for screen readers. */
  caption: string
  /** Show every tick (used when blank ticks already thin the axis). */
  allTicks?: boolean
}) {
  const reduce = useReducedMotion()
  const [plotWidth, setPlotWidth] = useState(0)
  const ticks = useMemo(() => axisTicks(columns, plotWidth - 40, allTicks), [columns, plotWidth, allTicks])
  const twoLines = columns.some(c => c.group)
  // Only the tallest column carries its number (the first of equals).
  const data = useMemo(() => {
    let at = -1, max = 0
    columns.forEach((c, i) => { if (c.count > max) { max = c.count; at = i } })
    return columns.map((c, i) => ({ ...c, peak: i === at ? c.count : null }))
  }, [columns])

  return (
    <>
      <div style={{ height }} className="-ml-2 -mr-1">
        <ResponsiveContainer width="100%" height="100%" onResize={w => setPlotWidth(w)}>
          <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%" accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--tg-border)" />
            <XAxis
              dataKey="key" ticks={[...ticks.keys()]} interval={0} tickLine={false}
              tick={(p: TickProps) => <AxisTick {...p} label={ticks.get(String(p.payload?.value))} />}
              axisLine={{ stroke: 'var(--tg-border-strong)' }} tickMargin={6} height={twoLines ? 40 : 26}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} tickCount={4} />
            <Tooltip
              cursor={{ fill: 'var(--tg-hover)' }}
              isAnimationActive={false}
              content={p => <Tip noun={noun} column={p.active ? (p.payload?.[0]?.payload as TgaColumn | undefined) : undefined} />}
            />
            <Bar
              dataKey="count" fill="var(--tg-accent)" radius={[4, 4, 0, 0]} maxBarSize={24}
              activeBar={{ fill: 'var(--tg-accent-hover)' }}
              isAnimationActive={!reduce} animationDuration={420}
            >
              <LabelList
                dataKey="peak" position="top" offset={7} fontSize={11} fontWeight={600} fill="var(--tg-text-2)"
                formatter={(v: unknown) => (v == null ? '' : fmtInt(Number(v)))}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {columns.map(c => (
            <tr key={c.key}><th scope="row">{c.full}</th><td>{say(c.count, noun)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
