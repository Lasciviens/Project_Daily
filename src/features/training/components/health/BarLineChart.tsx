import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// Canonical Health-tab chart style — translucent bar + connecting line with
// dots on top, same color. Established with Body's weight/fat/BMI charts;
// reused everywhere else in Health (Heart, and future sections) rather than
// picking a different chart type per section. `rangeKey` optionally adds a
// faint [min,max] band behind the bar/line (used by Heart for its daily range).
type ChartPoint = Record<string, unknown>

export function BarLineChart({
  data, dataKey, color, unit, tooltipLabel, height = 112, xInterval, rangeKey, onPointClick,
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
}) {
  const barProps = onPointClick
    ? { cursor: 'pointer', onClick: (point: { payload?: ChartPoint }) => point.payload && onPointClick(point.payload) }
    : {}

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={xInterval} />
          <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
          <Tooltip
            formatter={(v, name) => Array.isArray(v)
              ? [`${v[0]}–${v[1]} ${unit}`, name]
              : [`${v} ${unit}`, name]}
          />
          {rangeKey && <Area dataKey={rangeKey} name="Range" stroke="none" fill={color} fillOpacity={0.12} />}
          <Bar dataKey={dataKey} name={tooltipLabel} fill={color} fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={9} {...barProps} />
          <Line dataKey={dataKey} name={tooltipLabel} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
