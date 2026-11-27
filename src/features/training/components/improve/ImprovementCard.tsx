import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, Skeleton, type Tone } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useTrainingHistory, useBodyweightHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import {
  WINDOW_WEEKS, computeLiftChanges, summarizeImprovement, bodyweightOverWindow,
  type LiftStatus, type WindowWeeks,
} from '../../plan/improvement'

const STATUS_TONE: Record<LiftStatus, Tone> = { improved: 'success', flat: 'neutral', declined: 'neutral', insufficient: 'neutral', high_reps: 'neutral' }
/** The window's answer to "am I getting stronger?" across every lift: how many improved, stayed flat or declined,
 *  and bodyweight over the same window. The main lifts' own trend is Results' Main lifts card (plan/results.ts). */
export function ImprovementCard() {
  const [weeks, setWeeks] = useState<WindowWeeks>(12)
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()
  const { data: bodyweight } = useBodyweightHistory()

  const view = useMemo(() => {
    if (!history) return null
    const changes = computeLiftChanges(history.sets, history.templates, today, weeks)
    return {
      summary: summarizeImprovement(changes),
      bw: bodyweightOverWindow(bodyweight ?? [], today, weeks),
    }
  }, [history, bodyweight, today, weeks])

  if (isLoading || !view) return <Skeleton rounded="rounded-card" className="h-48 max-w-3xl" />
  const { summary, bw } = view

  return (
    <Card className="flex max-w-3xl flex-col gap-4">
      <CardHeader
        wrap
        icon={<TrendingUp />}
        className="!mb-0"
        title={<span className="inline-flex items-center gap-1.5">All lifts
          <InfoBubble>
            Each exercise&apos;s sessions in the window are reduced to one number in its own measure — estimated 1-rep max (e1RM)
            for weighted lifts, top-set reps for bodyweight moves, least assistance for assisted ones. The start is the better
            of its first two sessions, the end the better of its last two. Within ±3% counts as flat — day-to-day scatter is
            about 3–6%, so a smaller change is noise. An exercise needs 3 sessions over at least 2 weeks to be judged.
            <span className="mt-1.5 block"><b>e1RM</b> (Epley) is an estimate, only computed for sets of 10 reps or fewer —
            watch its direction, not the exact kilos.</span>
          </InfoBubble>
        </span>}
        action={
          <SegmentedControl<string>
            size="sm"
            value={String(weeks)}
            onChange={v => setWeeks(Number(v) as WindowWeeks)}
            options={WINDOW_WEEKS.map(w => ({ value: String(w), label: `${w} wk` }))}
          />
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {(['improved', 'flat', 'declined'] as const).map(k => (
          <div key={k} className="min-w-0">
            <p className="section-label">{k === 'improved' ? 'Improved' : k === 'flat' ? 'Flat' : 'Declined'}</p>
            <p data-tone={STATUS_TONE[k]} className="tone-text text-kpi font-bold tabular-nums">{summary[k]}</p>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-meta text-fg-muted">
        {summary.judged > 0 ? `of ${summary.judged} exercises with enough sessions in the last ${weeks} weeks` : `No exercise has 3 sessions over 2+ weeks in the last ${weeks} weeks yet`}
        {summary.insufficient > 0 ? ` · ${summary.insufficient} more trained too rarely to judge` : ''}
        {summary.highReps > 0 ? ` · ${summary.highReps} trained above 10 reps — no e1RM, the exercise list judges their reps` : ''}
        {bw ? ` · bodyweight ${bw.startKg} → ${bw.endKg} kg (${bw.deltaKg > 0 ? '+' : ''}${bw.deltaKg})` : ''}
      </p>

      {summary.declined > 0 && <p className="text-meta text-fg-muted">A lower number after a planned deload, a new variation or time off isn&apos;t a setback — the per-exercise reasons are in the exercise list.</p>}
    </Card>
  )
}
