import { AlertTriangle, CalendarCheck, CalendarPlus, SkipForward, Undo2 } from 'lucide-react'
import { Button, Card, cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useEntityModal } from '../../../../shared/modals'
import { openPlanRoutine } from '../../planTraining'
import { useMissedSessions, useUndoTrainingSkip } from '../../hooks/useTrainingSkips'
import { useTrainingPlanActions } from '../../hooks/useTrainingPlanActions'
import { useFirstPlanDay } from '../../hooks/useTrainingPlans'
import { useOpenTrainingSessionTasks } from '../../../todo/hooks/useTodos'
import { OVERDUE_AFTER_DAYS, missedText, type RoutineAttention } from '../../plan/skippedRoutines'
import { weekIsOver } from '../../plan/sessionState'
import type { TrainingPlanRef } from '../../api/trainingPlanApi'
import type { Task } from '../../../todo/types'
import { plannedDayText, shortDay } from './missedSessionCopy'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Label() {
  return (
    <p className="section-label flex items-center gap-1.5">
      Missed sessions
      <InfoBubble>
        A current-program routine is flagged once it hasn&apos;t been logged for more than {OVERDUE_AFTER_DAYS} days and no
        one-off session is planned for it. It was due {OVERDUE_AFTER_DAYS} days after you last did it. <b>Plan it</b> on a day
        that works, or <b>skip</b> it with a reason: a skip covers that one session, and if the next one is missed too it is
        flagged again. A weekly repeat on your calendar doesn&apos;t count as a plan — it always has a next date.
      </InfoBubble>
    </p>
  )
}

/** The routine's open plan from before today, newest first — the session
 *  "Plan it" moves and "Skip" skips (owner: never a second plan beside it). */
function openPastPlan(tasks: readonly Task[], routineId: string, today: string): TrainingPlanRef | null {
  const t = tasks
    .filter(x => x.hevy_routine_id === routineId && x.due_date && x.due_date < today)
    .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? ''))[0]
  if (!t?.due_date) return null
  return {
    target: { kind: 'task', taskId: t.id, blockId: null },
    info: { title: t.title, date: t.due_date, startHHMM: t.due_time?.slice(0, 5) ?? null, minutes: null, routineId },
  }
}

function Row({ item, today, openTasks }: { item: RoutineAttention; today: string; openTasks: readonly Task[] }) {
  const modal = useEntityModal()
  const undo = useUndoTrainingSkip()
  const actions = useTrainingPlanActions()
  const pending = openPastPlan(openTasks, item.routineId, today)
  // A session's own skip after its week can't be undone: reopened, the hourly
  // job skips it again (167). Its first day, else the day it was filed under.
  const skipTaskId = item.kind === 'skipped' ? item.skip.task_id ?? null : null
  const firstDay = useFirstPlanDay(skipTaskId)
  const undoable = item.kind === 'skipped' && !(skipTaskId && weekIsOver(firstDay ?? item.skip.plan_date, today))
  const planIt = () =>(pending ? actions.openMove(pending) : openPlanRoutine({ id: item.routineId, title: item.title }, { date: today }))
  const skip = () => modal.open({ kind: 'training-plan-skip', ...(pending
    ? { plan: pending }
    : { missed: { routineId: item.routineId, title: item.title, dueDate: item.dueDate, weekStart: item.weekStart } }) })
  const icon = item.kind === 'overdue'
    ? <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
    : item.kind === 'skipped'
      ? <SkipForward aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
      : <CalendarCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
  const detail = item.kind === 'overdue'
    ? `${capitalize(missedText(item))} · was due ${shortDay(item.dueDate)}${pending ? ` · planned ${shortDay(pending.info.date)}, not done` : ''}`
    : item.kind === 'skipped'
      ? `Skipped the ${shortDay(item.dueDate)} session: ${item.skip.reason}`
      : `Replanned for ${plannedDayText(item.plannedDate, today)}`
  return (
    <li className={cx('flex flex-col gap-2 rounded-row px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3', item.kind === 'overdue' ? 'bg-warn-soft' : 'bg-surface-2')}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon}
        <div className="min-w-0">
          <p className="break-words text-body font-semibold text-fg">{item.title}</p>
          <p className="break-words text-meta text-fg-2">{detail}</p>
        </div>
      </div>
      {item.kind === 'overdue' && (
        <div className="flex flex-wrap gap-2 pl-6 sm:shrink-0 sm:pl-0">
          <Button size="sm" icon={<CalendarPlus />} onClick={planIt}>{pending ? 'Move it' : 'Plan it'}</Button>
          <Button size="sm" variant="ghost" icon={<SkipForward />} onClick={skip}>Skip</Button>
        </div>
      )}
      {item.kind === 'skipped' && undoable && (
        <div className="pl-6 sm:shrink-0 sm:pl-0">
          <Button size="sm" variant="ghost" icon={<Undo2 />} loading={undo.isPending || actions.busy}
            onClick={() => (item.skip.task_id ? void actions.undoSkip({ taskId: item.skip.task_id }).catch(() => {}) : undo.mutate(item.skip.id))}>Undo</Button>
        </div>
      )}
    </li>
  )
}

/** Overdue / skipped (/ replanned) current-program routines with their two
 *  answers — plan it (or move its open plan) or skip it with a reason (the
 *  shared Move and Skip sheets). Renders nothing when there is nothing to say. */
export function MissedSessionsList({ items, today, className }: { items: readonly RoutineAttention[]; today: string; className?: string }) {
  const { data: openTasks = [] } = useOpenTrainingSessionTasks()
  if (items.length === 0) return null
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <Label />
      <ul className="flex flex-col gap-2">
        {items.map(a => <Row key={a.routineId} item={a} today={today} openTasks={openTasks} />)}
      </ul>
    </div>
  )
}

/** The Next tab's version: its own card, overdue and skipped only (a
 *  replanned session already shows up as the next planned one). */
export function MissedSessionsCard() {
  const { items, today } = useMissedSessions()
  const shown = items.filter(a => a.kind !== 'replanned')
  if (shown.length === 0) return null
  return (
    <Card className="max-w-2xl">
      <MissedSessionsList items={shown} today={today} />
    </Card>
  )
}
