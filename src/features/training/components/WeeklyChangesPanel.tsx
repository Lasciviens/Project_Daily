import { useMemo } from 'react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeWeeklyChangeFlags, type WeeklyChangeFlag } from '../progress-engine'
import { METRIC_META } from '../progressMetricMeta'
import { todayStr } from '../../../shared/utils/dateUtils'
import { ArrowUp, Sparkles } from 'lucide-react'
import { Skeleton } from '../../../shared/ui'
import { ChartCard, ChartNote } from './ChartCard'

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

function round1(n: number | undefined): string {
  return n == null ? '—' : String(Math.round(n * 10) / 10)
}

/** Labelled by the exercise's OWN metric: "Est. 1RM +12%" (an Epley estimate,
 *  never called the top set's load), "Assistance −25%", "Top set reps +20%". */
function describeFlag(flag: WeeklyChangeFlag, title: string): string {
  if (flag.kind === 'new') return `${title} — new or returning exercise`
  const pct = Math.round((flag.pct ?? 0) * 100)
  if (flag.kind === 'load' && flag.metricKind) {
    const meta = METRIC_META[flag.metricKind]
    const sign = meta.invert ? '−' : '+'
    return `${title} — ${meta.label} ${sign}${pct}% (${round1(flag.thisWeekValue)} ${meta.unit} this week vs 4-week median ${round1(flag.priorMedian)} ${meta.unit})`
  }
  return `${title} — working sets +${pct}% (${flag.thisWeekValue} this week vs 4-week median ${round1(flag.priorMedian)})`
}

export function WeeklyChangesPanel() {
  const { data, isLoading } = useTrainingHistory()

  const flags = useMemo(() => {
    if (!data) return []
    return computeWeeklyChangeFlags(data.sets, data.templates, todayStr())
  }, [data])

  const titleById = useMemo(() => new Map(data?.templates.map(t => [t.id, t.title]) ?? []), [data])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-24" />

  // Sort: new exercises first (nothing to compare, most actionable to notice),
  // then load jumps, then volume jumps, each by size descending.
  const order: Record<WeeklyChangeFlag['kind'], number> = { new: 0, load: 1, volume: 2 }
  const sorted = [...flags].sort((a, b) => order[a.kind] - order[b.kind] || (b.pct ?? 0) - (a.pct ?? 0))

  return (
    <ChartCard title="Big changes this week">
      {sorted.length === 0 ? (
        <p className="py-2 text-body text-fg-muted">Nothing jumped this week.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((f, i) => (
            <li key={`${f.templateId}-${f.kind}-${i}`} className="flex items-start gap-2 text-body text-fg-2">
              {f.kind === 'new'
                ? <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-label="New" />
                : <ArrowUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-label="Up" />}
              <span>{describeFlag(f, titleById.get(f.templateId) ?? 'Unknown exercise')}</span>
            </li>
          ))}
        </ul>
      )}

      <ChartNote className="mt-1 flex flex-col gap-1">
        <p>
          This is a change detector, not a risk score. It compares this week&apos;s best set (by each exercise&apos;s own measure — estimated 1RM, added
          weight, assistance, reps or time) and working-set count against your own median over the previous four weeks. A flag means &quot;this went up sharply&quot; — it does not mean you&apos;re injured, overreaching, or doing anything wrong.
          Deliberately pushing a lift is supposed to trigger this.
        </p>
        <p>New or returning exercises are flagged with no threshold — unfamiliar movements cause more soreness than familiar ones at the same load, which is normal.</p>
        <p>
          The +10% best-set / +30% set thresholds are coaching rules of thumb, not measured cut-offs. We deliberately don&apos;t show an acute:chronic workload
          ratio here — it comes from team-sport running data with heavily criticised injury-prediction claims, and lifting tonnage is a poor load proxy
          anyway (100 kg × 5 and 50 kg × 10 count the same).
        </p>
      </ChartNote>
    </ChartCard>
  )
}
