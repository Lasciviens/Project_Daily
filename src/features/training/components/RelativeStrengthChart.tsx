import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTrainingHistory, useBodyweightHistory } from '../hooks/useTrainingProgress'
import {
  computeExerciseProgression, metricKindForExerciseType, computeRelativeStrengthTrend,
} from '../progressAggregate'
import { fmtTrainingDate as formatDate } from '../dateFormat'

// ─────────────────────────────────────────────────────────────────────────────
//  Relative Strength vs Bodyweight — a follow-up sports-scientist +
//  strength-coach review (2026-08-31) of the item deferred when the Progress
//  tab first shipped. Only 'est1rm'-type exercises are eligible: a
//  bodyweight-normalized ratio is a defensible practitioner convention for a
//  loaded barbell/dumbbell lift, and meaningless for a rep-count/duration/
//  distance exercise. Two things move this line — strength AND bodyweight —
//  so both are always plotted, never just the ratio.
// ─────────────────────────────────────────────────────────────────────────────

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const MIN_POINTS = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts dot renderer prop is awkward to type cleanly.
function RatioDot(props: any) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx} cy={cy} r={3.5}
      fill={payload.estimated ? 'transparent' : '#7c3aed'}
      stroke="#7c3aed" strokeWidth={payload.estimated ? 1.5 : 0}
    />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly.
function RatioTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="bg-cream-50 border border-ink-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs space-y-0.5">
      <p className="text-ink-400 font-medium">{label}</p>
      <p className="font-semibold text-accent-700">{p.ratio}× bodyweight</p>
      <p className="text-ink-500">Est. 1RM {p.est1rmValue} kg · bodyweight {p.bodyweightKg} kg{p.estimated ? ' (estimated)' : ''}</p>
    </div>
  )
}

export function RelativeStrengthChart() {
  const { data, isLoading: loadingHistory } = useTrainingHistory()
  const { data: anchors, isLoading: loadingBw } = useBodyweightHistory()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const isLoading = loadingHistory || loadingBw

  // Only exercises whose OWN metric is est1rm — a ratio built from any other
  // kind (reps/added weight/assistance/duration/distance) has no interpretable
  // meaning normalized by bodyweight.
  const exercises = useMemo(() => {
    if (!data) return []
    const seen = new Set(data.sets.map(s => s.exercise_template_id))
    return data.templates
      .filter(t => seen.has(t.id) && metricKindForExerciseType(t.type) === 'est1rm')
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [data])

  const filtered = query.trim()
    ? exercises.filter(e => e.title.toLowerCase().includes(query.trim().toLowerCase()))
    : exercises

  const selected = exercises.find(e => e.id === selectedId) ?? null

  const chartData = useMemo(() => {
    if (!data || !selected || !anchors) return []
    const points = computeExerciseProgression(data.sets, selected.id, 'est1rm')
    return computeRelativeStrengthTrend(points, anchors).map(p => ({ ...p, label: fmtDay(p.date) }))
  }, [data, selected, anchors])

  const estimatedCount = chartData.filter(p => p.estimated).length

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">⚖️ Strength vs Bodyweight</p>

      <Combobox value={selected} onChange={e => setSelectedId(e?.id ?? null)} onClose={() => setQuery('')} immediate>
        <div className="relative max-w-md">
          <ComboboxInput
            displayValue={(e: typeof selected) => e?.title ?? ''}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="Search a weighted lift you've logged…"
            className="w-full px-3 min-h-[44px] text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50"
          />
          <ComboboxOptions
            anchor="bottom start"
            className="z-30 w-[var(--input-width)] mt-1 max-h-64 overflow-y-auto rounded-xl border border-ink-200 bg-cream-50 shadow-card-hover [--anchor-gap:4px]"
          >
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-400">
                {exercises.length === 0 ? 'No weighted (barbell/dumbbell-style) lifts logged yet.' : `No match for “${query}”.`}
              </p>
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
        <p className="text-xs text-ink-300 py-8 text-center">
          Pick a weighted lift above — this chart only applies to exercises with an estimated 1RM (bodyweight-only, duration and distance exercises aren&apos;t offered here).
        </p>
      ) : chartData.length < MIN_POINTS ? (
        <p className="text-xs text-ink-300 py-8 text-center">
          Not enough sessions with a nearby bodyweight reading for {selected.title} yet — log a bodyweight in Training → Body within two weeks of a session to see this trend.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold text-ink-800">{selected.title}</p>

          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
                <YAxis yAxisId="ratio" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
                <YAxis yAxisId="bw" orientation="right" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={32} domain={['auto', 'auto']} />
                <Tooltip cursor={false} content={RatioTooltip} />
                <Line yAxisId="ratio" dataKey="ratio" name="Ratio" stroke="#7c3aed" strokeWidth={2} dot={<RatioDot />} activeDot={{ r: 6 }} />
                <Line yAxisId="bw" dataKey="bodyweightKg" name="Bodyweight" stroke="rgb(var(--ink-300))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-ink-400">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-600" /> Strength ÷ bodyweight</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-px border-t border-dashed border-ink-300" /> Bodyweight (kg)</span>
          </div>

          <div className="flex flex-col gap-1 text-[11px] text-ink-400">
            <p>
              This line has two moving parts. It goes up when you get stronger <em>or</em> when you lose weight, and down when you gain weight even if your lift
              didn&apos;t change — the dashed bodyweight line is drawn alongside it on purpose, so you can see which one actually moved.
            </p>
            <p>
              Bodyweight is taken from a weigh-in within 14 days, or interpolated between two weigh-ins less than 3 weeks apart.{' '}
              {estimatedCount > 0 && `${estimatedCount} of ${chartData.length} points use an estimated (hollow-dot) bodyweight rather than a same-day weigh-in.`}
            </p>
            <p>Estimated 1RM carries its own ~±10% error (Epley, sets of 12 reps or fewer only) — read the direction over months, not the exact number.</p>
            <p className="text-ink-300">
              Dividing by bodyweight isn&apos;t size-neutral in general (force scales closer to bodyweight^0.67 than bodyweight^1.0), so this is useful for comparing you
              against your own past self — not against anyone else. There are deliberately no &quot;strength standard&quot; reference lines here: what counts as strong
              for a bodyweight multiple depends on height, limb length, age and sex, none of which this app knows.
            </p>
          </div>

          <p className="text-[10px] text-ink-300">Last session: {formatDate(chartData[chartData.length - 1]!.date)}</p>
        </>
      )}
    </div>
  )
}
