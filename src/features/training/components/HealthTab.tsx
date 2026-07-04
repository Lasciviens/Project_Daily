import { format, subDays } from 'date-fns'
import { useHealthWorkouts, useHealthMetric } from '../hooks/useHealthExport'
import type { HealthWorkout, HealthMetric } from '../api/healthApi'

// v1: a minimal "is data flowing?" view — a plain list of synced workouts and
// a handful of key daily metrics. Calendar-merge with Hevy/Strava and richer
// charts are a deliberate follow-up once the pipeline itself is confirmed working.

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

// Each metric's `value` jsonb shape differs — these extract a single display
// number/string per metric_name. Add a case here when showing a new metric.
function metricDisplayValue(m: HealthMetric): string {
  switch (m.metric_name) {
    case 'sleep_analysis':
      return m.value.totalSleep != null ? `${m.value.totalSleep.toFixed(1)} hr` : '—'
    case 'heart_rate':
      return m.value.Avg != null ? `${Math.round(m.value.Avg)} bpm` : '—'
    default:
      return m.value.qty != null ? `${Math.round(m.value.qty * 10) / 10}${m.unit ? ` ${m.unit}` : ''}` : '—'
  }
}

function MetricCard({ title, metricName }: { title: string; metricName: string }) {
  const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const { data: points = [], isLoading } = useHealthMetric(metricName, { from: weekAgo, limit: 7 })

  return (
    <div className="rounded-xl border border-ink-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-cream-50 border-b border-ink-100">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{title}</p>
      </div>
      {isLoading ? (
        <div className="h-16 bg-cream-100 animate-pulse" />
      ) : points.length === 0 ? (
        <p className="text-xs text-ink-400 px-3 py-3">No data yet</p>
      ) : (
        <div className="divide-y divide-ink-50">
          {points.map(p => (
            <div key={p.id} className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs text-ink-500">{format(new Date(p.date), 'd MMM')}</span>
              <span className="text-sm font-semibold text-ink-800">{metricDisplayValue(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HealthTab() {
  const { data: workouts = [], isLoading: workoutsLoading } = useHealthWorkouts({ limit: 10 })

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
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">Last 7 days</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <MetricCard title="Steps" metricName="step_count" />
          <MetricCard title="Sleep" metricName="sleep_analysis" />
          <MetricCard title="Resting Heart Rate" metricName="resting_heart_rate" />
        </div>
      </div>
    </div>
  )
}
