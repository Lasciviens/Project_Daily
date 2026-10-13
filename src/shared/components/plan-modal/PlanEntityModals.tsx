// ─────────────────────────────────────────────────────────────────────────────
//  Entity-modal adapters for UnifiedPlanModal (THEME.md §9).
//
//  Opened through useEntityModal().open({ kind: 'task' | 'time-block' |
//  'schedule-block' | 'plan-block', … }) and rendered by the one ModalHost.
//  Each adapter loads its row BY ID through the feature hooks (never a row
//  handed over by a list), shows the editor's own shell as a skeleton while
//  loading, then renders UnifiedPlanModal. A create request (no id) renders
//  immediately.
//
//  THE routing rule for one-off blocks lives here, once (docs/features/planning-calendar.md, "Task and
//  schedule model"): a block with a task_id is ALWAYS edited as its task
//  (mode 'task'), never through `timeBlock` — opening a task-linked block as
//  a standalone block is exactly how a second task used to get minted.
// ─────────────────────────────────────────────────────────────────────────────

import type { UseQueryResult } from '@tanstack/react-query'
import { UnifiedPlanModal } from './UnifiedPlanModal'
import { useTaskById } from '../../../features/todo/hooks/useTodos'
import { useTimeBlock, useScheduleBlock } from '../../../features/daily/hooks/useSchedule'
import type { EntityModalProps } from '../../modals/types'
import type { PlanModalConfig, PlanResult } from './planModal.types'
import { useFirstLoaded } from '../../modals/useFirstLoaded'
import { isTrainingTask } from '../../../features/todo/taskRules'
import type { Task } from '../../../features/todo/types'
import type { ScheduleBlock } from '../../../features/daily/types'
import { useTrainingPlanActions } from '../../../features/training/hooks/useTrainingPlanActions'
import { todayStr } from '../../utils/dateUtils'

/** A training session's Delete is the session's own (asks, deletes task +
 *  block + skip, offers Undo) from every editor, as from the popup and the
 *  task row (owner: every delete asks and offers Undo). */
function useTrainingDelete(task: Task | undefined, template: ScheduleBlock | undefined) {
  const actions = useTrainingPlanActions()
  if (task && isTrainingTask(task)) {
    return () => actions.deleteSession({
      target: { kind: 'task', taskId: task.id, blockId: null },
      info: { title: task.title, date: task.due_date ?? todayStr(), startHHMM: task.due_time?.slice(0, 5) ?? null, minutes: null, routineId: task.hevy_routine_id ?? null },
    })
  }
  if (template?.category === 'training') return () => actions.deleteWeekly(template.id, template.title)
  return undefined
}

/**
 * A training session's task edits the same way from every entry point
 * (owner, 12.10.2026): its day and time are the session's (migration 142
 * keeps the task and its block together), so the editor shows one day — the
 * schedule's — instead of a separate deadline that would only be overwritten.
 */
function taskEditorConfig(task: Task | undefined, config: PlanModalConfig | undefined): PlanModalConfig | undefined {
  if (!task || !isTrainingTask(task)) return config
  return {
    ...config,
    heading: config?.heading ?? 'Edit session',
    hideTaskFields: [...new Set([...(config?.hideTaskFields ?? []), 'startDate', 'dueDate', 'dueTime', 'section'] as const)],
  }
}

type LoadState = { loading?: boolean; loadError?: { message: string; onRetry?: () => void } }

function loadStateOf(query: UseQueryResult<unknown>, loaded: boolean, what: string): LoadState {
  if (loaded) return {}
  if (query.isFetching) return { loading: true }
  if (query.isError) return { loadError: { message: `Couldn't load this ${what}.`, onRetry: () => { void query.refetch() } } }
  if (query.isSuccess) return { loadError: { message: `This ${what} no longer exists.` } }
  return { loading: true }
}

export function TaskEntityModal({ request, onClose }: EntityModalProps<'task'>) {
  const { id, defaults, config, source, onSaved } = request
  const query = useTaskById(id)
  const task = useFirstLoaded(query.data, query)
  const load = id ? loadStateOf(query, !!task, 'task') : {}
  const trainingDelete = useTrainingDelete(task, undefined)
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="task" task={task}
      config={taskEditorConfig(task, config)} defaults={defaults} source={source} onSaved={onSaved}
      onDeleteOverride={trainingDelete}
      {...load}
    />
  )
}

/**
 * Edit a one-off block by id, routed by the rule above. `passThrough` carries
 * the caller's shaping only when the block really is edited as a block.
 */
function BlockEditor({ blockId, onClose, passThrough }: {
  blockId: string
  onClose: () => void
  passThrough?: Omit<EntityModalProps<'time-block'>['request'], 'kind' | 'id'>
}) {
  const blockQuery = useTimeBlock(blockId)
  const block = useFirstLoaded(blockQuery.data, blockQuery)
  const taskQuery = useTaskById(block?.task_id)
  const task = useFirstLoaded(taskQuery.data, taskQuery)
  const onSaved: ((r: PlanResult) => void) | undefined = passThrough?.onSaved
  const trainingDelete = useTrainingDelete(task, undefined)

  if (!block) {
    return <UnifiedPlanModal open onClose={onClose} mode="schedule" {...loadStateOf(blockQuery, false, 'schedule')} />
  }
  if (block.task_id) {
    return (
      <UnifiedPlanModal
        open onClose={onClose} mode="task" task={task} onSaved={onSaved}
        config={taskEditorConfig(task, undefined)} onDeleteOverride={trainingDelete}
        {...loadStateOf(taskQuery, !!task, 'task')}
      />
    )
  }
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="schedule" timeBlock={block}
      config={passThrough?.config} defaults={passThrough?.defaults} source={passThrough?.source} onSaved={onSaved}
    />
  )
}

export function TimeBlockEntityModal({ request, onClose }: EntityModalProps<'time-block'>) {
  const { id, defaults, config, source, onSaved } = request
  if (id) return <BlockEditor blockId={id} onClose={onClose} passThrough={{ defaults, config, source, onSaved }} />
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="schedule"
      config={config} defaults={defaults} source={source} onSaved={onSaved}
    />
  )
}

export function PlanBlockEntityModal({ request, onClose }: EntityModalProps<'plan-block'>) {
  return <BlockEditor blockId={request.blockId} onClose={onClose} />
}

export function ScheduleBlockEntityModal({ request, onClose }: EntityModalProps<'schedule-block'>) {
  const { id, defaults, config, source, onSaved } = request
  const query = useScheduleBlock(id)
  const scheduleBlock = useFirstLoaded(query.data, query)
  const load = id ? loadStateOf(query, !!scheduleBlock, 'repeating schedule') : {}
  const trainingDelete = useTrainingDelete(undefined, scheduleBlock)
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="recurring" scheduleBlock={scheduleBlock}
      config={config} defaults={defaults} source={source} onSaved={onSaved}
      onDeleteOverride={trainingDelete}
      {...load}
    />
  )
}
