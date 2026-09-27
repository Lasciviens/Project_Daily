import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp, Trophy } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, Skeleton, type Tone } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useTrainingHistory, useBodyweightHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { fmtDuration } from '../../progress-engine'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import type { ProgressMetricKind } from '../../progressAggregate'
import {
  WINDOW_WEEKS, computeLiftChanges, summarizeImprovement, mainLifts, computePrTimeline, bodyweightOverWindow,
  type LiftChange, type LiftStatus, type WindowWeeks,
} from '../../plan/improvement'

const STATUS_TONE: Record<LiftStatus, Tone> = { improved: 'success', flat: 'neutral', declined: 'warn', insufficient: 'neutral' }
const PR_LIMIT = 12

function fmtMetricValue(value: number, kind: ProgressMetricKind): string {
  switch (kind) {
    case 'est1rm': return `${value} kg`
    case 'addedWeight': return `+${value} kg`
    case 'assistedWeight': return `${value} kg assist`
    case 'reps': return `${value} reps`
    case 'duration': return fmtDuration(value)
    case 'distance': return `${value} m`
  }
}

const fmtDay = (d: string) => fmtDateEnGB(new Date(`${d}T12:00:00`), { day: 'numeric', month: 'short' })

function Change({ c }: { c: LiftChange }) {
  const Icon = c.status === 'improved' ? ArrowUpRight : c.status === 'declined' ? ArrowDownRight : ArrowRight
  return (
    <span data-tone={STATUS_TONE[c.status]} className="tone-text inline-flex items-center gap-0.5 font-semibold tabular-nums">
      <Icon aria-hidden className="h-3.5 w-3.5" />{c.changePct != null ? `${c.changePct > 0 ? '+' : ''}${c.changePct}%` : '—'}
    </span>
  )
}

/** The window's answer to "am I getting stronger?": how many lifts improved,
 *  the main lifts' estimated-1RM change, bodyweight over the same window and
 *  a dated timeline of records. */
export function ImprovementCard({ preferIds }: { preferIds: ReadonlySet<string> }) {
  const [weeks, setWeeks] = useState<WindowWeeks>(12)
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()
  const { data: bodyweight } = useBodyweightHistory()
  const [showAllPrs, setShowAllPrs] = useState(false)

  const view = useMemo(() => {
    if (!history) return null
    const changes = computeLiftChanges(history.sets, history.templates, today, weeks)
    return {
      summary: summarizeImprovement(changes),
      main: mainLifts(changes, 5, preferIds),
      prs: computePrTimeline(history.sets, history.templates, today, weeks),
      bw: bodyweightOverWindow(bodyweight ?? [], today, weeks),
    }
  }, [history, bodyweight, today, weeks, preferIds])

  if (isLoading || !view) return <Skeleton rounded="rounded-card" className="h-48 max-w-3xl" />
  const { summary, main, prs, bw } = view
  const shownPrs = showAllPrs ? prs : prs.slice(0, PR_LIMIT)

  return (
    <Card className="flex max-w-3xl flex-col gap-4">
      <CardHeader
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
              <li key={c.templateId} className="flex flex-wrap items-baseline gap-x-2 text-body">
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{c.title}</span>
                <span className="tabular-nums text-fg-muted">{c.start} → {c.end} kg</span>
                <Change c={c} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line pt-3">
        <p className="section-label mb-1.5 flex items-center gap-1.5">
          <Trophy aria-hidden className="h-3.5 w-3.5" /> Records · last {weeks} weeks
          <InfoBubble>A session that beat every earlier session of the same exercise in your loaded history (the last 6 months), in the exercise&apos;s own measure. The first two sessions of an exercise never count — beating one earlier attempt isn&apos;t a record.</InfoBubble>
        </p>
        {prs.length === 0 ? (
          <p className="text-meta text-fg-muted">No records in this window.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {shownPrs.map(p => (
              <li key={`${p.templateId}-${p.date}`} className="flex flex-wrap items-baseline gap-x-2 text-body">
                <span className="w-14 shrink-0 text-meta tabular-nums text-fg-muted">{fmtDay(p.date)}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
                <span className="font-semibold tabular-nums text-fg">{fmtMetricValue(p.value, p.kind)}</span>
                <span className="text-meta tabular-nums text-fg-muted">was {fmtMetricValue(p.previousBest, p.kind)}</span>
              </li>
            ))}
          </ol>
        )}
        {prs.length > PR_LIMIT && (
          <button type="button" className="btn-ghost btn-sm -ml-2 mt-1 px-2 text-meta" onClick={() => setShowAllPrs(v => !v)}>
            {showAllPrs ? 'Show fewer' : `Show all ${prs.length}`}
          </button>
        )}
      </div>
      {summary.declined > 0 && <p className="text-meta text-fg-muted">A lower number after a planned deload, a new variation or time off isn&apos;t a setback — the per-exercise reasons are in the table below.</p>}
    </Card>
  )
}
