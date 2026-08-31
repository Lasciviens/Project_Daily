import { useMemo, useState } from 'react'
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart } from 'recharts'
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
// ─────────────────────────────────────────────────────────────────────────────

type Period = 30 | 90 | 182

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
          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgb(var(--ink-100))' }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
                  formatter={(v: any) => [`${v} set${v === 1 ? '' : 's'}`, 'Sets']}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Bar dataKey="count" fill="#0ea5e9" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
              There&apos;s no &quot;right&quot; shape and no target line here on purpose — muscle growth is roughly equivalent from about 5 to 30 reps when sets are
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
