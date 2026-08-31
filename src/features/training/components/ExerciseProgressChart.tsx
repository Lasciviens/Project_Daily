import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { BarLineChart } from './health/BarLineChart'
import {
  computeExerciseProgression, metricKindForExerciseType, repRangeVariedSignificantly,
  type ProgressMetricKind,
} from '../progressAggregate'
import { fmtTrainingDate as formatDate } from '../dateFormat'

// ─────────────────────────────────────────────────────────────────────────────
//  Exercise Progress — pick one exercise, see its progression across every
//  session it appears in. Built from a strength-coach + sports-scientist agent
//  review (2026-08-28): the metric plotted depends on the exercise's OWN Hevy
//  type (progressAggregate.ts's metricKindForExerciseType) — a single
//  universal weight×reps formula silently misrenders bodyweight/duration
//  exercises, which the existing all-time Personal Records list never had to
//  handle (it only shows the single best set ever, not a time series).
//
//  DISTINCT from Personal Records (all-time best single set) and Muscles
//  (a muscle's total weekly training dose) — this is one exercise's own
//  numbers over time. See the disambiguation line under the chart.
// ─────────────────────────────────────────────────────────────────────────────

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Exported so WeeklyChangesPanel ("Big changes this week") reports load
// jumps in the same unit/label as this chart — one lookup table for what
// each metric kind is called, not two.
export const METRIC_META: Record<ProgressMetricKind, { label: string; unit: string; color: string; invert?: boolean }> = {
  est1rm:         { label: 'Est. 1RM',        unit: 'kg',   color: '#7c3aed' },
  reps:           { label: 'Top set reps',    unit: 'reps', color: '#0ea5e9' },
  addedWeight:    { label: 'Added weight',    unit: 'kg',   color: '#7c3aed' },
  assistedWeight: { label: 'Assistance',      unit: 'kg',   color: '#f59e0b', invert: true },
  duration:       { label: 'Top set duration', unit: 's',   color: '#16a34a' },
  distance:       { label: 'Top set distance', unit: 'm',   color: '#16a34a' },
}
const VOLUME_META = { label: 'Session Volume', unit: 'kg', color: '#f59e0b' }

// Toggling to raw tonnage only makes sense where weight_kg is the load unit
// in the first place — a rep-count/duration/distance exercise has no
// weight-based "volume" to switch to.
function volumeToggleAvailable(kind: ProgressMetricKind): boolean {
  return kind === 'est1rm' || kind === 'addedWeight'
}

export function ExerciseProgressChart() {
  const { data, isLoading } = useTrainingHistory()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showVolume, setShowVolume] = useState(false)

  const exercises = useMemo(() => {
    if (!data) return []
    const seen = new Set(data.sets.map(s => s.exercise_template_id))
    return data.templates
      .filter(t => seen.has(t.id))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [data])

  const filtered = query.trim()
    ? exercises.filter(e => e.title.toLowerCase().includes(query.trim().toLowerCase()))
    : exercises

  const selected = exercises.find(e => e.id === selectedId) ?? null
  const metricKind = selected ? metricKindForExerciseType(selected.type) : 'est1rm'

  const points = useMemo(() => {
    if (!data || !selected) return []
    return computeExerciseProgression(data.sets, selected.id, metricKind)
  }, [data, selected, metricKind])

  const meta = showVolume && volumeToggleAvailable(metricKind) ? VOLUME_META : METRIC_META[metricKind]
  const invert = !showVolume && METRIC_META[metricKind].invert

  const chartData = points
    .filter(p => (showVolume && volumeToggleAvailable(metricKind) ? p.volume != null : p.topValue != null))
    .map(p => {
      const raw = showVolume && volumeToggleAvailable(metricKind) ? p.volume! : p.topValue!
      return { label: fmtDay(p.date), date: p.date, value: invert ? -raw : raw }
    })

  const repRangeWarning = !showVolume && metricKind === 'est1rm' && repRangeVariedSignificantly(points)

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📈 Exercise Progress</p>

      {/* Exercise picker — MANDATORY Combobox per this repo's search-autocomplete rule */}
      <Combobox value={selected} onChange={e => { setSelectedId(e?.id ?? null); setShowVolume(false) }} onClose={() => setQuery('')} immediate>
        <div className="relative max-w-md">
          <ComboboxInput
            displayValue={(e: typeof selected) => e?.title ?? ''}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="Search an exercise you've logged…"
            className="w-full px-3 min-h-[44px] text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50"
          />
          <ComboboxOptions
            anchor="bottom start"
            className="z-30 w-[var(--input-width)] mt-1 max-h-64 overflow-y-auto rounded-xl border border-ink-200 bg-cream-50 shadow-card-hover [--anchor-gap:4px]"
          >
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-400">No logged exercise matches “{query}”.</p>
            )}
            {filtered.map(e => (
              <ComboboxOption
                key={e.id} value={e}
                className="px-3 min-h-[44px] flex items-center text-sm text-ink-700 cursor-pointer data-[focus]:bg-cream-100"
              >
                {e.title}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </div>
      </Combobox>

      {!selected ? (
        <p className="text-xs text-ink-300 py-8 text-center">Pick an exercise above to see its progression.</p>
      ) : chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-8 text-center">Not enough eligible sets for {selected.title} yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-ink-800">{selected.title}</p>
            {volumeToggleAvailable(metricKind) && (
              <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
                {[{ id: false, label: METRIC_META[metricKind].label }, { id: true, label: VOLUME_META.label }].map(opt => (
                  <button
                    key={String(opt.id)}
                    type="button"
                    onClick={() => setShowVolume(opt.id)}
                    className={`px-2.5 min-h-[44px] rounded-md text-[11px] font-semibold transition-colors ${
                      showVolume === opt.id ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <BarLineChart data={chartData} dataKey="value" color={meta.color} unit={meta.unit} tooltipLabel={meta.label} height={140} />

          {/* Guardrail copy — a strength-coach + sports-scientist review's exact
              wording, kept blunt and always visible rather than buried in an
              ℹ️, matching this repo's existing Muscles-feature tone. */}
          <div className="flex flex-col gap-1 text-[11px] text-ink-400">
            {!showVolume && metricKind === 'est1rm' && (
              <p>Estimated 1RM, not measured — Epley formula, typically ±10% at low-to-moderate reps and increasingly unreliable above 12. Sets over 12 reps aren't used for this estimate.</p>
            )}
            {showVolume && (
              <p>Volume = total weight lifted this session (Σ weight × reps, warm-ups excluded). Tracks total work done, not raw strength.</p>
            )}
            {metricKind === 'addedWeight' && (
              <p>Shows added weight only — your bodyweight isn't included, so this understates true total load.</p>
            )}
            {metricKind === 'assistedWeight' && (
              <p>Inverted: less machine assistance over time is the improvement, so the line should trend down as you get stronger.</p>
            )}
            {repRangeWarning && (
              <p>Your rep range changed across this period — estimated 1RM loosely normalizes for that, but Session Volume will jump or drop for reasons unrelated to strength.</p>
            )}
            <p>Read the trend over several sessions, not week to week — sleep, stress and fatigue move a single day's numbers more than actual strength does.</p>
            <p className="text-ink-300">This tracks one exercise's own numbers over time — it isn't your all-time PR (see Personal Records) or the muscle's total weekly dose (see Muscles).</p>
          </div>

          <p className="text-[10px] text-ink-300">Last session: {formatDate(points[points.length - 1]!.date)}</p>
        </>
      )}
    </div>
  )
}
