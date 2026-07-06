import { useMemo, useState } from 'react'
import { format, isSameDay, startOfDay, subDays } from 'date-fns'
import { useHealthWorkouts, useHealthMetrics } from '../hooks/useHealthExport'
import type { HealthWorkout } from '../api/healthApi'

// Verification/browse view — a plain, filterable/sortable table over whatever
// Health Auto Export has sent so far. No per-metric chart/visualization pass
// yet (deliberate: confirm the pipeline + full data shape first, polish later).

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

// ─── Metric categorization ────────────────────────────────────────────────
// Health Auto Export's own metric_name strings aren't fully documented
// (vendor's site only lists display names, not every internal id) — keyword
// matching against the id is a pragmatic stand-in for a hardcoded lookup
// table we can't fully verify. Unmatched metrics fall into "Other" rather
// than guessing wrong.

const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['Sleep',           ['sleep']],
  ['Cardiovascular',  ['heart', 'blood_pressure', 'afib', 'atrial']],
  ['Respiratory',     ['respiratory', 'oxygen_saturation', 'expiratory', 'vital_capacity', 'inhaler', 'perfusion', 'peak_flow']],
  ['Mobility',        ['walking', 'stair', 'running_', 'six_minute']],
  ['Body',            ['weight', 'height', 'body_mass', 'body_fat', 'lean_body', 'waist']],
  ['Nutrition',       ['dietary', 'protein', 'carbohydrate', 'total_fat', 'fiber', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium',
                        'phosphorus', 'zinc', 'copper', 'manganese', 'selenium', 'iodine', 'chromium', 'molybdenum', 'chloride', 'caffeine',
                        'biotin', 'folate', 'niacin', 'pantothenic', 'riboflavin', 'thiamin', 'vitamin', 'cholesterol', 'sugar', 'water']],
  ['Health Records',  ['blood_glucose', 'insulin']],
  ['Lifestyle',        ['sexual_activity', 'handwashing', 'toothbrushing', 'fallen', 'alcohol', 'mindful']],
  ['Environmental',   ['audio_exposure', 'uv_exposure', 'daylight', 'underwater']],
  ['Activity',         ['step', 'energy', 'distance', 'flights', 'stand', 'move_time', 'exercise_time', 'cadence', 'vo2',
                        'physical_effort', 'push_count', 'swim', 'cycling']],
  ['Vitals',           ['temperature']],
]

function categorize(metricName: string): string {
  const n = metricName.toLowerCase()
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some(k => n.includes(k))) return category
  }
  return 'Other'
}

const CATEGORY_COLORS: Record<string, string> = {
  Activity:        'bg-orange-400',
  Body:            'bg-purple-400',
  Cardiovascular:  'bg-rose-400',
  Mobility:        'bg-teal-400',
  Respiratory:     'bg-sky-400',
  Sleep:           'bg-indigo-400',
  Vitals:          'bg-pink-400',
  Nutrition:       'bg-lime-500',
  'Health Records': 'bg-red-400',
  Lifestyle:       'bg-fuchsia-400',
  Environmental:   'bg-emerald-400',
  Other:           'bg-ink-300',
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

type DayFilter = 'today' | 'yesterday' | '7' | '30' | '90' | 'all'

const DAY_FILTER_OPTIONS: { value: DayFilter; label: string }[] = [
  { value: 'today',     label: 'Today'        },
  { value: 'yesterday', label: 'Yesterday'    },
  { value: '7',         label: 'Last 7 days'  },
  { value: '30',        label: 'Last 30 days' },
  { value: '90',        label: 'Last 90 days' },
  { value: 'all',       label: 'All time'     },
]

function matchesDayFilter(dateStr: string, filter: DayFilter): boolean {
  if (filter === 'all') return true
  const d = new Date(dateStr)
  const today = startOfDay(new Date())
  if (filter === 'today') return isSameDay(d, today)
  if (filter === 'yesterday') return isSameDay(d, subDays(today, 1))
  // "Last N days" means today + the previous (N-1) days = N days total.
  // subDays(today, N) would include one extra day (N+1 total).
  return d >= subDays(today, Number(filter) - 1)
}

type SortCol = 'date' | 'category' | 'metric' | 'source'

function SortHeader({
  label, col, sortBy, sortDir, onSort,
}: {
  label: string
  col: SortCol
  sortBy: SortCol
  sortDir: 'asc' | 'desc'
  onSort: (col: SortCol) => void
}) {
  const active = sortBy === col
  return (
    <th
      onClick={() => onSort(col)}
      className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-ink-800 select-none"
    >
      {label} <span className={active ? 'text-accent-600' : 'text-ink-300'}>{active && sortDir === 'asc' ? '▲' : '▼'}</span>
    </th>
  )
}

export function HealthTab() {
  const { data: workouts = [], isLoading: workoutsLoading } = useHealthWorkouts({ limit: 20 })
  const { data: metrics = [], isLoading: metricsLoading } = useHealthMetrics()

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [metricFilter, setMetricFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState<DayFilter>('30')
  const [sortBy, setSortBy] = useState<SortCol>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const withCategory = useMemo(
    () => metrics.map(m => ({ ...m, __category: categorize(m.metric_name) })),
    [metrics]
  )

  const categories = useMemo(
    () => [...new Set(withCategory.map(m => m.__category))].sort(),
    [withCategory]
  )
  const metricNames = useMemo(
    () => [...new Set(
      withCategory
        .filter(m => categoryFilter === 'all' || m.__category === categoryFilter)
        .map(m => m.metric_name)
    )].sort(),
    [withCategory, categoryFilter]
  )
  const sources = useMemo(
    () => [...new Set(metrics.map(m => m.source).filter(Boolean))].sort(),
    [metrics]
  )

  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('asc') }
  }

  const rows = useMemo(() => {
    const filtered = withCategory.filter(m => {
      if (categoryFilter !== 'all' && m.__category !== categoryFilter) return false
      if (metricFilter !== 'all' && m.metric_name !== metricFilter) return false
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
      if (!matchesDayFilter(m.date, dayFilter)) return false
      return true
    })
    const cmp = (a: (typeof filtered)[number], b: (typeof filtered)[number]) => {
      if (sortBy === 'date') return a.date.localeCompare(b.date)
      if (sortBy === 'category') return a.__category.localeCompare(b.__category)
      if (sortBy === 'metric') return a.metric_name.localeCompare(b.metric_name)
      return (a.source || '').localeCompare(b.source || '')
    }
    filtered.sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)))
    return filtered
  }, [withCategory, categoryFilter, metricFilter, sourceFilter, dayFilter, sortBy, sortDir])

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
            <p className="text-ink-600 font-medium text-sm">No workouts synced yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {workouts.map(w => <HealthWorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">Health Metrics</p>

        {/* Category pills — quick filter, derived from data actually present */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
          <button
            type="button"
            onClick={() => { setCategoryFilter('all'); setMetricFilter('all') }}
            className={`min-h-[32px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              categoryFilter === 'all' ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { setCategoryFilter(c); setMetricFilter('all') }}
              className={`min-h-[32px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
                categoryFilter === c ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_COLORS[c] ?? 'bg-ink-300'}`} />
              {c}
            </button>
          ))}
        </div>

        {/* Secondary filters */}
        <div className="flex gap-2 flex-wrap mb-2">
          <select
            value={metricFilter}
            onChange={e => setMetricFilter(e.target.value)}
            className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
          >
            <option value="all">All metrics{categoryFilter !== 'all' ? ` in ${categoryFilter}` : ''}</option>
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
            value={dayFilter}
            onChange={e => setDayFilter(e.target.value as DayFilter)}
            className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
          >
            {DAY_FILTER_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {metricsLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
            <p className="text-2xl mb-2">📊</p>
            <p className="text-ink-600 font-medium text-sm">No metrics match this filter</p>
          </div>
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-50 border-b border-ink-100 sticky top-0">
                <tr>
                  <SortHeader label="Date"     col="date"     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Category" col="category" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Metric"   col="metric"   sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Source"   col="source"   sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {rows.map(m => (
                  <tr key={m.id} className="hover:bg-cream-50">
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{format(new Date(m.date), 'd MMM yyyy')}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-600">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CATEGORY_COLORS[m.__category] ?? 'bg-ink-300'}`} />
                        {m.__category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-800 font-medium whitespace-nowrap">{m.metric_name}</td>
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap max-w-[160px] truncate">{m.source || '—'}</td>
                    <td className="px-3 py-2 text-ink-700">{formatMetricValue(m.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-400 mt-1">{rows.length} / {metrics.length} rows</p>
      </div>
    </div>
  )
}
