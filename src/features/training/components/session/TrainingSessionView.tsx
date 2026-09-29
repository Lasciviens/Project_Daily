import { useEffect, useMemo, type ReactNode } from 'react'
import { CalendarPlus } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Button, SkeletonText, TonePill } from '../../../../shared/ui'
import { useHevyWorkoutDetail } from '../../hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../hooks/useHevyRoutines'
import { useCurrentProgramRoutines } from '../../hooks/useAthleteProfile'
import { useSessionAnchor, useSessionDay, type SessionRequest } from '../../hooks/useTrainingSessionDetail'
import { matchRoutineToPlan } from '../../plan/nextSession'
import { openPlanRoutine } from '../../planTraining'
import { rememberShownWorkout } from '../../sessionLinks'
import { PLAN_TONE, WORKOUT_TONE, type CalendarPlanItem } from '../calendar/calendarModel'
import { planRoutineId, planStartHHMM, workoutStartHHMM } from '../calendar/calendarSessions'
import {
  SESSION_STATUS_LABEL, coveredPlanNote, planMinutes, planRefOf, sessionWhenLabel, weekdaysLabel,
} from '../../sessionRef'
import type { HevyRoutine } from '../../types.hevy'
import { SessionPlanMenu, type ExtraAction, type MenuPlan } from './SessionPlanMenu'
import { WorkoutSessionBody } from './WorkoutSessionBody'
import { PlannedSessionBody } from './PlannedSessionBody'

function StatusLine({ pill, children }: { pill: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-muted">
      {pill}
      {children}
    </div>
  )
}

const menuPlans = (plans: readonly CalendarPlanItem[], date: string): MenuPlan[] =>
  plans.flatMap(p => { const ref = planRefOf(p, date); return ref ? [{ ref, title: p.title }] : [] })

/**
 * The ONE training-session popup: a logged workout, or a planned session
 * (with the progress engine's targets, like Next). Compact by default —
 * exercises and the Apple Watch numbers are collapsed; changing or deleting
 * the plan sits behind ⋯. One shell from the first frame to the loaded
 * session, so opening never flashes a second dialog.
 */
export function TrainingSessionView({ request, onClose }: { request: SessionRequest; onClose: () => void }) {
  const anchor = useSessionAnchor(request)
  const { resolved, todayStr } = useSessionDay(request, anchor.date, anchor.planRow)
  const workoutQ = useHevyWorkoutDetail(resolved?.kind === 'workout' ? resolved.workoutId : null)
  const routinesQ = useHevyRoutines()
  const { data: program } = useCurrentProgramRoutines()
  const date = anchor.date

  // So a popup opened from here (the Apple workout) can recognise this one as
  // the same session even when it was opened from a plan (sessionLinks.ts).
  const shownWorkoutId = resolved?.kind === 'workout' ? resolved.workoutId : null
  useEffect(() => { rememberShownWorkout(request, shownWorkoutId) }, [request, shownWorkoutId])

  const planItem = resolved?.kind === 'plan' ? resolved.plan : null
  const workout = resolved?.kind === 'workout' ? workoutQ.data ?? null : null
  const routine = useMemo<HevyRoutine | null>(() => {
    const routines = routinesQ.data ?? []
    if (workout) return workout.routine_id ? routines.find(r => r.id === workout.routine_id) ?? null : null
    if (!planItem || !date) return null
    const programIds = new Set((program ?? []).map(p => p.routine_id))
    return matchRoutineToPlan({ title: planItem.title, date, startTime: planStartHHMM(planItem), sourceId: planRoutineId(planItem) }, routines, programIds)
  }, [routinesQ.data, workout, planItem, date, program])

  let title: ReactNode = 'Loading…'
  let subtitle: ReactNode | undefined
  let body: ReactNode = <SkeletonText lines={5} />
  let actions: ReactNode = null

  const anchorFailed = !date && ((anchor.query.isError && !anchor.query.isFetching) || (anchor.query.isSuccess && !anchor.query.isFetching))
  if (anchorFailed) {
    const failed = anchor.query.isError
    title = request.workoutId ? 'Can’t open this workout' : 'Can’t open this session'
    body = failed
      ? <div className="flex flex-col items-start gap-3"><p className="text-body text-fg-2">Couldn’t load it.</p><Button size="sm" onClick={() => { void anchor.query.refetch() }}>Try again</Button></div>
      : <p className="text-body text-fg-2">{request.workoutId ? 'This workout no longer exists.' : 'This planned session no longer exists.'}</p>
  } else if (resolved?.kind === 'missing') {
    title = 'Can’t open this session'
    body = <p className="text-body text-fg-2">This planned session no longer exists.</p>
  } else if (resolved?.kind === 'workout' && date) {
    const plans = resolved.plans
    title = workout?.title ?? (plans[0]?.title ?? 'Workout')
    subtitle = sessionWhenLabel(date, workout ? workoutStartHHMM(workout) : null, null, todayStr)
    const extra: ExtraAction[] = routine
      ? [{ label: 'Plan this routine again…', icon: <CalendarPlus />, onSelect: () => openPlanRoutine(routine) }]
      : []
    actions = <SessionPlanMenu plans={menuPlans(plans, date)} extra={extra} label="Session actions" />
    if (workoutQ.isError) {
      body = <div className="flex flex-col items-start gap-3"><p className="text-body text-fg-2">Couldn’t load this workout.</p><Button size="sm" onClick={() => { void workoutQ.refetch() }}>Try again</Button></div>
    } else if (workout) {
      body = (
        <div className="flex flex-col gap-4">
          <StatusLine pill={<TonePill tone={WORKOUT_TONE}>{SESSION_STATUS_LABEL.done}</TonePill>}>
            {plans.length > 0 && <span className="min-w-0">{coveredPlanNote(plans, workout)}</span>}
          </StatusLine>
          {workout.description && <p className="line-clamp-2 whitespace-pre-line text-meta text-fg-muted">{workout.description}</p>}
          <WorkoutSessionBody workout={workout} />
        </div>
      )
    }
  } else if (resolved?.kind === 'plan' && planItem && date) {
    const { status, offSchedule } = resolved
    title = planItem.title
    subtitle = sessionWhenLabel(date, planStartHHMM(planItem), planMinutes(planItem), todayStr)
    const extra: ExtraAction[] = routine && (status === 'missed' || status === 'done')
      ? [{ label: 'Plan it again…', icon: <CalendarPlus />, onSelect: () => openPlanRoutine(routine) }]
      : []
    actions = <SessionPlanMenu plans={menuPlans([planItem], date)} extra={extra} onDeleted={onClose} />
    const repeats = planItem.kind === 'recurring' && planItem.scheduleBlock ? `Repeats ${weekdaysLabel(planItem.scheduleBlock.days_of_week)}` : null
    body = (
      <div className="flex flex-col gap-4">
        <StatusLine pill={<TonePill tone={PLAN_TONE[status]}>{SESSION_STATUS_LABEL[status]}</TonePill>}>
          {repeats && <span>⟳ {repeats}</span>}
          {status === 'missed' && <span>Nothing was logged that day.</span>}
          {status === 'done' && <span>A Strava activity covered that day.</span>}
          {offSchedule && <span>This plan no longer falls on this day.</span>}
        </StatusLine>
        <PlannedSessionBody routine={routine} routinesLoading={routinesQ.isLoading} todayStr={todayStr} />
      </div>
    )
  }

  return (
    <ModalShell onClose={onClose} size="md" title={title} subtitle={subtitle} headerActions={actions}>
      {body}
    </ModalShell>
  )
}
