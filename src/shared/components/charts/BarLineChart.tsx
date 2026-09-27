import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { compactAxisTick } from './axisFormat'
import { useChartColors } from '../../ui'
import { TOOLTIP_BOX } from './chartKit'

// Translucent bar + connecting line with dots on top, same colour — used by
// the exercise progress chart, the body-composition trend and the workout HR
// curve. `rangeKey` optionally adds a faint [min,max] band behind the
// bar/line (the HR curve's range). Health's own trend charts use
// HealthTrendChart (with its pinned drill-down) instead.
type ChartPoint = Record<string, unknown>

interface TooltipEntry {
  dataKey?: string | number
  name?: string
  color?: string
  value?: number | [number, number]
}

// Bar + Line intentionally share the same dataKey/name (same value, two
// visual layers) — recharts' default Tooltip shows one row per graphical
// element, so without this it displayed the value twice. Dedupe by dataKey
// and keep the [min,max]/unit formatting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
function TooltipContent({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  const seen = new Set<string | number>()
  const rows: TooltipEntry[] = payload.filter((p: TooltipEntry) => {
    const key = p.dataKey ?? p.name ?? ''
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium text-fg-muted">{label}</p>
      {rows.map(r => (
        <p key={String(r.dataKey ?? r.name)} style={{ color: r.color }} className="font-semibold">
          {Array.isArray(r.value) ? `${r.value[0]}–${r.value[1]} ${unit}` : `${r.value} ${unit}`} {r.name}
        </p>
      ))}
    </div>
  )
}

export function BarLineChart({
  data, dataKey, color, unit, tooltipLabel, height = 112, xInterval, rangeKey, yDomain = ['auto', 'auto'],
}: {
  data: ChartPoint[]
  dataKey: string
  color: string
  unit: string
  tooltipLabel: string
  height?: number
  xInterval?: number
  rangeKey?: string
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
          {/* Hover trigger (default): the value appears the moment the
              pointer is over a point; on touch the first tap shows it. */}
          <Tooltip cursor={false} content={<TooltipContent unit={unit} />} />
          {rangeKey && <Area dataKey={rangeKey} name="Range" stroke="none" fill={color} fillOpacity={0.12} />}
          {/* barSize 16 + activeDot: the old 9px bar was well under a
              comfortable touch target. A bar click never navigates. */}
          <Bar dataKey={dataKey} name={tooltipLabel} fill={color} fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={16} activeBar={false} />
          <Line dataKey={dataKey} name={tooltipLabel} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
