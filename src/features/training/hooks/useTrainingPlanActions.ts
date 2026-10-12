import { useCalendarStore, toast } from '../../../app/store'
import { useMutationWithFeedback, withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { qk } from '../../../shared/query'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { drainBestEffort } from '../../todo/hooks/useTodos'
import {
  deletePlan, deleteWeeklyPlan, ensurePlanTask, markPlanDone, planTaskId, movePlan, reopenPlan, restorePlan, restoreWeeklyPlan,
  skipPlan, snapshotPlan, snapshotWeeklyPlan, undoPlanSkip,
  type PlanTarget, type TrainingPlanRef,
} from '../api/trainingPlanApi'

export type { TrainingPlanRef }

// Every action re-reads the task graph (tasks, schedule, calendar) and the
// skips, so the popup, the task row, Daily, Home and Training all show the
// change at once.
const INVALIDATES = ['taskGraph', qk.training.skipsAll] as const

/** Google Tasks follows the task's change now rather than on the next sync. */
async function deliverGoogleTasks(taskId: string) {
  const token = useCalendarStore.getState().accessToken
  if (token) await drainBestEffort(token, { taskId })
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
      await deliverGoogleTasks(taskId)
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
      await deliverGoogleTasks(taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const move = useMutationWithFeedback({
    action: 'training_plan_move',
    successMessage: (_: void, v: { plan: TrainingPlanRef; date: string }) => `Moved to ${formatWeekdayDate(v.date)}`,
    mutationFn: async ({ plan, date, startHHMM }: { plan: TrainingPlanRef; date: string; startHHMM: string | null }) => {
      const rows = await ensurePlanTask(plan.target, plan.info)
      await movePlan(rows, plan.info, { date, startHHMM })
      await deliverGoogleTasks(rows.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const skip = useMutationWithFeedback({
    action: 'training_plan_skip',
    successMessage: 'Skipped',
    mutationFn: async ({ plan, reason }: { plan: TrainingPlanRef; reason: string }) => {
      const rows = await ensurePlanTask(plan.target, plan.info)
      await skipPlan(rows, { routineId: plan.info.routineId, planDate: plan.info.date, reason })
      await deliverGoogleTasks(rows.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const undoSkip = useMutationWithFeedback({
    action: 'training_plan_undo_skip',
    successMessage: 'Skip undone',
    mutationFn: async (s: { taskId?: string | null; skipId?: string | null }) => {
      await undoPlanSkip(s)
      if (s.taskId) await deliverGoogleTasks(s.taskId)
    },
    invalidates: [...INVALIDATES],
  })

  const restore = useMutationWithFeedback({
    action: 'training_plan_restore',
    successMessage: 'Restored',
    mutationFn: async (snapshot: Awaited<ReturnType<typeof snapshotPlan>>) => {
      const { calendar } = await restorePlan(snapshot)
      if (snapshot.task?.google_sync_enabled) await deliverGoogleTasks(snapshot.task.id)
      // It was on Google Calendar and couldn't be put back right now (no
      // Google sign-in on this device, or Google didn't answer).
      if (calendar === 'unknown' || calendar === 'not_linked') {
        toast.warning('Restored — but not back on Google Calendar. Open the session, Edit, and save it to add it again.')
      }
    },
    invalidates: [...INVALIDATES],
  })

  const remove = useMutationWithFeedback({
    action: 'training_plan_delete',
    mutationFn: async (snapshot: Awaited<ReturnType<typeof snapshotPlan>>) => {
      await deletePlan(snapshot)
      if (snapshot.task) await deliverGoogleTasks(snapshot.task.id)
    },
    invalidates: [...INVALIDATES],
  })

  const removeWeekly = useMutationWithFeedback({
    action: 'training_weekly_plan_delete',
    mutationFn: (templateId: string) => deleteWeeklyPlan(templateId),
    invalidates: ['schedule'],
  })
  const restoreWeekly = useMutationWithFeedback({
    action: 'training_weekly_plan_restore',
    successMessage: 'Restored',
    mutationFn: (row: Record<string, unknown>) => restoreWeeklyPlan(row),
    invalidates: ['schedule'],
  })

  /** Asks, deletes a weekly plan (every day it repeats on), then offers Undo. */
  async function deleteWeekly(templateId: string, title: string): Promise<boolean> {
    const ok = await entityModal.confirm({
      title: `Delete the weekly plan “${title}”?`,
      message: 'Every day it repeats on leaves the calendar, past and future. Days already moved, skipped or done on their own stay, and logged workouts stay.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return false
    let row: Record<string, unknown>
    try {
      row = await snapshotWeeklyPlan(templateId)
    } catch (err) {
      toast.error(`Couldn't delete: ${(err as Error).message}`)
      return false
    }
    const deleted = await withProgress(async () => { await removeWeekly.mutateAsync(templateId); return true }, { loading: 'Deleting…' })
    if (!deleted) return false
    toast.undo('Weekly plan deleted', () => { restoreWeekly.mutate(row) })
    return true
  }

  /** Asks, deletes the session (task + block + skip), then offers Undo.
   *  Resolves true when it was deleted. */
  async function deleteSession(p: TrainingPlanRef): Promise<boolean> {
    const rows = p.target.kind === 'task' ? { taskId: p.target.taskId, blockId: p.target.blockId }
      : p.target.kind === 'block' ? { taskId: null, blockId: p.target.blockId } : null
    if (!rows) return false   // a weekly day has nothing of its own to delete
    const ok = await entityModal.confirm({
      title: `Delete “${p.info.title}”?`,
      message: `The session on ${formatWeekdayDate(p.info.date)} leaves your tasks and your calendar. Logged workouts stay.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return false
    let snapshot: Awaited<ReturnType<typeof snapshotPlan>>
    try {
      snapshot = await snapshotPlan(rows)
    } catch (err) {
      // Without a copy there is no Undo, so nothing is deleted.
      toast.error(`Couldn't delete: ${(err as Error).message}`)
      return false
    }
    const deleted = await withProgress(async () => { await remove.mutateAsync(snapshot); return true }, { loading: 'Deleting…' })
    if (!deleted) return false
    toast.undo('Session deleted', () => { restore.mutate(snapshot) })
    return true
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
    busy: done.isPending || reopen.isPending || move.isPending || skip.isPending || undoSkip.isPending || remove.isPending || restore.isPending,
  }
}
