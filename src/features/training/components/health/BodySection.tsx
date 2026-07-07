import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function BodySection() {
  // Weight is a sparse, event-based metric (only updates when you step on the
  // scale) — a wide window so the chart isn't mostly empty.
  const from = daysAgoStr(89)
  const to = todayStr()
  const { data: weightPoints = [], isLoading } = useHealthMetricSeries('weight_body_mass', from, to)
  const { data: fatPoints = [] } = useHealthMetricSeries('body_fat_percentage', from, to)
  const { data: bmiPoints = [] } = useHealthMetricSeries('body_mass_index', from, to)

  const weight = computeDailySeries('weight_body_mass', weightPoints)
  const fat = computeDailySeries('body_fat_percentage', fatPoints)
  const bmi = computeDailySeries('body_mass_index', bmiPoints)

  const chartData = weight.map(w => ({ label: fmtDay(w.date), date: w.date, weight: Math.round(w.value * 10) / 10 }))
  const latestWeight = weight[weight.length - 1]?.value
  const latestFat = fat[fat.length - 1]?.value
  const latestBmi = bmi[bmi.length - 1]?.value

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">⚖️ Weight</p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : latestWeight != null ? `${latestWeight.toFixed(1)}` : '—'}
            <span className="text-sm font-normal text-ink-400"> kg</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          {latestFat != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{latestFat.toFixed(1)}%</p>
              <p className="text-[10px] text-ink-400">body fat</p>
            </div>
          )}
          {latestBmi != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{latestBmi.toFixed(1)}</p>
              <p className="text-[10px] text-ink-400">BMI</p>
            </div>
          )}
        </div>
      </div>

      {chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-6 text-center">No weigh-ins yet in the last 90 days.</p>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={34} domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => [`${v} kg`, 'Weight']} />
              <Bar dataKey="weight" fill="#a78bfa" fillOpacity={0.35} radius={[3, 3, 0, 0]} barSize={10} />
              <Line dataKey="weight" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
