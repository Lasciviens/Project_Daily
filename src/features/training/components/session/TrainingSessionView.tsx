import { useEffect, useMemo, type ReactNode } from 'react'
import { CalendarCog, CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { ModalShell, useEntityModal } from '../../../../shared/modals'
import { Button, SkeletonText, TonePill, Truncate } from '../../../../shared/ui'
import { useHevyWorkoutDetail } from '../../hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../hooks/useHevyRoutines'
import { useCurrentProgramRoutines } from '../../hooks/useAthleteProfile'
import { useTrainingSkips } from '../../hooks/useTrainingSkips'
import { useTrainingPlanActions } from '../../hooks/useTrainingPlanActions'
import { useSessionAnchor, useSessionDay, type SessionRequest } from '../../hooks/useTrainingSessionDetail'
import { matchRoutineToPlan } from '../../plan/nextSession'
import { planFacts } from '../../plan/planFacts'
import { SESSION_LABEL, SESSION_TONE, sessionNote, sessionStatus, type SessionStatus } from '../../plan/sessionState'
import { openPlanRoutine } from '../../planTraining'
import { rememberShownWorkout } from '../../sessionLinks'
import { WORKOUT_TONE } from '../calendar/calendarModel'
import { planRoutineId, planStartHHMM, workoutStartHHMM } from '../calendar/calendarSessions'
import { coveredPlanNote, planMinutes, sessionWhenLabel } from '../../sessionRef'
import { repeatSummary } from '../../../daily/recurrence'
import type { HevyRoutine } from '../../types.hevy'
import type { PlanTarget, TrainingPlanRef } from '../../api/trainingPlanApi'
import { SessionActionBar, SessionMenu } from './TrainingPlanActions'
import { useSessionActionItems, type SessionActionItem } from '../../hooks/useSessionActionItems'
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

const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** A plan's status line, its main actions and its targets. */
function PlanBody({ status, primary, busy, routine, repeats, offSchedule, routinesLoading, todayStr }: {
  status: SessionStatus
  primary: readonly SessionActionItem[]
  busy: boolean
  routine: HevyRoutine | null
  repeats: string | null
  offSchedule: boolean
  routinesLoading: boolean
  todayStr: string
}) {
  const note = sessionNote(status, routine?.title ?? null)
  return (
    <div className="flex flex-col gap-4">
      <StatusLine pill={<TonePill tone={SESSION_TONE[status.state]}>{SESSION_LABEL[status.state]}</TonePill>}>
        {repeats && <span>⟳ {repeats}</span>}
        {note && <span className="min-w-0 break-words text-fg-2">{note}</span>}
        {offSchedule && <span>This plan no longer falls on this day.</span>}
      </StatusLine>
      <SessionActionBar items={primary} busy={busy} />
      <PlannedSessionBody routine={routine} routinesLoading={routinesLoading} todayStr={todayStr} />
    </div>
  )
}

interface PlanContext {
  plan: TrainingPlanRef
  status: SessionStatus
  weekly: { templateId: string } | null
  skipId: string | null
}

/**
 * The ONE training-session popup: a logged workout, or a planned session
 * (with the progress engine's targets, like Next). Opened from a task, its
 * block on the calendar or a weekly plan's day, a plan reads the same task,
 * the same status (plan/sessionState) and offers the same actions
 * (TrainingPlanActions): Mark done, Move, Skip with a reason, Edit, Delete
 * with Undo. One shell from the first frame to the loaded session, so
 * opening never flashes a second dialog.
 */
export function TrainingSessionView({ request, onClose }: { request: SessionRequest; onClose: () => void }) {
  const modal = useEntityModal()
  const planActions = useTrainingPlanActions()
  const anchor = useSessionAnchor(request)
  const shown = anchor.request
  const orphan = anchor.orphanTask
  const task = anchor.task
  const { resolved, todayStr, hasActivity } = useSessionDay(shown, anchor.date, anchor.planRow)
  const workoutQ = useHevyWorkoutDetail(resolved?.kind === 'workout' ? resolved.workoutId : null)
  const routinesQ = useHevyRoutines()
  const { data: program } = useCurrentProgramRoutines()
  const { data: skips } = useTrainingSkips()
  const date = anchor.date

  // So a popup opened from here (the Apple workout) can recognise this one as
  // the same session even when it was opened from a plan (sessionLinks.ts).
  const shownWorkoutId = resolved?.kind === 'workout' ? resolved.workoutId : null
  useEffect(() => { rememberShownWorkout(request, shownWorkoutId) }, [request, shownWorkoutId])

  const planItem = resolved?.kind === 'plan' ? resolved.plan : null
  const workout = resolved?.kind === 'workout' ? workoutQ.data ?? null : null
  // The plan's task names its routine (141); a plan with no task is matched
  // by its block's routine or its title.
  const routine = useMemo<HevyRoutine | null>(() => {
    const routines = routinesQ.data ?? []
    if (workout) return workout.routine_id ? routines.find(r => r.id === workout.routine_id) ?? null : null
    const linked = task?.hevy_routine_id ? routines.find(r => r.id === task.hevy_routine_id) : null
    if (linked) return linked
    if (orphan) return routines.find(r => r.id.toLowerCase() === orphan.source_id) ?? null
    if (!planItem || !date) return null
    const programIds = new Set((program ?? []).map(p => p.routine_id))
    return matchRoutineToPlan({ title: planItem.title, date, startTime: planStartHHMM(planItem), sourceId: planRoutineId(planItem) }, routines, programIds)
  }, [routinesQ.data, workout, task, orphan, planItem, date, program])

  // The planned session shown (a plan, or a task not on the calendar): one
  // target, one status (sessionState), one action list for buttons and ⋯.
  const planCtx = ((): PlanContext | null => {
    const now = nowHHMM()
    if (orphan) {
      const day = orphan.due_date ?? todayStr
      const plan: TrainingPlanRef = {
        target: { kind: 'task', taskId: orphan.id, blockId: null },
        info: { title: orphan.title, date: day, startHHMM: orphan.due_time?.slice(0, 5) ?? null, minutes: null, routineId: routine?.id ?? orphan.hevy_routine_id ?? null },
      }
      const status = sessionStatus(planFacts({
        date: day, startHHMM: plan.info.startHHMM, taskId: orphan.id, taskStatus: orphan.status,
        taskWorkoutId: orphan.hevy_workout_id, taskRoutineId: orphan.hevy_routine_id ?? null, routineId: plan.info.routineId,
      }, { today: todayStr, nowHHMM: now, skips: skips ?? [] }))
      return { plan, status, weekly: null, skipId: null }
    }
    if (resolved?.kind !== 'plan' || !planItem || !date) return null
    const block = planItem.kind === 'block' ? planItem.timeBlock ?? null : null
    const template = planItem.kind === 'recurring' ? planItem.scheduleBlock ?? null : null
    const taskId = task?.id ?? block?.task_id ?? null
    if (!taskId && !block && !template) return null
    const target: PlanTarget = taskId ? { kind: 'task', taskId, blockId: block?.id ?? null }
      : block ? { kind: 'block', blockId: block.id }
      : { kind: 'weekly', templateId: template!.id, date }
    const plan: TrainingPlanRef = {
      target,
      info: { title: planItem.title, date, startHHMM: planStartHHMM(planItem), minutes: planMinutes(planItem), routineId: routine?.id ?? task?.hevy_routine_id ?? null },
    }
    const facts = planFacts({
      date, startHHMM: plan.info.startHHMM, minutes: plan.info.minutes, taskId,
      taskStatus: task?.status ?? block?.task_status ?? null,
      taskWorkoutId: task?.hevy_workout_id ?? block?.task_workout_id ?? null,
      taskRoutineId: task?.hevy_routine_id ?? block?.task_routine_id ?? null,
      routineId: routine?.id ?? null,
    }, { today: todayStr, nowHHMM: now, skips: skips ?? [], hasActivity })
    const status = sessionStatus(facts)
    return { plan, status, weekly: target.kind === 'weekly' ? { templateId: target.templateId } : null, skipId: facts.skipId }
  })()
  const planItems = useSessionActionItems({
    plan: planCtx?.plan ?? null, status: planCtx?.status ?? null,
    weekly: planCtx?.weekly, skipId: planCtx?.skipId, onGone: onClose,
  })

  let title: ReactNode = 'Loading…'
  let subtitle: ReactNode | undefined
  let body: ReactNode = <SkeletonText lines={5} />
  let actions: ReactNode = null

  const anchorFailed = !date && !orphan && ((anchor.query.isError && !anchor.query.isFetching) || (anchor.query.isSuccess && !anchor.query.isFetching))
  if (orphan && planCtx) {
    // A training task with no time on the calendar and no workout yet.
    title = orphan.title
    subtitle = `${sessionWhenLabel(planCtx.plan.info.date, planCtx.plan.info.startHHMM, null)} · not on your calendar`
    body = (
      <PlanBody status={planCtx.status} primary={planItems.primary} busy={planItems.busy} routine={routine} repeats={null} offSchedule={false}
        routinesLoading={routinesQ.isLoading} todayStr={todayStr} />
    )
    actions = <SessionMenu items={planItems.more} busy={planItems.busy} />
  } else if (anchorFailed) {
    const failed = anchor.query.isError
    title = shown.workoutId ? 'Can’t open this workout' : 'Can’t open this session'
    body = failed
      ? <div className="flex flex-col items-start gap-3"><p className="text-body text-fg-2">Couldn’t load it.</p><Button size="sm" onClick={() => { void anchor.query.refetch() }}>Try again</Button></div>
      : <p className="text-body text-fg-2">{shown.workoutId ? 'This workout no longer exists.' : 'This planned session no longer exists.'}</p>
  } else if (resolved?.kind === 'missing') {
    title = 'Can’t open this session'
    body = <p className="text-body text-fg-2">This planned session no longer exists.</p>
  } else if (resolved?.kind === 'workout' && date) {
    const plans = resolved.plans
    title = workout?.title ?? (plans[0]?.title ?? 'Workout')
    subtitle = sessionWhenLabel(date, workout ? workoutStartHHMM(workout) : null, null)
    // The plans this workout did: change or delete each (Delete asks and
    // offers Undo), and plan the routine again for another day.
    const items: SessionActionItem[] = []
    if (routine) items.push({ key: 'again', label: 'Plan this routine again…', icon: <CalendarPlus />, onSelect: () => openPlanRoutine(routine) })
    for (const p of plans) {
      const suffix = plans.length > 1 ? ` · ${p.title}` : ''
      if (p.kind === 'recurring' && p.scheduleBlock) {
        const id = p.scheduleBlock.id
        items.push({ key: `weekly-${p.id}`, label: `Change repeating plan…${suffix}`, icon: <CalendarCog />, onSelect: () => modal.open({ kind: 'schedule-block', id, config: { heading: 'Change repeating plan' } }) })
        continue
      }
      const b = p.timeBlock
      if (!b) continue
      const target: PlanTarget = b.task_id ? { kind: 'task', taskId: b.task_id, blockId: b.id } : { kind: 'block', blockId: b.id }
      const ref: TrainingPlanRef = { target, info: { title: p.title, date: b.date, startHHMM: planStartHHMM(p), minutes: planMinutes(p), routineId: planRoutineId(p) } }
      items.push({ key: `edit-${p.id}`, label: `${b.task_id ? 'Edit session…' : 'Edit plan…'}${suffix}`, icon: <Pencil />,
        onSelect: () => (b.task_id ? modal.open({ kind: 'task', id: b.task_id }) : modal.open({ kind: 'time-block', id: b.id, config: { heading: 'Change plan' } })) })
      items.push({ key: `delete-${p.id}`, label: `Delete plan${suffix}`, icon: <Trash2 />, danger: true, onSelect: () => { void planActions.deleteSession(ref) } })
    }
    actions = <SessionMenu items={items} />
    if (workoutQ.isError) {
      body = <div className="flex flex-col items-start gap-3"><p className="text-body text-fg-2">Couldn’t load this workout.</p><Button size="sm" onClick={() => { void workoutQ.refetch() }}>Try again</Button></div>
    } else if (workout) {
      body = (
        <div className="flex flex-col gap-4">
          <StatusLine pill={<TonePill tone={WORKOUT_TONE}>{SESSION_LABEL.done}</TonePill>}>
            {plans.length > 0 && <span className="min-w-0">{coveredPlanNote(plans, workout)}</span>}
          </StatusLine>
          {workout.description && <Truncate as="p" lines={2} className="whitespace-pre-line text-meta text-fg-muted">{workout.description}</Truncate>}
          <WorkoutSessionBody workout={workout} />
        </div>
      )
    }
  } else if (resolved?.kind === 'plan' && planItem && date && planCtx) {
    const template = planItem.kind === 'recurring' ? planItem.scheduleBlock ?? null : null
    title = planItem.title
    subtitle = sessionWhenLabel(date, planCtx.plan.info.startHHMM, planCtx.plan.info.minutes)
    body = (
      <PlanBody status={planCtx.status} primary={planItems.primary} busy={planItems.busy} routine={routine}
        repeats={template ? repeatSummary(template) : null} offSchedule={resolved.offSchedule}
        routinesLoading={routinesQ.isLoading} todayStr={todayStr} />
    )
    actions = <SessionMenu items={planItems.more} busy={planItems.busy} />
  }

  return (
    <ModalShell onClose={onClose} size="md" title={title} subtitle={subtitle} headerActions={actions}>
      {body}
    </ModalShell>
  )
}
