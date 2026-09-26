import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { useTrainingHistory, useBodyweightHistory } from '../hooks/useTrainingProgress'
import {
  computeExerciseProgression, metricKindForExerciseType, computeRelativeStrengthTrend, indexRelativeStrengthTrend,
} from '../progressAggregate'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { Skeleton, useChartColors } from '../../../shared/ui'
import { TOOLTIP_BOX } from './chartKit'
import { ChartCard, ChartNote } from './ChartCard'

// ─────────────────────────────────────────────────────────────────────────────
//  Relative Strength vs Bodyweight — a follow-up sports-scientist +
//  strength-coach review (2026-08-31) of the item deferred when the Progress
//  tab first shipped. Only 'est1rm'-type exercises are eligible: a
//  bodyweight-normalized ratio is a defensible practitioner convention for a
//  loaded barbell/dumbbell lift, and meaningless for a rep-count/duration/
//  distance exercise. Two things move this line — strength AND bodyweight —
//  so both are always plotted, never just one.
//
//  A second review (2026-09-01) replaced the original ratio-line-plus-
//  separate-bodyweight-line (dual y-axis) with BOTH series indexed to 100 at
//  the window's first point, sharing ONE axis — a real research pass found
//  this is the standard finance/data-viz technique for exactly this problem
//  (comparing two differently-scaled series without forcing the reader to do
//  the division themselves), and no fitness app was found doing better for
//  a strength-vs-bodyweight context specifically.
// ─────────────────────────────────────────────────────────────────────────────

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const MIN_POINTS = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts dot renderer prop is awkward to type cleanly.
function StrengthDot(props: any) {
  const { cx, cy, payload, color } = props
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx} cy={cy} r={3.5}
      fill={payload.estimated ? 'transparent' : color}
      stroke={color} strokeWidth={payload.estimated ? 1.5 : 0}
    />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly.
function IndexedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  const strengthDelta = Math.round((p.strengthIndex - 100) * 10) / 10
  const bwDelta = Math.round((p.bodyweightIndex - 100) * 10) / 10
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium text-fg-muted">{label}</p>
      <p className="font-semibold text-fg">Strength {strengthDelta >= 0 ? '+' : ''}{strengthDelta}%</p>
      <p className="font-semibold text-fg-2">Bodyweight {bwDelta >= 0 ? '+' : ''}{bwDelta}%</p>
      <p className="tabular-nums text-fg-muted">Est. 1RM {p.est1rmValue} kg · bodyweight {p.bodyweightKg} kg{p.estimated ? ' (estimated)' : ''}</p>
    </div>
  )
}

export function RelativeStrengthChart() {
  const { data, isLoading: loadingHistory } = useTrainingHistory()
  const { data: anchors, isLoading: loadingBw } = useBodyweightHistory()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const c = useChartColors()

  const isLoading = loadingHistory || loadingBw

  // Only exercises whose OWN metric is est1rm — a ratio built from any other
  // kind (reps/added weight/assistance/duration/distance) has no interpretable
  // meaning normalized by bodyweight.
  const exercises = useMemo(() => {
    if (!data) return []
    // Most-recently-trained first — matches ExerciseProgressChart's picker.
    const lastUsed = new Map<string, string>()
    for (const s of data.sets) {
      const prev = lastUsed.get(s.exercise_template_id)
      if (!prev || s.date > prev) lastUsed.set(s.exercise_template_id, s.date)
    }
    return data.templates
      .filter(t => lastUsed.has(t.id) && metricKindForExerciseType(t.type) === 'est1rm')
      .sort((a, b) => lastUsed.get(b.id)!.localeCompare(lastUsed.get(a.id)!) || a.title.localeCompare(b.title))
  }, [data])

  const filtered = query.trim()
    ? exercises.filter(e => e.title.toLowerCase().includes(query.trim().toLowerCase()))
    : exercises

  const selected = exercises.find(e => e.id === selectedId) ?? null

  const chartData = useMemo(() => {
    if (!data || !selected || !anchors) return []
    const points = computeExerciseProgression(data.sets, selected.id, 'est1rm')
    const ratioPoints = computeRelativeStrengthTrend(points, anchors)
    const indexed = indexRelativeStrengthTrend(ratioPoints)
    return ratioPoints.map((p, i) => ({ ...p, ...indexed[i], label: fmtDay(p.date) }))
  }, [data, selected, anchors])

  const estimatedCount = chartData.filter(p => p.estimated).length

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <ChartCard title="Strength vs bodyweight" className="gap-3">

      <Combobox value={selected} onChange={e => setSelectedId(e?.id ?? null)} onClose={() => setQuery('')} immediate>
        <div className="relative max-w-md">
          <ComboboxInput
            displayValue={(e: typeof selected) => e?.title ?? ''}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="Search a weighted lift you've logged…"
            aria-label="Exercise"
            className="input w-full"
          />
          <ComboboxOptions
            anchor="bottom start"
            className="menu w-[var(--input-width)] max-h-64 overflow-y-auto [--anchor-gap:4px]"
          >
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-body text-fg-muted">
                {exercises.length === 0 ? 'No weighted (barbell/dumbbell-style) lifts logged yet.' : `No match for “${query}”.`}
              </p>
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
        <p className="py-8 text-center text-body text-fg-muted">
          Pick a weighted lift above — this chart only applies to exercises with an estimated 1RM (bodyweight-only, duration and distance exercises aren&apos;t offered here).
        </p>
      ) : chartData.length < MIN_POINTS ? (
        <p className="py-8 text-center text-body text-fg-muted">
          Not enough sessions with a nearby bodyweight reading for {selected.title} yet — log a bodyweight in Training → Body within two weeks of a session to see this trend.
        </p>
      ) : (
        <>
          <p className="text-body font-semibold text-fg">{selected.title}</p>

          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
                <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={34} domain={['auto', 'auto']} tickFormatter={(v: number) => `${v}`} />
                <Tooltip cursor={false} content={IndexedTooltip} />
                <ReferenceLine y={100} stroke={c.axis} strokeOpacity={0.5} strokeDasharray="2 2" />
                <Line dataKey="strengthIndex" name="Strength" stroke={c.series[1]} strokeWidth={2} dot={<StrengthDot color={c.series[1]} />} activeDot={{ r: 6 }} />
                <Line dataKey="bodyweightIndex" name="Bodyweight" stroke={c.series[5]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-meta text-fg-muted">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.series[1] }} /> Strength (indexed to 100)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed" style={{ borderColor: c.series[5] }} /> Bodyweight (indexed to 100)</span>
          </div>

          <ChartNote className="flex flex-col gap-1">
            <p>
              Both lines start at 100 on {formatDate(chartData[0]!.date)} — a value of 106 means +6% from that point, whichever line it&apos;s on. Strength can rise
              because you got stronger <em>or</em> because you lost weight, and the dashed bodyweight line is drawn on the SAME scale on purpose, so which one
              actually moved is a direct visual comparison, not mental division.
            </p>
            <p>
              Bodyweight is taken from a weigh-in within 14 days, or interpolated between two weigh-ins less than 3 weeks apart.{' '}
              {estimatedCount > 0 && `${estimatedCount} of ${chartData.length} points use an estimated (hollow-dot) bodyweight rather than a same-day weigh-in.`}
            </p>
            <p>Estimated 1RM carries its own ~±10% error (Epley, sets of 12 reps or fewer only) — read the direction over months, not the exact number.</p>
            <p>
              Dividing by bodyweight isn&apos;t size-neutral in general (force scales closer to bodyweight^0.67 than bodyweight^1.0), so this is useful for comparing you
              against your own past self — not against anyone else. There are deliberately no &quot;strength standard&quot; reference lines here: what counts as strong
              for a bodyweight multiple depends on height, limb length, age and sex, none of which this app knows.
            </p>
          </ChartNote>

          <p className="text-meta tabular-nums text-fg-faint">Last session: {formatDate(chartData[chartData.length - 1]!.date)}</p>
        </>
      )}
    </ChartCard>
  )
}
