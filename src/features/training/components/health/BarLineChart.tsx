import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// Canonical Health-tab chart style — translucent bar + connecting line with
// dots on top, same color. Established with Body's weight/fat/BMI charts;
// reused everywhere else in Health (Heart, and future sections) rather than
// picking a different chart type per section. `rangeKey` optionally adds a
// faint [min,max] band behind the bar/line (used by Heart for its daily range).
export function BarLineChart({
  data, dataKey, color, unit, tooltipLabel, height = 112, xInterval, rangeKey,
}: {
  data: Record<string, unknown>[]
  dataKey: string
  color: string
  unit: string
  tooltipLabel: string
  height?: number
  xInterval?: number
  rangeKey?: string
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={xInterval} />
          <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
          <Tooltip formatter={(v) => [`${v} ${unit}`, tooltipLabel]} />
          {rangeKey && <Area dataKey={rangeKey} name="Range" stroke="none" fill={color} fillOpacity={0.12} />}
          <Bar dataKey={dataKey} fill={color} fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={9} />
          <Line dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
