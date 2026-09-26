import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from 'recharts'
import { axisTicks, type TgaActivity } from './tgAnalyticsSeries'
import { useReducedMotion } from './tgAnalyticsClock'
import { fmtInt } from './tgAnalyticsFormat'
import { TGA_LIB_LABEL, activityRows, libFill, markerFits, type TgaActivityRow } from './tgAnalyticsActivity'
import { TgActivityAxisTick, TgActivityMarker, TgActivityTip } from './TgAnalyticsActivityParts'

const AXIS_TICK = { fontSize: 11, fill: 'var(--tg-muted)' }
/** The y-axis gutter, which the column width math leaves out. */
const Y_AXIS = 32

/**
 * Stacked columns, one colour per library, 24px at most with a rounded
 * data-end on whichever segment is on top and a 1px seam of the card's own
 * surface between segments. Completions ride above the stack as markers. The
 * tooltip (hover, or arrow keys once the chart has focus) and a
 * screen-reader table carry every value.
 */
export function TgAnalyticsActivityChart({ series, height, caption }: { series: TgaActivity; height: number; caption: string }) {
  const reduce = useReducedMotion()
  const [width, setWidth] = useState(0)
  const rows = useMemo(() => activityRows(series), [series])
  const ticks = useMemo(() => axisTicks(series.columns, width - Y_AXIS - 8, false), [series.columns, width])
  const pill = markerFits(width - Y_AXIS - 8, rows.length)
  const twoLines = series.columns.some(c => c.group)
  const { libraries } = series

  return (
    <>
      <div style={{ height }} className="-ml-2 -mr-1">
        <ResponsiveContainer width="100%" height="100%" onResize={w => setWidth(w)}>
          <BarChart data={rows} margin={{ top: 24, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%" accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--tg-border)" />
            <XAxis
              dataKey="key" ticks={[...ticks.keys()]} interval={0} tickLine={false}
              tick={(p: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => <TgActivityAxisTick {...p} label={ticks.get(String(p.payload?.value))} />}
              axisLine={{ stroke: 'var(--tg-border-strong)' }} tickMargin={6} height={twoLines ? 40 : 26}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={Y_AXIS} tickCount={4} />
            <Tooltip
              cursor={{ fill: 'var(--tg-hover)' }}
              isAnimationActive={false}
              content={p => <TgActivityTip libraries={libraries} row={p.active ? (p.payload?.[0]?.payload as TgaActivityRow | undefined) : undefined} />}
            />
            {libraries.map(lib => (
              <Bar
                key={lib} dataKey={lib} name={TGA_LIB_LABEL[lib]} stackId="games" fill={libFill(lib)} maxBarSize={24}
                isAnimationActive={!reduce} animationDuration={420}
                shape={(p: BarShapeProps) => (
                  <Rectangle {...p} radius={(p.payload as TgaActivityRow | undefined)?.top === lib ? [4, 4, 0, 0] : 0} stroke="var(--tg-panel)" strokeWidth={1} />
                )}
              />
            ))}
            {/* A zero-height top segment: recharts still calls a custom shape for it, at the stack's total. */}
            <Bar
              dataKey="cap" stackId="games" isAnimationActive={false} legendType="none" tooltipType="none"
              shape={(p: BarShapeProps) => (
                <TgActivityMarker cx={p.x + p.width / 2} cy={p.y} n={(p.payload as TgaActivityRow | undefined)?.done ?? null} pill={pill} />
              )}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {libraries.map(lib => <th key={lib} scope="col">{TGA_LIB_LABEL[lib]}</th>)}
            <th scope="col">Completions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <th scope="row">{r.full}</th>
              {libraries.map(lib => <td key={lib}>{fmtInt(r[lib])}</td>)}
              <td>{fmtInt(r.completed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
