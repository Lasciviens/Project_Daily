import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { BarLineChart } from './health/BarLineChart'
import {
  computeExerciseProgression, metricKindForExerciseType, repRangeVariedSignificantly,
  type ProgressMetricKind,
} from '../progressAggregate'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { SegmentedControl, Skeleton, useChartColors } from '../../../shared/ui'
import { ChartCard, ChartNote } from './ChartCard'
import { METRIC_META, VOLUME_META } from '../progressMetricMeta'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

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
  return fmtDateEnGB(new Date(dateStr + 'T00:00:00'), { day: 'numeric', month: 'short' })
}

// Exported so WeeklyChangesPanel ("Big changes this week") reports load
// jumps in the same unit/label as this chart — one lookup table for what
// each metric kind is called, not two.
function volumeToggleAvailable(kind: ProgressMetricKind): boolean {
  return kind === 'est1rm' || kind === 'addedWeight'
}

export function ExerciseProgressChart() {
  const { data, isLoading } = useTrainingHistory()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showVolume, setShowVolume] = useState(false)
  const c = useChartColors()

  const exercises = useMemo(() => {
    if (!data) return []
    // Most-recently-trained first — the exercise you're most likely looking
    // for right after a session is the one you just did, not alphabetical
    // order. lastUsed is the exercise's own latest logged date; ties (same
    // day) fall back to title for a stable order.
    const lastUsed = new Map<string, string>()
    for (const s of data.sets) {
      const prev = lastUsed.get(s.exercise_template_id)
      if (!prev || s.date > prev) lastUsed.set(s.exercise_template_id, s.date)
    }
    return data.templates
      .filter(t => lastUsed.has(t.id))
      .sort((a, b) => lastUsed.get(b.id)!.localeCompare(lastUsed.get(a.id)!) || a.title.localeCompare(b.title))
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

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <ChartCard title="Exercise progress" className="gap-3">

      {/* Exercise picker — MANDATORY Combobox per this repo's search-autocomplete rule */}
      <Combobox value={selected} onChange={e => { setSelectedId(e?.id ?? null); setShowVolume(false) }} onClose={() => setQuery('')} immediate>
        <div className="relative max-w-md">
          <ComboboxInput
            displayValue={(e: typeof selected) => e?.title ?? ''}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="Search an exercise you've logged…"
            aria-label="Exercise"
            className="input w-full"
          />
          <ComboboxOptions
            anchor="bottom start"
            className="menu w-[var(--input-width)] max-h-64 overflow-y-auto [--anchor-gap:4px]"
          >
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-body text-fg-muted">No logged exercise matches “{query}”.</p>
            )}
            {filtered.map(e => (
              <ComboboxOption
                key={e.id} value={e}
                className="menu-item cursor-pointer"
              >
                {e.title}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </div>
      </Combobox>

      {!selected ? (
        <p className="py-8 text-center text-body text-fg-muted">Pick an exercise above to see its progression.</p>
      ) : chartData.length === 0 ? (
        <p className="py-8 text-center text-body text-fg-muted">Not enough eligible sets for {selected.title} yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body font-semibold text-fg">{selected.title}</p>
            {volumeToggleAvailable(metricKind) && (
              <SegmentedControl<'metric' | 'volume'>
                size="sm"
                value={showVolume ? 'volume' : 'metric'}
                onChange={v => setShowVolume(v === 'volume')}
                options={[{ value: 'metric', label: METRIC_META[metricKind].label }, { value: 'volume', label: VOLUME_META.label }]}
              />
            )}
          </div>

          {/* Zero-based bar baseline — matches this app's "magnitude a bar
              represents is honest" convention (see WeeklyVolumeChart) —
              EXCEPT for the inverted assisted-exercise metric, whose plotted
              values are deliberately negative; [0,'auto'] there would clip
              every point off the chart entirely. */}
          <BarLineChart data={chartData} dataKey="value" color={c.series[meta.series]} unit={meta.unit} tooltipLabel={meta.label} height={140} yDomain={invert ? ['auto', 'auto'] : [0, 'auto']} />

          {/* Guardrail copy — a strength-coach + sports-scientist review's exact
              wording, kept blunt and always visible rather than buried in an
              ℹ️, matching this repo's existing Muscles-feature tone. */}
          <ChartNote className="flex flex-col gap-1">
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
            <p>This tracks one exercise's own numbers over time — it isn't your all-time PR (see Personal Records) or the muscle's total weekly dose (see Muscles).</p>
          </ChartNote>

          <p className="text-meta tabular-nums text-fg-faint">Last session: {formatDate(points[points.length - 1]!.date)}</p>
        </>
      )}
    </ChartCard>
  )
}
