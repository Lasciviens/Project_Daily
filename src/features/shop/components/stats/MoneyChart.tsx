import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../../../../shared/components/charts/chartKit'
import { compactAxisTick } from '../../../../shared/components/charts/axisFormat'
import { add, type Amount } from '../../ownModel'
import type { MonthRow } from '../../statsModel'
import { MONTHS, monthIndex, monthName, notCounted, num } from './statsFormat'

const Y_AXIS = 36

interface Point { month: string; out: number; back: number; row: MonthRow }

/** 1, 2, 2.5 or 5 × 10ⁿ at or above `raw`. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

/** Round ticks from the lowest stack to the highest, always through zero (bars start at zero). */
function valueScale(data: Point[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(0, ...data.map(d => Math.min(d.out, 0) + Math.min(d.back, 0)))
  const hi = Math.max(0, ...data.map(d => Math.max(d.out, 0) + Math.max(d.back, 0)))
  if (lo === 0 && hi === 0) return { domain: [0, 1], ticks: [0] }
  const step = niceStep((hi - lo) / 4)
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.round(t))
  return { domain: [a, b], ticks }
}

/**
 * The axis: a year's months by name (as long as the bars' width allows), or
 * for 24 months a label every 3, 6 or 12 months with its year.
 */
function axisTicks(rows: MonthRow[], withYear: boolean, plotPx: number): { ticks: string[]; label: (k: string) => string } {
  const per = rows.length ? plotPx / rows.length : 0
  if (!withYear) {
    const label = per >= 66 ? (k: string) => MONTHS[monthIndex(k)] : per >= 26 ? (k: string) => MONTHS[monthIndex(k)].slice(0, 3) : (k: string) => MONTHS[monthIndex(k)][0]
    return { ticks: rows.map(r => r.month), label }
  }
  const every = [3, 6, 12].find(k => per * k >= 64) ?? 12
  return { ticks: rows.map(r => r.month).filter(k => monthIndex(k) % every === 0), label: k => `${MONTHS[monthIndex(k)].slice(0, 3)} ${k.slice(0, 4)}` }
}

/**
 * Money out (below zero) and money back (above) per month, in NOK at each
 * day's rate. Only the amounts that are known are drawn; the rest are counted
 * under the chart. A bar opens that month's purchases and sales.
 */
export function MoneyChart({ rows, withYear, onMonth }: { rows: MonthRow[]; withYear: boolean; onMonth: (month: string) => void }) {
  const c = useChartColors()
  const [width, setWidth] = useState(0)
  const data = useMemo<Point[]>(() => rows.map(r => ({ month: r.month, out: -r.spent.nok, back: r.got.nok, row: r })), [rows])
  const { ticks, label } = axisTicks(rows, withYear, Math.max(0, width - Y_AXIS - 8))
  const scale = useMemo(() => valueScale(data), [data])
  const note = notCounted(add(...rows.flatMap(r => [r.spent, r.got])))
  const empty = rows.every(r => r.ids.length === 0)

  if (empty) return <p className="text-body text-fg-muted">Nothing was bought or sold in these months.</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="h-52 w-full max-w-4xl">
        <ResponsiveContainer width="100%" height="100%" onResize={w => setWidth(w)}>
          <BarChart
            data={data} stackOffset="sign" margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%"
            onClick={s => { const p = typeof s?.activeIndex === 'number' ? data[s.activeIndex] : undefined; if (p && p.row.ids.length) onMonth(p.month) }}
          >
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="month" ticks={ticks} interval={0} tickFormatter={label} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.axis }} tickMargin={6} />
            <YAxis width={Y_AXIS} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.axis }}
              tickFormatter={v => compactAxisTick(Math.abs(Number(v)))} domain={scale.domain} ticks={scale.ticks} interval={0} />
            <ReferenceLine y={0} stroke={c.axis} strokeOpacity={0.6} />
            <Tooltip cursor={{ fill: c.grid, fillOpacity: 0.45 }} isAnimationActive={false}
              content={p => <MoneyTip row={p.active ? (p.payload?.[0]?.payload as Point | undefined)?.row : undefined} withYear={withYear} colors={[c.series[0], c.series[1]]} />} />
            <Bar dataKey="out" name="Spent" stackId="money" fill={c.series[0]} maxBarSize={24} radius={[4, 4, 0, 0]} className="cursor-pointer" />
            <Bar dataKey="back" name="Got back" stackId="money" fill={c.series[1]} maxBarSize={24} radius={[4, 4, 0, 0]} className="cursor-pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {note && <p className="text-meta text-fg-muted">{note}</p>}
      {/* The values for screen readers, in a clipped box (a table ignores a 1px width). */}
      <div className="sr-only">
        <table>
          <caption>Money spent and got back by month, in NOK</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Spent</th><th scope="col">Got back</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.month}><th scope="row">{monthName(r.month, true)}</th><td>{cell(r.spent)}</td><td>{cell(r.got)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const cell = (a: Amount) => `${num(a.nok)} NOK${a.missing + a.pending ? ` + ${a.missing + a.pending} not counted` : ''}`

function MoneyTip({ row, withYear, colors }: { row: MonthRow | undefined; withYear: boolean; colors: [string, string] }) {
  if (!row) return null
  const line = (a: Amount, word: string, color: string) => (
    <p className="flex items-center gap-1.5">
      <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      <span className="font-semibold tabular-nums text-fg">{num(a.nok)} NOK</span>
      <span className="text-fg-muted">{word}{a.missing + a.pending ? ` + ${a.missing + a.pending} not counted` : ''}</span>
    </p>
  )
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium text-fg-muted">{monthName(row.month, withYear)}</p>
      {line(row.spent, 'spent', colors[0])}
      {line(row.got, 'got back', colors[1])}
    </div>
  )
}
