import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, Skeleton, type Tone } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useTrainingHistory, useBodyweightHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import {
  WINDOW_WEEKS, computeLiftChanges, summarizeImprovement, mainLifts, bodyweightOverWindow,
  type LiftChange, type LiftStatus, type WindowWeeks,
} from '../../plan/improvement'

const STATUS_TONE: Record<LiftStatus, Tone> = { improved: 'success', flat: 'neutral', declined: 'warn', insufficient: 'neutral' }
function Change({ c }: { c: LiftChange }) {
  const Icon = c.status === 'improved' ? ArrowUpRight : c.status === 'declined' ? ArrowDownRight : ArrowRight
  return (
    <span data-tone={STATUS_TONE[c.status]} className="tone-text inline-flex items-center gap-0.5 font-semibold tabular-nums">
      <Icon aria-hidden className="h-3.5 w-3.5" />{c.changePct != null ? `${c.changePct > 0 ? '+' : ''}${c.changePct}%` : '—'}
    </span>
  )
}

/** The window's answer to "am I getting stronger?": how many lifts improved,
 *  the main lifts' estimated-1RM change and bodyweight over the same window. */
export function ImprovementCard({ preferIds }: { preferIds: ReadonlySet<string> }) {
  const [weeks, setWeeks] = useState<WindowWeeks>(12)
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()
  const { data: bodyweight } = useBodyweightHistory()

  const view = useMemo(() => {
    if (!history) return null
    const changes = computeLiftChanges(history.sets, history.templates, today, weeks)
    return {
      summary: summarizeImprovement(changes),
      main: mainLifts(changes, 5, preferIds),
      bw: bodyweightOverWindow(bodyweight ?? [], today, weeks),
    }
  }, [history, bodyweight, today, weeks, preferIds])

  if (isLoading || !view) return <Skeleton rounded="rounded-card" className="h-48 max-w-3xl" />
  const { summary, main, bw } = view

  return (
    <Card className="flex max-w-3xl flex-col gap-4">
      <CardHeader
        wrap
        icon={<TrendingUp />}
        className="!mb-0"
        title={<span className="inline-flex items-center gap-1.5">Improvement
          <InfoBubble>
            Each exercise&apos;s sessions in the window are reduced to one number in its own measure — estimated 1-rep max (e1RM)
            for weighted lifts, top-set reps for bodyweight moves, least assistance for assisted ones. The start is the better
            of its first two sessions, the end the better of its last two. Within ±2.5% counts as flat (a noise band we chose,
            not a research cut-off). An exercise needs 3 sessions over at least 2 weeks to be judged.
            <span className="mt-1.5 block"><b>e1RM</b> (Epley) is an estimate, typically within about ±10% and only computed for
            sets of 12 reps or fewer — watch its direction, not the exact kilos.</span>
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
        {bw ? ` · bodyweight ${bw.startKg} → ${bw.endKg} kg (${bw.deltaKg > 0 ? '+' : ''}${bw.deltaKg})` : ''}
      </p>

      {main.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="section-label mb-1.5">Main lifts · estimated 1RM</p>
          <ul className="flex flex-col gap-1.5">
            {main.map(c => (
              // Lift + change on one line, the 1RM figures under it: inline they
              // squeezed the lift name onto three lines on a phone.
              <li key={c.templateId} className="flex items-baseline gap-x-2 text-body">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium text-fg">{c.title}</span>
                  <span className="block text-meta tabular-nums text-fg-muted">{c.start} → {c.end} kg</span>
                </span>
                <Change c={c} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.declined > 0 && <p className="text-meta text-fg-muted">A lower number after a planned deload, a new variation or time off isn&apos;t a setback — the per-exercise reasons are in the table below.</p>}
    </Card>
  )
}
