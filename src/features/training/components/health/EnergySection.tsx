import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'

function fmtDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function EnergySection() {
  const from = daysAgoStr(13)
  const to = todayStr()
  const { data: activePoints = [], isLoading: activeLoading } = useHealthMetricSeries('active_energy', from, to)
  const { data: basalPoints = [] } = useHealthMetricSeries('basal_energy_burned', from, to)

  const activeSeries = computeDailySeries('active_energy', activePoints)
  const basalSeries = computeDailySeries('basal_energy_burned', basalPoints)

  const byDate = new Map<string, { date: string; active: number; basal: number }>()
  for (const d of activeSeries) byDate.set(d.date, { date: d.date, active: Math.round(d.value), basal: 0 })
  for (const d of basalSeries) {
    const row = byDate.get(d.date) ?? { date: d.date, active: 0, basal: 0 }
    row.basal = Math.round(d.value)
    byDate.set(d.date, row)
  }
  const chartData = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, label: fmtDay(d.date) }))

  const todayRow = chartData[chartData.length - 1]
  const totalToday = (todayRow?.active ?? 0) + (todayRow?.basal ?? 0)

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">🔥 Energy Today</p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {activeLoading ? '…' : totalToday.toLocaleString('en-GB')} <span className="text-sm font-normal text-ink-400">kcal</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-lg font-bold text-rose-500">{todayRow?.active ?? 0}</p>
            <p className="text-[10px] text-ink-400">active</p>
          </div>
          <div>
            <p className="text-lg font-bold text-ink-500">{todayRow?.basal ?? 0}</p>
            <p className="text-[10px] text-ink-400">basal</p>
          </div>
        </div>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="basal" name="Basal" stackId="1" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.4} />
            <Area type="monotone" dataKey="active" name="Active" stackId="1" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.6} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
