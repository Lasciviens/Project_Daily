import { useMemo, useState } from 'react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeRepRangeDistribution } from '../progressAggregate'
import { slugForHevyGroup, labelForSlug, MAJOR_MUSCLES } from '../muscleMap'

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

const BUCKET_COLOR: Record<string, string> = {
  '1-5':   '#7c3aed',
  '6-12':  '#0ea5e9',
  '13-20': '#16a34a',
  '21-30': '#f59e0b',
  '31+':   '#ec4899',
}

export function RepRangeDistributionChart() {
  const { data, isLoading } = useTrainingHistory()
  const [period, setPeriod] = useState<Period>(90)
  const [muscle, setMuscle] = useState<string | null>(null)

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
    const cutoff = new Date(Date.now() - period * 86_400_000).toISOString().slice(0, 10)
    const inWindow = data.sets.filter(s => s.date >= cutoff)
    return computeRepRangeDistribution(inWindow, templateIdsForMuscle)
  }, [data, period, templateIdsForMuscle])

  const totalSets = chartData.reduce((a, b) => a + b.count, 0)
  const noRepCount = useMemo(() => {
    if (!data) return 0
    const cutoff = new Date(Date.now() - period * 86_400_000).toISOString().slice(0, 10)
    return data.sets.filter(s => s.date >= cutoff && s.set_type !== 'warmup' && s.reps == null).length
  }, [data, period])

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">🔢 Rep Ranges Trained</p>
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {([30, 90, 182] as Period[]).map(p => (
            <button
              key={p} type="button" onClick={() => setPeriod(p)}
              className={`px-2.5 min-h-[44px] rounded-md text-[11px] font-semibold transition-colors ${
                period === p ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button" onClick={() => setMuscle(null)}
          className={`px-2.5 min-h-[36px] rounded-full text-[11px] font-semibold border transition-colors ${
            muscle === null ? 'bg-ink-950 text-white border-ink-950' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'
          }`}
        >
          All muscles
        </button>
        {[...MAJOR_MUSCLES].map(s => (
          <button
            key={s} type="button" onClick={() => setMuscle(s)}
            className={`px-2.5 min-h-[36px] rounded-full text-[11px] font-semibold border transition-colors ${
              muscle === s ? 'bg-ink-950 text-white border-ink-950' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'
            }`}
          >
            {labelForSlug(s)}
          </button>
        ))}
      </div>

      {totalSets === 0 ? (
        <p className="text-xs text-ink-300 py-8 text-center">No working sets with a rep count logged in this window{muscle ? ` for ${labelForSlug(muscle)}` : ''}.</p>
      ) : (
        <>
          <p className="text-[11px] text-ink-500">{totalSets} working sets in this window</p>

          {/* The stacked bar itself — a single row, segment width = share of
              totalSets. Zero-count buckets contribute no segment (nothing to
              render, nothing to hover). */}
          <div className="flex h-8 rounded-lg overflow-hidden border border-ink-200">
            {chartData.filter(b => b.count > 0).map(b => (
              <div
                key={b.key}
                style={{ width: `${(b.count / totalSets) * 100}%`, backgroundColor: BUCKET_COLOR[b.key] }}
                title={`${b.label}: ${b.count} sets (${Math.round((b.count / totalSets) * 100)}%)`}
              />
            ))}
          </div>

          {/* Legend doubles as the per-bucket count/percentage readout — no
              tooltip round-trip needed to see a share. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {chartData.map(b => (
              <span key={b.key} className="flex items-center gap-1.5 text-[11px] text-ink-600">
                <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BUCKET_COLOR[b.key] }} />
                {b.label} · {b.count} ({totalSets ? Math.round((b.count / totalSets) * 100) : 0}%)
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-1 text-[11px] text-ink-400">
            <p>
              This counts working sets, not effort or results — a grinding top set and an easy one weigh the same here, and this log has no RIR/effort
              field to tell them apart.
            </p>
            <p>Warm-ups are excluded. Dropsets and failure sets are counted, each drop as its own set — which pushes this toward the higher buckets if you use them a lot.</p>
            {muscle && (
              <p>Sets are filed by the exercise&apos;s primary muscle only (no secondary-muscle credit) — for total weekly dose per muscle, see the Muscles tab.</p>
            )}
            <p className="text-ink-300">
              There&apos;s no &quot;right&quot; shape here on purpose — muscle growth is roughly equivalent from about 5 to 30 reps when sets are
              taken close to failure (Schoenfeld 2017; Morton 2016), so a spread across 6–20 and a concentration at 8 can both be fine. Use this to spot drift you
              didn&apos;t intend, not to chase a specific distribution.
            </p>
            {noRepCount > 0 && <p className="text-ink-300">{noRepCount} duration/distance-based sets in this window have no rep count and aren&apos;t shown here.</p>}
          </div>
        </>
      )}
    </div>
  )
}
