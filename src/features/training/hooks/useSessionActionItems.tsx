import type { ReactNode } from 'react'
import { CalendarClock, CalendarCog, Check, Pencil, RotateCcw, SkipForward, Trash2, Undo2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { useTrainingPlanActions } from './useTrainingPlanActions'
import { sessionActions, type SessionAction, type SessionStatus } from '../plan/sessionState'
import type { TrainingPlanRef } from '../api/trainingPlanApi'

export interface SessionActionItem {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
}

/** One extra menu entry a view adds (e.g. "Plan this routine again…"). */
export type ExtraAction = Omit<SessionActionItem, 'key'>

/** The actions a bar shows as buttons; the rest go behind ⋯. */
const PRIMARY: ReadonlySet<SessionAction> = new Set(['done', 'move', 'skip', 'reopen', 'undoSkip'])

/**
 * THE action list of one planned training session — every view (the session
 * popup, the task row, Daily's agenda, Training → Next) gets the same entries
 * with the same effects from here (owner, 12.10.2026). `weekly`: the plan is
 * a day of a weekly plan nobody acted on yet (its own entries change or
 * delete the whole weekly plan). `skipId`: a skip of the routine's week that
 * covers a plan with no task.
 */
export function useSessionActionItems(input: {
  /** null: no planned session shown (the list is empty). */
  plan: TrainingPlanRef | null
  status: SessionStatus | null
  weekly?: { templateId: string } | null
  skipId?: string | null
  onGone?: () => void
}): { primary: SessionActionItem[]; more: SessionActionItem[]; busy: boolean } {
  const { plan, status, weekly, skipId, onGone } = input
  const modal = useEntityModal()
  const a = useTrainingPlanActions()
  if (!plan || !status) return { primary: [], more: [], busy: a.busy }
  const target = plan.target
  const hasTask = target.kind === 'task'
  const keys = sessionActions(status, { hasTask, weekly: !!weekly })

  const item = (k: SessionAction): SessionActionItem | null => {
    switch (k) {
      case 'done':     return { key: k, label: 'Mark done', icon: <Check />, onSelect: () => { void a.markDone(plan).catch(() => {}) } }
      case 'move':     return { key: k, label: target.kind === 'task' && !target.blockId ? 'Set a time…' : 'Move…', icon: <CalendarClock />, onSelect: () => a.openMove(plan) }
      case 'skip':     return { key: k, label: 'Skip…', icon: <SkipForward />, onSelect: () => a.openSkip(plan) }
      case 'reopen':   return { key: k, label: 'Reopen', icon: <RotateCcw />, onSelect: () => { void a.reopen(plan).catch(() => {}) } }
      case 'undoSkip': return { key: k, label: 'Undo skip', icon: <Undo2 />, onSelect: () => { void a.undoSkip({ taskId: hasTask ? target.taskId : null, skipId }).catch(() => {}) } }
      case 'edit':
        if (target.kind === 'task') return { key: k, label: 'Edit session…', icon: <Pencil />, onSelect: () => modal.open({ kind: 'task', id: target.taskId }) }
        if (target.kind === 'block') return { key: k, label: 'Edit plan…', icon: <Pencil />, onSelect: () => modal.open({ kind: 'time-block', id: target.blockId, config: { heading: 'Change plan' } }) }
        return null
      case 'delete':   return { key: k, label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => { void a.deleteSession(plan).then(ok => { if (ok) onGone?.() }) } }
    }
  }

  const items = keys.map(item).filter((x): x is SessionActionItem => x !== null)
  const more = items.filter(i => !PRIMARY.has(i.key as SessionAction))
  if (weekly) {
    more.push(
      { key: 'editWeekly', label: 'Change weekly plan…', icon: <CalendarCog />, onSelect: () => modal.open({ kind: 'schedule-block', id: weekly.templateId, config: { heading: 'Change weekly plan' } }) },
      { key: 'deleteWeekly', label: 'Delete weekly plan', icon: <Trash2 />, danger: true, onSelect: () => { void a.deleteWeekly(weekly.templateId, plan.info.title).then(ok => { if (ok) onGone?.() }) } },
    )
  }
  return { primary: items.filter(i => PRIMARY.has(i.key as SessionAction)), more, busy: a.busy }
}
