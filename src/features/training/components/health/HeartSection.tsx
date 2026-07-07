import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeHeartRateDailySeries, computeDailySeries } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function HeartSection() {
  const from = daysAgoStr(13)
  const to = todayStr()
  const { data: hrPoints = [], isLoading } = useHealthMetricSeries('heart_rate', from, to)
  const { data: restingPoints = [] } = useHealthMetricSeries('resting_heart_rate', from, to)
  const { data: hrvPoints = [] } = useHealthMetricSeries('heart_rate_variability', from, to)

  const ranges = computeHeartRateDailySeries(hrPoints)
  const resting = computeDailySeries('resting_heart_rate', restingPoints)
  const restingByDate = new Map(resting.map(d => [d.date, d.value]))
  const hrv = computeDailySeries('heart_rate_variability', hrvPoints)
  const hrvByDate = new Map(hrv.map(d => [d.date, d.value]))

  const chartData = ranges.map(r => ({
    label: fmtDay(r.date),
    range: [Math.round(r.min), Math.round(r.max)] as [number, number],
    avg: Math.round(r.avg),
    resting: restingByDate.has(r.date) ? Math.round(restingByDate.get(r.date)!) : null,
  }))

  const todayRange = ranges[ranges.length - 1]
  const todayResting = restingByDate.get(to)
  const todayHrv = hrvByDate.get(to)

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">❤️ Heart Rate Today</p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : todayRange ? `${Math.round(todayRange.min)}–${Math.round(todayRange.max)}` : '—'}
            <span className="text-sm font-normal text-ink-400"> bpm</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          {todayResting != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(todayResting)}</p>
              <p className="text-[10px] text-ink-400">resting</p>
            </div>
          )}
          {todayHrv != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(todayHrv)}</p>
              <p className="text-[10px] text-ink-400">HRV ms</p>
            </div>
          )}
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
            <Tooltip />
            <Area dataKey="range" name="Range" stroke="none" fill="#fb7185" fillOpacity={0.25} />
            <Line dataKey="avg" name="Avg" stroke="#e11d48" strokeWidth={2} dot={false} />
            <Line dataKey="resting" name="Resting" stroke="#6366f1" strokeWidth={2} dot={false} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
