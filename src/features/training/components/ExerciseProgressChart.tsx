import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { metricKindForExerciseType } from '../progressAggregate'
import { buildCanonicalSessions } from '../progress-engine'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { Skeleton } from '../../../shared/ui'
import { ChartCard, ChartNote } from './ChartCard'
import { ExerciseTrendChart } from '../progress/ExerciseTrendChart'

// ─────────────────────────────────────────────────────────────────────────────
//  Exercise Progress — pick any exercise you've logged in the last 6 months
//  (current program or not) and see its sessions over time. Drawn from the
//  progress engine's own per-session points (working load or the metric's
//  own top-set value, with the estimated 1RM as a secondary line), so it
//  shows the same numbers the decision table judges — the old version ran a
//  second, independent best-e1RM calculation plus the retired rep-range
//  check.
//
//  DISTINCT from the Muscles body map (a muscle's total weekly training
//  dose).
// ─────────────────────────────────────────────────────────────────────────────

export function ExerciseProgressChart() {
  const { data, isLoading } = useTrainingHistory()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const exercises = useMemo(() => {
    if (!data) return []
    // Most-recently-trained first — the exercise you're most likely looking
    // for right after a session is the one you just did.
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

  const sessions = useMemo(() => (data && selected ? buildCanonicalSessions(data.sets, selected.id) : []), [data, selected])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <ChartCard title="Exercise progress" className="gap-3">
      <Combobox value={selected} onChange={e => setSelectedId(e?.id ?? null)} onClose={() => setQuery('')} immediate>
        <div className="relative max-w-md">
          <ComboboxInput
            displayValue={(e: typeof selected) => e?.title ?? ''}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="Search an exercise you've logged…"
            aria-label="Exercise"
            className="input w-full"
          />
          <ComboboxOptions anchor="bottom start" className="menu w-[var(--input-width)] max-h-64 overflow-y-auto [--anchor-gap:4px]">
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-body text-fg-muted">No logged exercise matches “{query}”.</p>
            )}
            {filtered.map(e => (
              <ComboboxOption key={e.id} value={e} className="menu-item cursor-pointer">{e.title}</ComboboxOption>
            ))}
          </ComboboxOptions>
        </div>
      </Combobox>

      {!selected ? (
        <p className="py-8 text-center text-body text-fg-muted">Pick an exercise above to see its progression.</p>
      ) : sessions.length === 0 ? (
        <p className="py-8 text-center text-body text-fg-muted">No working sets for {selected.title} in the last 6 months.</p>
      ) : (
        <>
          <p className="text-body font-semibold text-fg">{selected.title}</p>
          <ExerciseTrendChart sessions={sessions} metricKind={metricKind} />
          <ChartNote className="flex flex-col gap-1">
            {metricKind === 'addedWeight' && <p>Shows added weight only — your bodyweight isn&apos;t included, so this understates the total load.</p>}
            <p>Read the trend over several sessions, not session to session — sleep, stress and fatigue move a single day&apos;s numbers more than strength does.</p>
            <p>This is one exercise&apos;s own numbers over time — not the muscle&apos;s weekly dose (see the weekly volume body map).</p>
          </ChartNote>
          <p className="text-meta tabular-nums text-fg-faint">Last session: {formatDate(sessions[sessions.length - 1].date)}</p>
        </>
      )}
    </ChartCard>
  )
}
