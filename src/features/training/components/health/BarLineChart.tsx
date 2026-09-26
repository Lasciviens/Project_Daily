import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { compactAxisTick } from './axisFormat'
import { useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../chartKit'

// Canonical Health-tab chart style — translucent bar + connecting line with
// dots on top, same color. Established with Body's weight/fat/BMI charts;
// reused everywhere else in Health (Heart, and future sections) rather than
// picking a different chart type per section. `rangeKey` optionally adds a
// faint [min,max] band behind the bar/line (used by Heart for its daily range).
type ChartPoint = Record<string, unknown>

interface TooltipEntry {
  dataKey?: string | number
  name?: string
  color?: string
  value?: number | [number, number]
}

// Bar + Line intentionally share the same dataKey/name (same value, two
// visual layers) — recharts' default Tooltip shows one row per graphical
// element, so without this it displayed the average twice. Dedupe by
// dataKey and keep the custom [min,max]/unit formatting the old `formatter`
// prop had.
//
// "Go to this day" link: the explicit link inside the tooltip is the only
// thing that navigates; a bar click never does.
function makeTooltipContent(unit: string, onPointClick?: (point: ChartPoint) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  return function TooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    const seen = new Set<string | number>()
    const rows: TooltipEntry[] = payload.filter((p: TooltipEntry) => {
      const key = p.dataKey ?? p.name ?? ''
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const rawPoint = payload[0]?.payload as ChartPoint | undefined
    return (
      <div className={TOOLTIP_BOX}>
        <p className="font-medium text-fg-muted">{label}</p>
        {rows.map(r => (
          <p key={String(r.dataKey ?? r.name)} style={{ color: r.color }} className="font-semibold">
            {Array.isArray(r.value) ? `${r.value[0]}–${r.value[1]} ${unit}` : `${r.value} ${unit}`} {r.name}
          </p>
        ))}
        {onPointClick && rawPoint && (
          <button
            type="button"
            onClick={() => onPointClick(rawPoint)}
            className="flex min-h-[44px] items-center py-1.5 text-meta font-semibold text-accent-600"
          >
            Go to this day →
          </button>
        )}
      </div>
    )
  }
}

export function BarLineChart({
  data, dataKey, color, unit, tooltipLabel, height = 112, xInterval, rangeKey, onPointClick, yDomain = ['auto', 'auto'],
}: {
  data: ChartPoint[]
  dataKey: string
  color: string
  unit: string
  tooltipLabel: string
  height?: number
  xInterval?: number
  rangeKey?: string
  // Fires with the clicked point's raw data (e.g. { date: '2026-07-06', ... })
  // — used to jump a week/month chart to that day's Day view.
  onPointClick?: (point: ChartPoint) => void
  // Health tab's own charts (heart rate, weight) deliberately zoom into a
  // narrow range — an 'auto' domain is the right call there. But a Bar
  // sharing the SAME dataKey as the Line (this component's whole point)
  // draws from whatever the axis's computed minimum is, not from zero — for
  // a trend like "my squat 1RM over time" that makes bars near the axis
  // floor look almost invisible while later ones look disproportionately
  // tall, which reads as broken rather than zoomed-in. Progress-tab callers
  // pass [0, 'auto'] to opt into a true-to-magnitude bar; every existing
  // Health-tab call site is untouched (default unchanged).
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
}) {
  const c = useChartColors()
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} interval={xInterval} />
          {/* width/margin: 2-digit bpm ticks fitted by luck — a 3-digit or
              4-digit axis clipped to slivers of glyphs. See axisFormat.ts. */}
          <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} domain={yDomain} />
          {/* Hover trigger (default): per explicit user request, the value
              must appear the moment the pointer is over a point — no click
              needed. On touch, the first tap acts as hover and still shows
              it. wrapperStyle pointerEvents: recharts tooltips are
              pointer-events:none by default — without overriding this, the
              "Go to this day" link inside would render but never actually
              receive a click. */}
          <Tooltip cursor={false} content={makeTooltipContent(unit, onPointClick)} wrapperStyle={{ pointerEvents: 'auto' }} />
          {rangeKey && <Area dataKey={rangeKey} name="Range" stroke="none" fill={color} fillOpacity={0.12} />}
          {/* barSize bumped from 9 to 16 and activeDot added — the old size
              was well under a comfortable touch tap target. Clicking a bar
              only opens/updates the tooltip now (see Tooltip trigger="click"
              above) — it no longer navigates by itself; "See details"
              inside the tooltip is the only thing that does. */}
          <Bar dataKey={dataKey} name={tooltipLabel} fill={color} fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={16} activeBar={false} />
          <Line dataKey={dataKey} name={tooltipLabel} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
