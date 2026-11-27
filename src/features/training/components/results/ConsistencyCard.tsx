import { useMemo, type ReactNode } from 'react'
import { CalendarCheck } from 'lucide-react'
import { Card, CardHeader, MetaLine, Skeleton, ToneDot } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useTodayStr } from '../../../../shared/hooks/useToday'
import { useTrainingWeek } from '../../hooks/useTrainingWeek'
import { useTrainingWeeks } from '../../hooks/useTrainingWeeks'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useAthleteProfile } from '../../hooks/useAthleteProfile'
import { useProgressDataContext } from '../../progress/progressDataContext'
import { sessionsFromSets } from '../../progressAggregate'
import { weekCount } from '../../plan/sessionState'
import { breakNote, longestBreak, previousMondays, showBreakNote, tallyWeeks } from '../../plan/results'
import { FailedRead } from './FailedRead'
import { easyWeekReasons, stalledAndDown, weeksSinceEasyWeek } from '../../coach/coachFacts'

function Fact({ label, info, value, children }: { label: string; info: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="section-label flex items-center gap-1.5">{label}<InfoBubble label={`About ${label.toLowerCase()}`}>{info}</InfoBubble></p>
      <p className="mt-0.5 text-lead font-bold tabular-nums text-fg">{value}</p>
      {children}
    </div>
  )
}

/** Results' third card: how the plan was kept — this week (the strip's own count), the 4 full weeks before it, the
 *  longest break (S27) and, only when S31/S32 apply, an easy week as an option. */
export function ConsistencyCard() {
  const today = useTodayStr()
  const mondays = useMemo(() => previousMondays(today), [today])
  const thisWeek = useTrainingWeek()
  const past = useTrainingWeeks(mondays)
  const { data: history, isError: historyError } = useTrainingHistory()
  const { data: profile } = useAthleteProfile()
  const progress = useProgressDataContext()

  const now = weekCount(thisWeek.week)
  const tally = useMemo(() => tallyWeeks(past.weeks), [past.weeks])
  const days = useMemo(() => sessionsFromSets(history?.sets ?? []).map(s => s.date), [history])
  const gap = useMemo(() => longestBreak(days, today), [days, today])
  const easy = useMemo(() => {
    const { stalled, regression } = stalledAndDown(progress.decisions)
    return easyWeekReasons({
      weeksSinceEasy: weeksSinceEasyWeek(days, today, profile?.training_days_per_week),
      stalled, regression, feeling: null, workloadReview: progress.program?.workload === 'review_workload',
    })
  }, [progress.decisions, progress.program, days, today, profile?.training_days_per_week])

  const failed = thisWeek.isError || past.isError || historyError
  if (!failed && (thisWeek.isLoading || past.isLoading)) return <Skeleton rounded="rounded-card" className="h-56" />
  if (failed) {
    return (
      <Card className="flex flex-col gap-2">
        <CardHeader icon={<CalendarCheck />} title="Consistency" className="!mb-0" />
        <FailedRead what="your planned sessions and workouts" />
      </Card>
    )
  }
  // S27's note only while a break of 7+ days is still running (a finished one needs no word).
  const note = showBreakNote(gap) && gap ? breakNote(gap.days) : null
  return (
    <Card className="@container flex flex-col gap-3">
      <CardHeader icon={<CalendarCheck />} title="Consistency" subtitle="Planned sessions, on their planned days" wrap className="!mb-0" />
      <div className="grid grid-cols-2 gap-3 @[32rem]:grid-cols-3">
        <Fact label="This week" value={now.planned > 0 ? `${now.done} of ${now.planned}` : '—'}
          info={<>Sessions done of the ones planned this week — the same count as the This week strip on Today and the Training
            box on Daily. A session you skipped leaves the count (it isn&apos;t planned any more).</>}>
          <p className="text-meta text-fg-muted">{now.planned > 0 ? 'done of planned' : 'nothing planned'}</p>
        </Fact>
        <Fact label="Last 4 weeks" value={tally.planned > 0 && tally.pct != null ? `${tally.done} of ${tally.planned} (${tally.pct}%)` : '—'}
          info={<>The 4 full weeks before this one ({formatDate(mondays[0])} to {formatDate(past.weeks[past.weeks.length - 1]?.sunday ?? mondays[3])}).
            Each week counted as the This week strip counts it: done of planned, on the day it was planned, a skipped session left
            out. <b>On its day</b>: done that day (or ticked by hand). <b>Late</b>: done up to 6 days after. <b>Early</b>: done up
            to 2 days before. <b>Skipped</b>: skipped by you, or not done within its week. <b>Dropped</b>: planned, its week
            passed, not done. Neither lowers anything else on this page.</>}>
          {tally.planned > 0 && (
            <MetaLine className="text-meta text-fg-muted" items={[
              `on its day ${tally.onDay}`, `late ${tally.late}`, tally.early > 0 && `early ${tally.early}`, `skipped ${tally.skipped}`, `dropped ${tally.dropped}`,
            ]} />
          )}
        </Fact>
        <Fact label="Longest break" value={gap ? `${gap.days} ${gap.days === 1 ? 'day' : 'days'}` : '—'}
          info={<>The most days from one workout to the next in the last 4 weeks (up to today when the break is still going).
            A break of 14 days or less costs nothing measurable; after 15–28 days the first sessions go a little easier, after
            more than 28 a comeback week.</>}>
          {gap && <p className="text-meta text-fg-muted">{gap.to ? `${formatDate(gap.from)} → ${formatDate(gap.to)}` : `since ${formatDate(gap.from)}`}</p>}
        </Fact>
      </div>
      {note && <p className="text-meta text-fg-2">{note}</p>}
      {easy.length > 0 && (
        <p className="flex items-start gap-2 rounded-row bg-surface-2 px-3 py-2 text-meta text-fg-2">
          <ToneDot tone="info" className="mt-1 shrink-0" />
          <span>
            <b className="font-semibold text-fg">An easy week is an option, not a must</b> — {easy.join('; ')}. One week, the same
            sessions, about half the sets, stopping 2–3 reps earlier.
            <InfoBubble label="When an easy week is offered">
              Offered (never forced) after 6 weeks without an easy week, when 2 or more lifts have stopped rising at their load,
              or when several lifts are declining. A week with half or fewer of your weekly sessions counts as an easy week. High
              weekly volume alone is never a reason. The coach reads the same rule.
            </InfoBubble>
          </span>
        </p>
      )}
    </Card>
  )
}
