import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, TrendingUp } from 'lucide-react'
import { Card, CardHeader, Skeleton, TonePill, Truncate, type Tone } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useProgressDataContext } from '../../progress/progressDataContext'
import { ExerciseTrendChart } from '../../progress/ExerciseTrendChart'
import { FailedRead } from './FailedRead'
import { MAIN_LIFT_WEEKS, mainLiftIds, mainLifts, type Arrow, type E1rmTrend, type MainLift, type RepsTrend } from '../../plan/results'

const ARROW: Record<Arrow, { icon: typeof ArrowUpRight; word: string; tone: Tone }> = {
  up: { icon: ArrowUpRight, word: 'Up', tone: 'success' },
  flat: { icon: ArrowRight, word: 'Flat', tone: 'neutral' },
  // Down is information, never a warning (S14: slow progress is not failure).
  down: { icon: ArrowDownRight, word: 'Down', tone: 'neutral' },
}

function ArrowPill({ arrow, pct }: { arrow: Arrow; pct?: number | null }) {
  const a = ARROW[arrow]
  const Icon = a.icon
  return (
    <TonePill tone={a.tone} className="shrink-0 tabular-nums">
      <Icon aria-hidden className="h-3 w-3" />{a.word}{pct != null ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''}
    </TonePill>
  )
}

const reps = (xs: readonly number[]) => xs.join('/')

function E1rmLine({ t }: { t: E1rmTrend }) {
  return (
    <>
      <span className="block text-meta tabular-nums text-fg-2">
        Estimated 1RM {t.start != null ? <>{t.start} → <b className="font-semibold text-fg">{t.end} kg</b></> : <b className="font-semibold text-fg">{t.end} kg</b>}
      </span>
      {!t.arrow && <span className="block text-meta text-fg-muted">{t.sessions} {t.sessions === 1 ? 'session' : 'sessions'} in {MAIN_LIFT_WEEKS} weeks — the arrow needs 4 over 3+ weeks</span>}
    </>
  )
}

function RepsLine({ t }: { t: RepsTrend }) {
  const load = t.loadKg != null ? `${t.loadKg} kg: ` : 'Bodyweight: '
  return (
    <>
      <span className="block text-meta tabular-nums text-fg-2">
        {load}{t.earlier ? <>{reps(t.earlier)} → </> : null}<b className="font-semibold text-fg">{reps(t.latest)}</b> reps
      </span>
      <span className="block text-meta text-fg-muted">
        {t.earlierDate ? `${formatDate(t.earlierDate)} → ${formatDate(t.latestDate)}` : formatDate(t.latestDate)} · reps at one load (no e1RM above 10 reps){!t.arrow ? ` · the arrow needs 4 sessions over 3+ weeks` : ''}
      </span>
    </>
  )
}

function LiftRow({ lift }: { lift: MainLift }) {
  const [open, setOpen] = useState(false)
  const { sessionsByTemplateId, metricKindByTemplateId } = useProgressDataContext()
  const t = lift.trend
  const sessions = sessionsByTemplateId.get(lift.templateId) ?? []
  return (
    <li className="border-b border-line py-2 last:border-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} title={`${lift.title}: show its chart`}
        className="flex w-full items-start gap-2 text-left">
        <ChevronDown aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="min-w-0 flex-1">
          <Truncate className="block text-body font-medium text-fg">{lift.title}</Truncate>
          {t?.kind === 'e1rm' && <E1rmLine t={t} />}
          {t?.kind === 'reps' && <RepsLine t={t} />}
          {!t && <span className="block text-meta text-fg-muted">Not trained in the last {MAIN_LIFT_WEEKS} weeks</span>}
        </span>
        {t?.arrow && <ArrowPill arrow={t.arrow} pct={t.kind === 'e1rm' ? t.changePct : null} />}
      </button>
      {open && (
        <div className="mt-2">
          {sessions.length > 0
            ? <ExerciseTrendChart sessions={sessions} metricKind={metricKindByTemplateId.get(lift.templateId) ?? 'est1rm'} />
            : <p className="text-meta text-fg-muted">No sessions to chart yet.</p>}
        </div>
      )}
    </li>
  )
}

/** Results' first card: each main lift's trend over the last 8 weeks (by default every current-program routine's
 *  first exercise) — estimated 1RM from sets of 10 reps or fewer, or reps at one load; an arrow only after 3 weeks.
 *  A tap opens the lift's chart. */
export function MainLiftsCard() {
  const { activeRoutines, titleById, today, isLoading: loadingProgress } = useProgressDataContext()
  const { data: history, isLoading, isError } = useTrainingHistory()
  const lifts = useMemo(() => {
    if (!history) return []
    return mainLifts(history.sets, history.templates, mainLiftIds(activeRoutines), today, id => titleById.get(id))
  }, [history, activeRoutines, titleById, today])

  if ((isLoading && !isError) || loadingProgress) return <Skeleton rounded="rounded-card" className="h-48" />
  return (
    <Card className="flex flex-col">
      <CardHeader
        icon={<TrendingUp />}
        title={<span className="inline-flex items-center gap-1.5">Main lifts
          {/* Says what est1RM (progressAggregate), liftChange (plan/improvement) and plan/results do: change them together. */}
          <InfoBubble label="What the main lifts show">
            <b>Estimated 1RM (e1RM)</b>: the most you could lift once, worked out from your sets — weight × (1 + reps ÷ 30), only
            from sets of 10 reps or fewer. It is an estimate, not a test. Single sessions vary 3–6 % (sleep, food, the day), so
            the trend compares the best of the first two and the last two sessions in the last {MAIN_LIFT_WEEKS} weeks, over 3+
            weeks and 4+ sessions; within ±3 % reads flat.
            <span className="mt-1.5 block">A lift trained above 10 reps shows its <b>reps at one load</b> instead, by the same
            rule (the better of the first two and the last two sessions at that weight; a change under 1 rep a set reads flat) —
            more reps at the same weight is progress too. A timed move (a plank) has no reps or load to compare and is left out. The main lifts are the first exercise of each routine in your current program.</span>
          </InfoBubble>
        </span>}
        subtitle={`Last ${MAIN_LIFT_WEEKS} weeks · tap a lift for its chart`}
      />
      {isError ? <FailedRead what="your workouts" /> : lifts.length === 0
        ? <p className="text-body text-fg-muted">No current-program routine with exercises yet — pick your program on the Plan tab.</p>
        : <ul className="flex flex-col">{lifts.map(l => <LiftRow key={l.templateId} lift={l} />)}</ul>}
    </Card>
  )
}
