import { CalendarClock, CalendarPlus, Dumbbell, Moon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Card, EmptyState, PageBoard, Skeleton, ToneDot, useBoardStep } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { openPlanRoutine } from '../../planTraining'
import { daysBetween } from '../../plan/nextSession'
import type { TrainingTabId } from '../../pages/trainingTabs'
import { useNextPlan, type NextPlan } from './useNextPlan'
import { useRecoveryNotes } from './useRecoveryNotes'
import { NextExerciseCard } from './NextExerciseCard'
import { SourceNote } from '../program/SourceNote'
import { MissedSessionsCard } from '../program/MissedSessions'
import { SessionPlanMenu } from '../session/SessionPlanMenu'
import { NEXT_BOARD } from '../../trainingBoards'

function whenText(date: string, startTime: string | null, today: string): string {
  const d = daysBetween(today, date)
  const day = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : fmtDateEnGB(new Date(`${date}T12:00:00`), { weekday: 'long', day: 'numeric', month: 'short' })
  return startTime ? `${day} · ${startTime}` : day
}

function lastDoneText(last: string | null, today: string): string {
  if (!last) return 'Not trained in the last 6 months'
  const d = daysBetween(last, today)
  return d === 0 ? 'Last done today' : d === 1 ? 'Last done yesterday' : `Last done ${d} days ago`
}

function SessionHeader({ plan }: { plan: NextPlan }) {
  const { pick, routine, session, today } = plan
  const title = routine?.title ?? session?.title ?? 'Next session'
  // The exercises are already on this page, so the plan itself (date, time,
  // which routine) is a deliberate second step behind ⋯ — the same menu as
  // the session popup.
  const planned = pick?.source === 'planned' && session
    ? [{ ref: { kind: session.kind, id: session.id, date: session.date }, title: session.title }]
    : []
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600"><CalendarClock className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="section-label">{pick?.source === 'planned' ? 'Next planned session' : 'Next in your rotation'}</p>
          <h2 className="text-title font-semibold text-fg">{title}</h2>
          <p className="text-meta text-fg-muted">
            {pick?.source === 'planned' && session ? whenText(session.date, session.startTime, today) : 'Nothing planned — your current-program routine trained longest ago'}
            {routine ? ` · ${lastDoneText(pick?.lastTrained ?? null, today)}` : ''}
          </p>
        </div>
        {planned.length > 0 && <span className="-mr-2 -mt-1"><SessionPlanMenu plans={planned} label="Change this session" /></span>}
      </div>
      {pick?.source === 'planned' && !routine && (
        <p className="text-meta text-fg-muted">This session isn&apos;t linked to a Hevy routine, so there&apos;s no exercise list. Plan it from a routine (Library → Routines) to see targets here.</p>
      )}
      {pick?.source === 'least_recent' && routine && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<CalendarPlus />} onClick={() => openPlanRoutine(routine, { date: today })}>Plan this session</Button>
        </div>
      )}
    </Card>
  )
}

function RecoveryLine() {
  const { notes, isLoading } = useRecoveryNotes()
  // In the wide page's rail it fills the rail like the cards above it; in the
  // phone stack it hugs its text.
  const inRail = useBoardStep() > 1
  if (isLoading || notes.length === 0) return null
  return (
    <div className={`flex ${inRail ? 'w-full' : 'w-fit'} max-w-2xl flex-col gap-1 rounded-row border border-line bg-surface px-3 py-2`}>
      <p className="section-label flex items-center gap-1.5">
        <Moon aria-hidden className="h-3.5 w-3.5" /> Recovery context
        <InfoBubble>
          <b>Two facts, no score.</b> Last night&apos;s sleep against the 7-hour adult guideline — after a night under 6 hours,
          strength and performance dip on average — and your resting heart rate over the last 7 days against your own usual level
          (the 60 days before). A rise of 5+ bpm is a common monitoring cue, not a diagnosis; one signal alone never means
          &quot;skip training&quot;.
          <span className="mt-1.5 block"><SourceNote ids={['watson2015', 'craven2022']} /></span>
        </InfoBubble>
      </p>
      {notes.map((n, i) => (
        <p key={i} className="flex items-start gap-2 text-body text-fg-2">
          <ToneDot tone={n.tone} className="mt-1.5 shrink-0" />{n.text}
        </p>
      ))}
    </div>
  )
}

function Alerts({ plan }: { plan: NextPlan }) {
  if (plan.alerts.length === 0) return null
  return (
    <Card className="flex max-w-2xl flex-col gap-2">
      <p className="section-label flex items-center gap-1.5">
        Heads-up
        <InfoBubble>
          Straight from the progress engine: a lift is <b>ready to increase</b> when every prescribed set reached the top of its
          rep range; <b>flat</b> means no rep or load gain across several comparable sessions at the same load; <b>dropping</b>
          means a repeated decline beyond normal noise. Details per exercise are on the Progress tab.
        </InfoBubble>
      </p>
      <ul className="flex flex-col gap-1.5">
        {plan.alerts.map(a => (
          <li key={a.id} className="flex items-start gap-2 text-body text-fg-2"><ToneDot tone={a.tone} className="mt-1.5 shrink-0" />{a.text}</li>
        ))}
      </ul>
    </Card>
  )
}

/** The exercise cards: one column on a phone or tablet; once the board gives
 *  them a wide track, as many ≥ 22rem columns as fit, sharing the width (a
 *  fixed maximum would make auto-fill count by the maximum and leave a
 *  column's worth empty — two at 1469, four at 2450). */
function ExerciseGrid({ children }: { children: ReactNode }) {
  const wide = useBoardStep() > 1
  return (
    <div className={wide
      ? 'grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-3'
      : 'grid max-w-2xl grid-cols-1 items-start gap-3'}>
      {children}
    </div>
  )
}

/** The default Training tab: what to do next, set by set. */
export function NextTab({ onGoTo }: { onGoTo: (tab: TrainingTabId) => void }) {
  const plan = useNextPlan()

  if (plan.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton rounded="rounded-card" className="h-28" />
        <Skeleton rounded="rounded-card" className="h-40" />
        <Skeleton rounded="rounded-card" className="h-40" />
      </div>
    )
  }

  if (!plan.pick) {
    return (
      <EmptyState
        bordered
        icon={<Dumbbell />}
        title={plan.needsCurrentProgram ? 'Pick your current program' : 'Nothing to show yet'}
        description={plan.needsCurrentProgram
          ? 'Choose which Hevy routines you are running now. Next then shows the routine you trained longest ago, with a target for every set.'
          : 'Plan a training session, or add routines to your current program.'}
        action={<Button variant="primary" onClick={() => onGoTo('program')}>Open Program</Button>}
      />
    )
  }

  // The RPE explainer once, on the first card whose last session was rated.
  const firstRatedRow = plan.rows.findIndex(r => r.lastHasRpe)
  // Placed by PageBoard (trainingBoards.ts → NEXT_BOARD): the session and its
  // context (missed, recovery, heads-up) in a rail, the exercise cards beside it.
  return (
    <PageBoard layout={NEXT_BOARD} stackGap="gap-3" sections={{
      session: <div className="max-w-2xl"><SessionHeader plan={plan} /></div>,
      missed: <MissedSessionsCard />,
      recovery: <RecoveryLine />,
      alerts: <Alerts plan={plan} />,
      exercises: plan.rows.length > 0 && (
        <ExerciseGrid>
          {plan.rows.map((r, i) => <NextExerciseCard key={`${r.templateId}-${r.order}`} row={r} explainRpe={i === firstRatedRow} />)}
        </ExerciseGrid>
      ),
      note: plan.needsCurrentProgram && (
        <p className="max-w-2xl text-meta text-fg-muted">
          Targets need a current program. <button type="button" className="font-semibold text-accent-600" onClick={() => onGoTo('program')}>Pick it on the Program tab</button>.
        </p>
      ),
    }} />
  )
}
