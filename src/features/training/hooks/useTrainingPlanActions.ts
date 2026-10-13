import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { qk } from '../../../shared/query'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { syncGoogleTasksSoon, useDeleteTask } from '../../todo/hooks/useTodos'
import { useDeleteScheduleBlock, useDeleteTimeBlock } from '../../daily/hooks/useSchedule'
import {
  ensurePlanTask, markPlanDone, planTaskId, movePlan, reopenPlan,
  skipPlan, undoPlanSkip,
  type PlanTarget, type TrainingPlanRef,
} from '../api/trainingPlanApi'

export type { TrainingPlanRef }

// Every action re-reads the task graph (tasks, schedule, calendar) and the
// skips, so the popup, the task row, Daily, Home and Training all show the
// change at once.
const INVALIDATES = ['taskGraph', qk.training.skipsAll] as const

/** Google Tasks follows the task's change in the background (the action is done and reported first). */
function deliverGoogleTasks(taskId: string) {
  syncGoogleTasksSoon({ taskId })
}

function taskIdOf(target: PlanTarget): string | null {
  return target.kind === 'task' ? target.taskId : null
}

/**
 * THE actions of a planned training session (owner, 12.10.2026: one action,
 * one hook, the same everywhere). A day of a weekly plan, or an older block
 * with no task, gets its task first (ensurePlanTask), so every action works
 * on the same thing. Delete asks first and offers Undo (the owner's rule for
 * every delete).
 */
export function useTrainingPlanActions() {
  const done = useMutationWithFeedback({
    action: 'training_plan_done',
    successMessage: 'Marked done',
    mutationFn: async (p: TrainingPlanRef) => {
      const taskId = await planTaskId(p.target, p.info)
      await markPlanDone(taskId)
      deliverGoogleTasks(taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const reopen = useMutationWithFeedback({
    action: 'training_plan_reopen',
    successMessage: 'Reopened',
    mutationFn: async (p: TrainingPlanRef) => {
      const taskId = taskIdOf(p.target)
      if (!taskId) return
      await reopenPlan(taskId)
      deliverGoogleTasks(taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const move = useMutationWithFeedback({
    action: 'training_plan_move',
    successMessage: (_: void, v: { plan: TrainingPlanRef; date: string }) => `Moved to ${formatWeekdayDate(v.date)}`,
    mutationFn: async ({ plan, date, startHHMM }: { plan: TrainingPlanRef; date: string; startHHMM: string | null }) => {
      const rows = await ensurePlanTask(plan.target, plan.info)
      await movePlan(rows, plan.info, { date, startHHMM })
      deliverGoogleTasks(rows.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const skip = useMutationWithFeedback({
    action: 'training_plan_skip',
    successMessage: 'Skipped',
    mutationFn: async ({ plan, reason }: { plan: TrainingPlanRef; reason: string }) => {
      const rows = await ensurePlanTask(plan.target, plan.info)
      await skipPlan(rows, { routineId: plan.info.routineId, planDate: plan.info.date, reason })
      deliverGoogleTasks(rows.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const undoSkip = useMutationWithFeedback({
    action: 'training_plan_undo_skip',
    successMessage: 'Skip undone',
    mutationFn: async (s: { taskId?: string | null; skipId?: string | null }) => {
      await undoPlanSkip(s)
      if (s.taskId) deliverGoogleTasks(s.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const removeTask = useDeleteTask()
  const removeBlock = useDeleteTimeBlock()
  const removeWeekly = useDeleteScheduleBlock()

  /** Asks, deletes a repeating plan (every day it repeats on), then offers Undo. */
  async function deleteWeekly(templateId: string, title: string): Promise<boolean> {
    const result = await removeWeekly.run([templateId], {
      title: `Delete the repeating plan “${title}”?`,
      message: 'Every day it repeats on leaves the calendar, past and future. Days already moved, skipped or done on their own stay, and logged workouts stay.',
      done: 'Repeating plan deleted',
    })
    return result === 'deleted' || result === 'gone'
  }

  /** Asks, deletes the session (its task takes the slot and the skip with it), then offers Undo.
   *  Resolves true when it was deleted. */
  async function deleteSession(p: TrainingPlanRef): Promise<boolean> {
    const question = {
      title: `Delete “${p.info.title}”?`,
      message: `The session on ${formatWeekdayDate(p.info.date)} leaves your tasks and your calendar. Logged workouts stay.`,
      done: 'Session deleted',
    }
    const result = p.target.kind === 'task' ? await removeTask.run([p.target.taskId], question)
      : p.target.kind === 'block' ? await removeBlock.run([p.target.blockId], question)
      : 'kept'   // a weekly day has nothing of its own to delete
    return result === 'deleted' || result === 'gone'
  }

  return {
    markDone: (p: TrainingPlanRef) => done.mutateAsync(p),
    reopen: (p: TrainingPlanRef) => reopen.mutateAsync(p),
    move: (plan: TrainingPlanRef, date: string, startHHMM: string | null) => move.mutateAsync({ plan, date, startHHMM }),
    skip: (plan: TrainingPlanRef, reason: string) => skip.mutateAsync({ plan, reason }),
    undoSkip: (s: { taskId?: string | null; skipId?: string | null }) => undoSkip.mutateAsync(s),
    deleteSession,
    deleteWeekly,
    /** Opens the move sheet (date + time). */
    openMove: (plan: TrainingPlanRef) => entityModal.open({ kind: 'training-plan-move', plan }),
    /** Opens the skip sheet (a reason is required; it offers Move instead). */
    openSkip: (plan: TrainingPlanRef) => entityModal.open({ kind: 'training-plan-skip', plan }),
    busy: done.isPending || reopen.isPending || move.isPending || skip.isPending || undoSkip.isPending || removeTask.busy || removeBlock.busy || removeWeekly.busy,
  }
}
