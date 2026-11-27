import { CalendarClock, CalendarPlus, Dumbbell, Moon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Card, EmptyState, KeepRoom, PageBoard, Skeleton, ToneDot, cx, useBoardStep } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { usePlanThis } from '../../../items/usePlanThis'
import { daysBetween } from '../../plan/nextSession'
import type { TrainingTabId } from '../../pages/trainingTabs'
import { useNextPlan, type NextPlan } from './useNextPlan'
import { useRecoveryNotes } from './useRecoveryNotes'
import type { RecoveryNote } from '../../plan/recovery'
import { NextExerciseCard } from './NextExerciseCard'
import { SourceNote } from '../program/SourceNote'
import { ThisWeekStrip, TodaysCall } from '../week/ThisWeekStrip'
import { TrainingPlanMenu } from '../session/TrainingPlanActions'
import { sessionStatus } from '../../plan/sessionState'
import type { TrainingPlanRef } from '../../api/trainingPlanApi'
import { NEXT_BOARD } from '../../trainingBoards'
import { NextReadsAhead } from './NextReadsAhead'

function whenText(date: string, startTime: string | null, today: string): string {
  const d = daysBetween(today, date)
  // A missed session still open reads as Daily's does: "Open since Thu 26.11.2026" (never its past time).
  if (d < 0) return `Open since ${formatWeekdayDate(date)}`
  const day = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : formatWeekdayDate(date, 'long')
  return startTime ? `${day} · ${startTime}` : day
}

function lastDoneText(last: string | null, today: string): string {
  if (!last) return 'Not trained in the last 6 months'
  const d = daysBetween(last, today)
  return d === 0 ? 'Last done today' : d === 1 ? 'Last done yesterday' : `Last done ${d} days ago`
}

function SessionHeader({ plan }: { plan: NextPlan }) {
  const planThis = usePlanThis()
  const { pick, routine, session, today } = plan
  const title = routine?.title ?? session?.title ?? 'Next session'
  // The exercises are already on this page, so the plan's actions (done,
  // move, skip, edit, delete) sit behind ⋯ — the same list as the session
  // popup and the task row (TrainingPlanActions).
  const planned: TrainingPlanRef | null = pick?.source === 'planned' && session
    ? {
        target: session.taskId ? { kind: 'task', taskId: session.taskId, blockId: session.kind === 'block' ? session.id : null }
          : session.kind === 'block' ? { kind: 'block', blockId: session.id }
          : { kind: 'weekly', templateId: session.id, date: session.date },
        info: { title: session.title, date: session.date, startHHMM: session.startTime, minutes: null, routineId: routine?.id ?? null },
      }
    : null
  // Next only ever holds a session still to do (useNextTrainingSession: this week's first, else the soonest).
  const status = planned ? sessionStatus({ date: planned.info.date, startHHMM: planned.info.startHHMM, taskStatus: session?.taskId ? 'open' : null, taskRoutineId: routine?.id ?? null, today }) : null
  return (
    <Card className="flex flex-col gap-3">
      <TodaysCall lastTrained={plan.lastTrained} />
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600"><CalendarClock className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="section-label">{pick?.source === 'planned' ? 'Next session' : 'Next in your rotation'}</p>
          <h2 className="text-title font-semibold text-fg">{title}</h2>
          <p className="text-meta text-fg-muted">
            {pick?.source === 'planned' && session ? whenText(session.date, session.startTime, today) : 'Nothing planned — your current-program routine trained longest ago'}
            {routine ? ` · ${lastDoneText(pick?.lastTrained ?? null, today)}` : ''}
          </p>
        </div>
        {planned && status && (
          <span className="-mr-2 -mt-1">
            <TrainingPlanMenu plan={planned} status={status} weekly={planned.target.kind === 'weekly' ? { templateId: planned.target.templateId } : null} label="Session actions" />
          </span>
        )}
      </div>
      {pick?.source === 'planned' && !routine && (
        <p className="text-meta text-fg-muted">This session isn&apos;t linked to a Hevy routine, so there&apos;s no exercise list. Plan it from a routine (Library → Routines) to see targets here.</p>
      )}
      {pick?.source === 'least_recent' && routine && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<CalendarPlus />} onClick={() => { void planThis({ kind: 'training', routine, date: today }) }} tip="Plan this session">Plan</Button>
        </div>
      )}
    </Card>
  )
}

/** The recovery line's box: in the wide page's rail it fills the rail like the cards above it (`w-full`); in the
 *  phone stack it hugs its text (`w-fit`). */
const RECOVERY_BOX = 'flex max-w-2xl flex-col gap-1 rounded-row border border-line bg-surface px-3 py-2'

function RecoveryLine() {
  const { notes, isLoading, isError } = useRecoveryNotes()
  const inRail = useBoardStep() > 1
  // Its reads (last night, the resting heart rate) come in on their own: until then it keeps the room it took last
  // time, the first time its heading and one note — a note shows whenever the reads answer (KeepRoom, THEME.md §5).
  return (
    <KeepRoom
      ids="training:recovery" loading={isLoading} remember={!isError} className="flex flex-col"
      skeleton={(
        <div aria-hidden className={cx(RECOVERY_BOX, 'w-full flex-1')}>
          <span className="flex h-4 items-center"><Skeleton className="h-2.5 w-28" /></span>
          <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-2/3" /></span>
        </div>
      )}
    >
      {notes.length > 0 && <RecoveryNotes notes={notes} inRail={inRail} />}
    </KeepRoom>
  )
}

function RecoveryNotes({ notes, inRail }: { notes: RecoveryNote[]; inRail: boolean }) {
  return (
    <div className={cx(RECOVERY_BOX, inRail ? 'w-full' : 'w-fit')}>
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

/** Program-level heads-up (several lifts declining at once). An exercise's own alert sits on its card. */
function Alerts({ plan }: { plan: NextPlan }) {
  if (plan.alerts.length === 0) return null
  return (
    <Card className="flex max-w-2xl flex-col gap-2">
      <p className="section-label flex items-center gap-1.5">
        Heads-up
        <InfoBubble>
          Straight from the progress engine, about the program as a whole. A note about one exercise is on its own card
          below; every exercise, grouped by what to do next, is on the Results tab.
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

/** The default Training tab (Today): what to do next, set by set. The session and its exercises show once the plan
 *  is in; the lines above the exercises (this week, recovery) come in on their own reads, each keeping its room until
 *  then (KeepRoom), so they never push the exercises down nor hold them back. The muscle watch lives on Results. */
export function TodayTab({ onGoTo }: { onGoTo: (tab: TrainingTabId) => void }) {
  const plan = useNextPlan()

  if (plan.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <NextReadsAhead />
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
          ? 'Choose which Hevy routines you are running now. Today then shows the routine you trained longest ago, with a target for every set.'
          : 'Plan a training session, or add routines to your current program.'}
        action={<Button variant="primary" onClick={() => onGoTo('plan')} tip="Open the Plan tab">Open Plan</Button>}
      />
    )
  }

  // Placed by PageBoard (trainingBoards.ts → NEXT_BOARD): the session and its
  // context (this week, recovery, the program's heads-up) in a rail, the exercise cards beside it.
  return (
    <PageBoard layout={NEXT_BOARD} stackGap="gap-3" sections={{
      session: <div className="max-w-2xl"><SessionHeader plan={plan} /></div>,
      week: <ThisWeekStrip where="next" className="max-w-2xl" />,
      recovery: <RecoveryLine />,
      alerts: <Alerts plan={plan} />,
      exercises: plan.rows.length > 0 && (
        <ExerciseGrid>
          {plan.rows.map(r => <NextExerciseCard key={`${r.templateId}-${r.order}`} row={r} alert={plan.alertByExercise.get(r.templateId) ?? null} />)}
        </ExerciseGrid>
      ),
      note: plan.needsCurrentProgram && (
        <p className="max-w-2xl text-meta text-fg-muted">
          Targets need a current program — pick it on the <button type="button" className="font-semibold text-accent-600" onClick={() => onGoTo('plan')}>Plan tab</button>.
        </p>
      ),
    }} />
  )
}
