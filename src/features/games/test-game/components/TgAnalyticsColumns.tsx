import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TgaColumn } from './tgAnalyticsSeries'
import { useReducedMotion } from './tgAnalyticsClock'
import { fmtInt } from './tgAnalyticsFormat'

interface Noun { one: string; many: string }
const say = (n: number, noun: Noun) => `${fmtInt(n)} ${n === 1 ? noun.one : noun.many}`

const AXIS_TICK = { fontSize: 11, fill: 'var(--tg-muted)' }

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
  const ticks = useMemo(() => new Map(columns.map(c => [c.key, c.tick])), [columns])
  const peak = useMemo(() => {
    let at = -1, max = 0
    columns.forEach((c, i) => { if (c.count > max) { max = c.count; at = i } })
    return at
  }, [columns])

  return (
    <>
      <div style={{ height }} className="-ml-2 -mr-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={columns} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%" accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--tg-border)" />
            <XAxis
              dataKey="key" tickFormatter={(k: string) => ticks.get(k) ?? ''} tick={AXIS_TICK}
              tickLine={false} axisLine={{ stroke: 'var(--tg-border-strong)' }}
              interval={allTicks ? 0 : 'preserveStartEnd'} minTickGap={10} tickMargin={8} height={28}
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
                dataKey="count"
                content={({ x, y, width, value, index }) => (index === peak ? (
                  <text
                    x={Number(x) + Number(width) / 2} y={Number(y) - 7} textAnchor="middle"
                    fontSize={11} fontWeight={600} fill="var(--tg-text-2)"
                  >
                    {fmtInt(Number(value))}
                  </text>
                ) : null)}
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
