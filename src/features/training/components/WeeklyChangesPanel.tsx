import { useMemo } from 'react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeWeeklyChangeFlags, metricKindForExerciseType, type WeeklyChangeFlag } from '../progressAggregate'
import { METRIC_META } from './ExerciseProgressChart'

// ─────────────────────────────────────────────────────────────────────────────
//  Big Changes This Week — a strength-coach review's explicit alternative to
//  an acute:chronic workload ratio (ACWR), which the review advised against:
//  ACWR's injury-prediction evidence is team-sport running/GPS load, it has
//  drawn sustained statistical criticism (mathematical coupling between the
//  acute and chronic windows it computes from, unstable "sweet spot"
//  thresholds), and this app's OWN Weekly Volume guardrail already documents
//  tonnage as conflating load and reps — a risk flag can't be built on a
//  quantity already flagged as ambiguous. This is a plain change detector:
//  per-exercise, no score, no colour-coded "risk", comparing this week
//  against your OWN last month.
// ─────────────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function describeFlag(flag: WeeklyChangeFlag, title: string, type: string): string {
  if (flag.kind === 'new') return `${title} — new or returning exercise`
  const meta = METRIC_META[metricKindForExerciseType(type)]
  const pct = Math.round((flag.pct ?? 0) * 100)
  if (flag.kind === 'load') {
    return `${title} — load +${pct}% (top set ${flag.thisWeekValue} ${meta.unit} vs 4-wk median ${flag.priorMedian} ${meta.unit})`
  }
  return `${title} — volume +${pct}% (${flag.thisWeekValue} sets vs 4-wk median ${flag.priorMedian})`
}

export function WeeklyChangesPanel() {
  const { data, isLoading } = useTrainingHistory()

  const flags = useMemo(() => {
    if (!data) return []
    return computeWeeklyChangeFlags(data.sets, data.templates, todayStr())
  }, [data])

  const titleById = useMemo(() => new Map(data?.templates.map(t => [t.id, t.title]) ?? []), [data])
  const typeById = useMemo(() => new Map(data?.templates.map(t => [t.id, t.type]) ?? []), [data])

  if (isLoading) return <div className="h-24 rounded-2xl bg-cream-200 animate-pulse" />

  // Sort: new exercises first (nothing to compare, most actionable to notice),
  // then load jumps, then volume jumps, each by size descending.
  const order: Record<WeeklyChangeFlag['kind'], number> = { new: 0, load: 1, volume: 2 }
  const sorted = [...flags].sort((a, b) => order[a.kind] - order[b.kind] || (b.pct ?? 0) - (a.pct ?? 0))

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📋 Big Changes This Week</p>

      {sorted.length === 0 ? (
        <p className="text-xs text-ink-400 py-2">Nothing jumped this week.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((f, i) => (
            <li key={`${f.templateId}-${f.kind}-${i}`} className="text-xs text-ink-700 flex items-start gap-2">
              <span aria-hidden>{f.kind === 'new' ? '🆕' : '↑'}</span>
              <span>{describeFlag(f, titleById.get(f.templateId) ?? 'Unknown exercise', typeById.get(f.templateId) ?? '')}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1 text-[11px] text-ink-400 mt-1">
        <p>
          This is a change detector, not a risk score. It compares this week&apos;s top-set load and set count for each exercise against your own median over
          the previous four weeks. A flag means &quot;this went up sharply&quot; — it does not mean you&apos;re injured, overreaching, or doing anything wrong.
          Deliberately pushing a lift is supposed to trigger this.
        </p>
        <p>New or returning exercises are flagged with no threshold — unfamiliar movements cause more soreness than familiar ones at the same load, which is normal.</p>
        <p className="text-ink-300">
          The +10% load / +30% set thresholds are coaching rules of thumb, not measured cut-offs. We deliberately don&apos;t show an acute:chronic workload
          ratio here — it comes from team-sport running data with heavily criticised injury-prediction claims, and lifting tonnage is a poor load proxy
          anyway (100 kg × 5 and 50 kg × 10 count the same).
        </p>
      </div>
    </div>
  )
}
