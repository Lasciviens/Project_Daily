import { useMemo, useState } from 'react'
import { nowMs } from '../dateFormat'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeRepRangeDistribution } from '../progressAggregate'
import { slugForHevyGroup, labelForSlug, MAJOR_MUSCLES } from '../muscleMap'
import { SegmentedControl, Skeleton, useChartColors } from '../../../shared/ui'
import { ChartCard, ChartNote } from './ChartCard'

// ─────────────────────────────────────────────────────────────────────────────
//  Rep-Range Distribution — a follow-up sports-scientist review (2026-08-31)
//  of the item deferred when the Progress tab first shipped. Deliberately
//  NOT framed as "hypertrophy vs strength ranges": Schoenfeld et al. 2017
//  (JSCR 31(12):3508-3523) and Morton et al. 2016 (J Appl Physiol 121(1):
//  129-138) found hypertrophy roughly equivalent from ~5 to ~30 reps taken
//  near failure — there's no evidence for a boundary at rep 8, so this chart
//  describes what was trained, not a scorecard against a target shape.
//
//  A second review (2026-09-01) replaced the vertical bar histogram with a
//  single 100%-STACKED HORIZONTAL BAR — the underlying finding logic
//  (computeRepRangeFindings) reasons entirely in proportions ("81% sat in
//  6-12 reps"), and a follow-up research pass found this is exactly
//  MacroFactor's own precedent for proportion-based dashboards (stacked
//  horizontal bars, segment width = share) — plus the documented industry
//  caveat that a 100%-stacked bar can make a viewer forget they're looking
//  at a PROPORTION, not an absolute count, which is why the total working-set
//  count stays printed next to the bar rather than only living in a tooltip.
//  Colours are deliberately CATEGORICAL, never a green→red ramp — a ramp
//  would assert a "good" and "bad" end the literature doesn't support.
// ─────────────────────────────────────────────────────────────────────────────

type Period = 30 | 90 | 182

// Categorical, never a good→bad ramp: no bucket is "the right one".
const BUCKET_SERIES: Record<string, number> = { '1-5': 1, '6-12': 0, '13-20': 4, '21-30': 2, '31+': 3 }

export function RepRangeDistributionChart() {
  const { data, isLoading } = useTrainingHistory()
  const [period, setPeriod] = useState<Period>(90)
  const [muscle, setMuscle] = useState<string | null>(null)
  const c = useChartColors()
  const bucketColor = (key: string) => c.series[BUCKET_SERIES[key] ?? 5]

  const templateIdsForMuscle = useMemo(() => {
    if (!data || !muscle) return undefined
    const ids = new Set<string>()
    for (const t of data.templates) {
      if (slugForHevyGroup(t.primary_muscle_group) === muscle) ids.add(t.id)
    }
    return ids
  }, [data, muscle])

  const chartData = useMemo(() => {
    if (!data) return []
    const cutoff = new Date(nowMs() - period * 86_400_000).toISOString().slice(0, 10)
    const inWindow = data.sets.filter(s => s.date >= cutoff)
    return computeRepRangeDistribution(inWindow, templateIdsForMuscle)
  }, [data, period, templateIdsForMuscle])

  const totalSets = chartData.reduce((a, b) => a + b.count, 0)
  const noRepCount = useMemo(() => {
    if (!data) return 0
    const cutoff = new Date(nowMs() - period * 86_400_000).toISOString().slice(0, 10)
    return data.sets.filter(s => s.date >= cutoff && s.set_type !== 'warmup' && s.reps == null).length
  }, [data, period])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <ChartCard
      title="Rep ranges trained"
      action={
        <SegmentedControl<string>
          size="sm"
          value={String(period)}
          onChange={v => setPeriod(Number(v) as Period)}
          options={([30, 90, 182] as Period[]).map(p => ({ value: String(p), label: `${p}d` }))}
        />
      }
    >
      <div role="tablist" aria-label="Muscle" className="scroll-x -mx-1 flex gap-1 px-1 sm:flex-wrap">
        {[null, ...MAJOR_MUSCLES].map(s => (
          <button
            key={s ?? 'all'} type="button" role="tab" aria-selected={muscle === s} onClick={() => setMuscle(s)}
            className="pill-tab shrink-0 px-3 text-meta"
          >
            {s ? labelForSlug(s) : 'All muscles'}
          </button>
        ))}
      </div>

      {totalSets === 0 ? (
        <p className="py-8 text-center text-body text-fg-muted">No working sets with a rep count logged in this window{muscle ? ` for ${labelForSlug(muscle)}` : ''}.</p>
      ) : (
        <>
          <p className="text-meta tabular-nums text-fg-2">{totalSets} working sets in this window</p>

          {/* The stacked bar itself — a single row, segment width = share of
              totalSets. Zero-count buckets contribute no segment (nothing to
              render, nothing to hover). */}
          <div className="flex h-8 max-w-3xl overflow-hidden rounded-control border border-line">
            {chartData.filter(b => b.count > 0).map(b => (
              <div
                key={b.key}
                style={{ width: `${(b.count / totalSets) * 100}%`, backgroundColor: bucketColor(b.key) }}
                title={`${b.label}: ${b.count} sets (${Math.round((b.count / totalSets) * 100)}%)`}
              />
            ))}
          </div>

          {/* Legend doubles as the per-bucket count/percentage readout — no
              tooltip round-trip needed to see a share. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {chartData.map(b => (
              <span key={b.key} className="flex items-center gap-1.5 text-meta tabular-nums text-fg-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: bucketColor(b.key) }} />
                {b.label} · {b.count} ({totalSets ? Math.round((b.count / totalSets) * 100) : 0}%)
              </span>
            ))}
          </div>

          <ChartNote className="flex flex-col gap-1">
            <p>
              This counts working sets, not effort or results — a grinding top set and an easy one weigh the same here, and this log has no RIR/effort
              field to tell them apart.
            </p>
            <p>Warm-ups are excluded. Dropsets and failure sets are counted, each drop as its own set — which pushes this toward the higher buckets if you use them a lot.</p>
            {muscle && (
              <p>Sets are filed by the exercise&apos;s primary muscle only (no secondary-muscle credit) — for total weekly dose per muscle, see the Muscles tab.</p>
            )}
            <p>
              There&apos;s no &quot;right&quot; shape here on purpose — muscle growth is roughly equivalent from about 5 to 30 reps when sets are
              taken close to failure (Schoenfeld 2017; Morton 2016), so a spread across 6–20 and a concentration at 8 can both be fine. Use this to spot drift you
              didn&apos;t intend, not to chase a specific distribution.
            </p>
            {noRepCount > 0 && <p>{noRepCount} duration/distance-based sets in this window have no rep count and aren&apos;t shown here.</p>}
          </ChartNote>
        </>
      )}
    </ChartCard>
  )
}
