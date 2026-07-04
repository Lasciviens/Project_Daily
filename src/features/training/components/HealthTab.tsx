import { useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { useHealthWorkouts, useHealthMetrics } from '../hooks/useHealthExport'
import type { HealthWorkout } from '../api/healthApi'

// Verification/browse view — a plain table over whatever Health Auto Export
// has sent so far. No per-metric chart/visualization pass yet (deliberate:
// confirm the pipeline + full data shape first, polish later).

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function HealthWorkoutRow({ workout }: { workout: HealthWorkout }) {
  return (
    <div className="w-full rounded-xl border border-ink-100 bg-white min-h-[60px] flex overflow-hidden">
      <div className="w-1 shrink-0 bg-blue-400" />
      <div className="flex-1 px-3 py-2.5 flex flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-bold text-ink-900 truncate">{workout.name}</span>
          <span className="text-sm font-semibold text-ink-700 whitespace-nowrap shrink-0">
            {fmtDuration(workout.duration_seconds)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-500">{fmtDate(workout.start_time)}</span>
          {workout.avg_heart_rate != null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5">
              avg {Math.round(workout.avg_heart_rate)} bpm
            </span>
          )}
          {workout.active_energy_kj != null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5">
              {Math.round(workout.active_energy_kj)} kJ
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Metric value shape varies wildly (qty vs Min/Avg/Max vs multi-field sleep
// vs systolic/diastolic, etc.) — rather than a per-metric switch, show every
// field the point actually has (minus the columns already shown separately).
function formatMetricValue(value: Record<string, unknown>): string {
  const { date: _date, source: _source, ...rest } = value
  const entries = Object.entries(rest)
  if (entries.length === 0) return '—'
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`)
    .join(' · ')
}

const DAY_FILTERS: { label: string; days: number | null }[] = [
  { label: 'Last 7 days',  days: 7    },
  { label: 'Last 30 days', days: 30   },
  { label: 'Last 90 days', days: 90   },
  { label: 'All time',     days: null },
]

export function HealthTab() {
  const { data: workouts = [], isLoading: workoutsLoading } = useHealthWorkouts({ limit: 20 })
  const { data: metrics = [], isLoading: metricsLoading } = useHealthMetrics()

  const [metricFilter, setMetricFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState<number | null>(30)

  const metricNames = useMemo(
    () => [...new Set(metrics.map(m => m.metric_name))].sort(),
    [metrics]
  )
  const sources = useMemo(
    () => [...new Set(metrics.map(m => m.source).filter(Boolean))].sort(),
    [metrics]
  )

  const filteredMetrics = useMemo(() => {
    const cutoff = dayFilter != null ? subDays(new Date(), dayFilter) : null
    return metrics.filter(m => {
      if (metricFilter !== 'all' && m.metric_name !== metricFilter) return false
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
      if (cutoff && new Date(m.date) < cutoff) return false
      return true
    })
  }, [metrics, metricFilter, sourceFilter, dayFilter])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
          Health Workouts (Apple Health / Huawei)
        </p>
        {workoutsLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[60px] rounded-xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
            <p className="text-2xl mb-2">📱</p>
            <p className="text-ink-600 font-medium text-sm">No data synced yet</p>
            <p className="text-ink-400 text-xs mt-1">
              Configure a Health Auto Export REST API automation to send data here
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {workouts.map(w => <HealthWorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Health Metrics</p>
          <div className="flex gap-2 flex-wrap">
            <select
              value={metricFilter}
              onChange={e => setMetricFilter(e.target.value)}
              className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
            >
              <option value="all">All metrics</option>
              {metricNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
            >
              <option value="all">All sources</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={dayFilter ?? 'all'}
              onChange={e => setDayFilter(e.target.value === 'all' ? null : Number(e.target.value))}
              className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
            >
              {DAY_FILTERS.map(f => (
                <option key={f.label} value={f.days ?? 'all'}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {metricsLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : filteredMetrics.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
            <p className="text-2xl mb-2">📊</p>
            <p className="text-ink-600 font-medium text-sm">No metrics match this filter</p>
          </div>
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-50 border-b border-ink-100">
                <tr>
                  <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider whitespace-nowrap">Metric</th>
                  <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider whitespace-nowrap">Source</th>
                  <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {filteredMetrics.map(m => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{format(new Date(m.date), 'd MMM yyyy')}</td>
                    <td className="px-3 py-2 text-ink-800 font-medium whitespace-nowrap">{m.metric_name}</td>
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap max-w-[160px] truncate">{m.source || '—'}</td>
                    <td className="px-3 py-2 text-ink-700">{formatMetricValue(m.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-400 mt-1">{filteredMetrics.length} / {metrics.length} rows</p>
      </div>
    </div>
  )
}
