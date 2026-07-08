import { useMemo, useState } from 'react'
import { format, isSameDay, startOfDay, subDays } from 'date-fns'
import { useHealthWorkouts, useHealthMetrics } from '../hooks/useHealthExport'
import { categorize, CATEGORY_COLORS, METRIC_AGGREGATION } from '../healthMetrics'
import { computeDailySeries } from '../healthAggregate'
import { ActivityRings } from './health/ActivityRings'
import { StepsSection } from './health/StepsSection'
import { EnergySection } from './health/EnergySection'
import { HeartSection } from './health/HeartSection'
import { SleepSection } from './health/SleepSection'
import { BodySection } from './health/BodySection'
import { SECTIONS, type SectionId } from './health/sectionTypes'
import type { HealthWorkout, HealthMetric } from '../api/healthApi'

// Apple Health-inspired browse view: activity rings + dedicated sections per
// metric group (steps/energy/heart/sleep/body), with a generic filterable
// table underneath for anything not (yet) given its own section.

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

function WorkoutsList() {
  const [expanded, setExpanded] = useState(false)
  const { data: workouts = [], isLoading } = useHealthWorkouts({ limit: 20 })
  return (
    <div className="bg-white border border-ink-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 min-h-[44px] py-2"
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
          🏃 Health Workouts (Apple Health / Huawei) {workouts.length > 0 && `· ${workouts.length}`}
        </p>
        <span className="text-ink-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {isLoading ? (
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
      )}
    </div>
  )
}

// ─── Generic "All Data" table ───────────────────────────────────────────────

// Metric value shape varies wildly (qty vs Min/Avg/Max vs multi-field sleep
// vs raw sleep-segment). Dumping every raw field (including timestamps like
// start/end/context) reads as noise to a human — pick the 1-2 numbers that
// actually answer "what was the value" and format them plainly, with the
// metric's own unit appended once at the end.
function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function formatMetricValue(value: Record<string, unknown>, unit: string | null): string {
  const u = unit ? ` ${unit}` : ''

  // Pre-aggregated sleep (Summarize on): one point/day with stage breakdown.
  if (typeof value.totalSleep === 'number') {
    const core = typeof value.core === 'number' ? value.core : 0
    const rem  = typeof value.rem  === 'number' ? value.rem  : 0
    const deep = typeof value.deep === 'number' ? value.deep : 0
    return `total ${fmtNum(value.totalSleep)}${u} · core ${fmtNum(core)}${u} · rem ${fmtNum(rem)}${u} · deep ${fmtNum(deep)}${u}`
  }

  // Raw sleep segment (Summarize off): a stage label + its duration.
  if (typeof value.value === 'string' && typeof value.qty === 'number') {
    return `${value.value}: ${fmtNum(value.qty)}${u}`
  }

  // Min/Avg/Max-shaped points (heart_rate).
  if (typeof value.Avg === 'number' || typeof value.Min === 'number' || typeof value.Max === 'number') {
    const avg = typeof value.Avg === 'number' ? `avg ${fmtNum(value.Avg)}${u}` : null
    const range = typeof value.Min === 'number' && typeof value.Max === 'number'
      ? ` (${fmtNum(value.Min)}–${fmtNum(value.Max)}${u})` : ''
    return (avg ?? '—') + range
  }

  // Plain quantity — the common case (steps, energy, distance, weight, etc.).
  if (typeof value.qty === 'number') return `${fmtNum(value.qty)}${u}`

  // Unrecognized shape — fall back to showing whatever fields aren't pure
  // metadata (timestamps/context), rather than silently showing nothing.
  const METADATA_KEYS = new Set(['date', 'source', 'start', 'end', 'startDate', 'endDate', 'inBedStart', 'inBedEnd', 'context'])
  const entries = Object.entries(value).filter(([k]) => !METADATA_KEYS.has(k))
  if (entries.length === 0) return '—'
  return entries.map(([k, v]) => `${k}: ${typeof v === 'number' ? fmtNum(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')
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

// Every metric with a dedicated chart/card elsewhere in the Health tab
// (Steps/Energy/Heart/Sleep/Body sections + their mini-metric grids) —
// keeping this table to genuinely-unclassified metrics we don't know about
// yet, instead of duplicating everything that already has a home.
const CHARTED_METRICS = new Set(Object.keys(METRIC_AGGREGATION))

type CategorizedMetric = HealthMetric & { __category: string }
type AggRow = { date: string; category: string; metric_name: string; value: number; unit: string | null }

function fmtNum2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function buildAggregatedRows(filtered: CategorizedMetric[]): AggRow[] {
  const byMetric = new Map<string, CategorizedMetric[]>()
  for (const m of filtered) {
    const arr = byMetric.get(m.metric_name)
    if (arr) arr.push(m); else byMetric.set(m.metric_name, [m])
  }
  const out: AggRow[] = []
  for (const [metricName, pts] of byMetric) {
    const category = pts[0].__category
    const unit = pts.find(p => p.unit)?.unit ?? null
    for (const d of computeDailySeries(metricName, pts)) {
      out.push({ date: d.date, category, metric_name: metricName, value: d.value, unit })
    }
  }
  return out
}

type ViewMode = 'aggregated' | 'detailed'

function AllDataTable() {
  const { data: metrics = [], isLoading: metricsLoading } = useHealthMetrics()

  const [viewMode, setViewMode] = useState<ViewMode>('aggregated')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [metricFilter, setMetricFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState<DayFilter>('30')
  const [sortBy, setSortBy] = useState<SortCol>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const remaining = useMemo(
    () => metrics
      .filter(m => !CHARTED_METRICS.has(m.metric_name))
      .map(m => ({ ...m, __category: categorize(m.metric_name) })),
    [metrics]
  )

  const categories = useMemo(
    () => [...new Set(remaining.map(m => m.__category))].sort(),
    [remaining]
  )
  const metricNames = useMemo(
    () => [...new Set(
      remaining
        .filter(m => categoryFilter === 'all' || m.__category === categoryFilter)
        .map(m => m.metric_name)
    )].sort(),
    [remaining, categoryFilter]
  )
  const sources = useMemo(
    () => [...new Set(remaining.map(m => m.source).filter(Boolean))].sort(),
    [remaining]
  )

  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('asc') }
  }

  const filtered = useMemo(() => remaining.filter(m => {
    if (categoryFilter !== 'all' && m.__category !== categoryFilter) return false
    if (metricFilter !== 'all' && m.metric_name !== metricFilter) return false
    if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
    if (!matchesDayFilter(m.date, dayFilter)) return false
    return true
  }), [remaining, categoryFilter, metricFilter, sourceFilter, dayFilter])

  const detailRows = useMemo(() => {
    const cmp = (a: CategorizedMetric, b: CategorizedMetric) => {
      if (sortBy === 'date') return a.date.localeCompare(b.date)
      if (sortBy === 'category') return a.__category.localeCompare(b.__category)
      if (sortBy === 'metric') return a.metric_name.localeCompare(b.metric_name)
      return (a.source || '').localeCompare(b.source || '')
    }
    return [...filtered].sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)))
  }, [filtered, sortBy, sortDir])

  const aggRows = useMemo(() => {
    const cmp = (a: AggRow, b: AggRow) => {
      if (sortBy === 'category') return a.category.localeCompare(b.category)
      if (sortBy === 'metric') return a.metric_name.localeCompare(b.metric_name)
      return a.date.localeCompare(b.date)
    }
    return buildAggregatedRows(filtered).sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)))
  }, [filtered, sortBy, sortDir])

  const rowCount = viewMode === 'aggregated' ? aggRows.length : detailRows.length

  return (
    <div>
      {/* Aggregated (default — one number per metric/date, sources combined)
          vs Detailed (every raw sample, per source) */}
      <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg w-fit mb-2">
        {(['aggregated', 'detailed'] as ViewMode[]).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setViewMode(v)}
            className={`px-3 min-h-[32px] rounded-md text-xs font-semibold capitalize transition-colors ${
              viewMode === v ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {v === 'aggregated' ? 'Aggregated' : 'Detailed'}
          </button>
        ))}
      </div>

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
        {viewMode === 'detailed' && (
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700"
          >
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
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
      ) : rowCount === 0 ? (
        <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
          <p className="text-2xl mb-2">📊</p>
          <p className="text-ink-600 font-medium text-sm">No metrics match this filter</p>
        </div>
      ) : viewMode === 'aggregated' ? (
        <div className="rounded-xl border border-ink-200 bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-cream-50 border-b border-ink-100 sticky top-0">
              <tr>
                <SortHeader label="Date"     col="date"     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Category" col="category" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Metric"   col="metric"   sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left px-3 py-2 font-bold text-ink-500 uppercase tracking-wider">Value (all sources combined)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {aggRows.map(r => (
                <tr key={`${r.metric_name}-${r.date}`} className="hover:bg-cream-50">
                  <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{format(new Date(r.date), 'd MMM yyyy')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-600">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CATEGORY_COLORS[r.category] ?? 'bg-ink-300'}`} />
                      {r.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-800 font-medium whitespace-nowrap">{r.metric_name}</td>
                  <td className="px-3 py-2 text-ink-700">{fmtNum2(r.value)}{r.unit ? ` ${r.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
              {detailRows.map(m => (
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
                  <td className="px-3 py-2 text-ink-700">{formatMetricValue(m.value, m.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-400 mt-1">{rowCount} rows{viewMode === 'detailed' ? ` / ${remaining.length} total samples` : ''}</p>
    </div>
  )
}

// ─── Section navigation ─────────────────────────────────────────────────────

interface Props {
  // Controlled by TrainingPage so the right-rail stats panel can show
  // analysis for whichever Health section is active — the training calendar
  // isn't relevant here, so that space is reclaimed for per-section stats.
  section?: SectionId
  onSectionChange?: (s: SectionId) => void
}

export function HealthTab({ section: controlledSection, onSectionChange }: Props = {}) {
  const [localSection, setLocalSection] = useState<SectionId>('overview')
  const section = controlledSection ?? localSection
  const setSection = onSectionChange ?? setLocalSection

  return (
    <div className="flex flex-col gap-4">
      {/* Section pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`min-h-[36px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
              section === s.id ? 'bg-ink-900 text-white' : 'bg-white border border-ink-200 text-ink-600 hover:bg-ink-50'
            }`}
          >
            <span>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <div className="flex flex-col gap-3">
          <ActivityRings />
          <WorkoutsList />
        </div>
      )}
      {section === 'steps' && <StepsSection />}
      {section === 'energy' && <EnergySection />}
      {section === 'heart' && <HeartSection />}
      {section === 'sleep' && <SleepSection />}
      {section === 'body' && <BodySection />}
      {section === 'all' && <AllDataTable />}
    </div>
  )
}
