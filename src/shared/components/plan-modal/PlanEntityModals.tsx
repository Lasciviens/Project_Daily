// ─────────────────────────────────────────────────────────────────────────────
//  Entity-modal adapters for the Add sheet (UnifiedPlanModal, THEME.md §9).
//
//  One item since migration 155: useEntityModal().open({ kind: 'task' |
//  'time-block' | 'schedule-block' | 'plan-block', … }) all open the SAME
//  sheet — the kinds stay as aliases so every caller keeps working. Each
//  adapter loads the item's rows BY ID through the feature hooks (never a row
//  handed over by a list), shows the sheet's own skeleton while loading, then
//  renders it with every part the item has:
//    task           → the task and its slot (its one-off block, read fresh);
//                     a repeat's day still in its repeat (156: made on its
//                     day, no slot) → that day of its repeat, This day picked
//    time-block id  → the block, and its task when it has one
//    plan-block     → the same, by blockId
//    schedule-block → the repeat (and the day it was opened on, if any)
//  A create request (no id) renders at once.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { UnifiedPlanModal } from './UnifiedPlanModal'
import { useTaskById } from '../../../features/todo/hooks/useTodos'
import { useTimeBlock, useScheduleBlock, linkedTimeBlockQuery } from '../../../features/daily/hooks/useSchedule'
import type { EntityModalProps } from '../../modals/types'
import type { PlanModalConfig, PlanResult } from './planModal.types'
import { isFreshForMount, useFirstLoaded } from '../../modals/useFirstLoaded'
import { isTrainingTask } from '../../../features/todo/taskRules'
import type { Task } from '../../../features/todo/types'
import type { ScheduleBlock, TimeBlock } from '../../../features/daily/types'
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
 * keeps the task and its block together), so the sheet shows one day — the
 * slot's — and no separate deadline that would only be overwritten.
 */
function taskEditorConfig(task: Task | undefined, config: PlanModalConfig | undefined): PlanModalConfig | undefined {
  if (!task || !isTrainingTask(task)) return config
  return {
    ...config,
    heading: config?.heading ?? 'Edit session',
    hideTaskFields: [...new Set([...(config?.hideTaskFields ?? []), 'startDate', 'dueDate', 'dueTime'] as const)],
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

/**
 * A task's slot (its one-off block), read fresh when the sheet opens and then
 * frozen: the sheet decides "update this slot" vs "make one" from it, so it
 * must be the server's answer — null is a real answer ("no slot") here, which
 * useFirstLoaded can't hold.
 */
function useTaskSlot(taskId: string | undefined) {
  const query = useQuery({ ...linkedTimeBlockQuery(taskId ?? ''), enabled: !!taskId })
  const [snap, setSnap] = useState<{ slot: TimeBlock | null } | undefined>(undefined)
  if (taskId && snap === undefined && query.isSuccess && isFreshForMount(query)) setSnap({ slot: query.data ?? null })
  return { query, slot: snap?.slot, settled: snap !== undefined }
}

/**
 * A repeat's day that is a task (156) and still that repeat's day — no slot,
 * on its own day, the day not taken out — is edited as that day of its repeat
 * (This day | All days, This day picked): opened as a plain task, a Repeat
 * added there would make a second repeat. Null for any other task.
 */
function useRepeatDayOf(task: Task | undefined, slot: { slot: TimeBlock | null | undefined; settled: boolean }) {
  const planId = task?.schedule_block_id && task.occurrence_date ? task.schedule_block_id : null
  const planQuery = useScheduleBlock(planId)
  const plan = useFirstLoaded(planQuery.data, planQuery)
  const waiting = !!planId && plan === undefined && !planQuery.isError && !(planQuery.isSuccess && !planQuery.isFetching && planQuery.data == null)
  const day = task?.occurrence_date ?? null
  const isDay = !!plan && !!day && slot.settled && !slot.slot && task?.due_date === day && !(plan.except_dates ?? []).includes(day)
  return { waiting, plan: isDay ? plan : undefined, day: isDay ? day : null }
}

export function TaskEntityModal({ request, onClose }: EntityModalProps<'task'>) {
  const { id, defaults, config, source, onSaved } = request
  const query = useTaskById(id)
  const task = useFirstLoaded(query.data, query)
  const slot = useTaskSlot(task?.id)
  const repeatDay = useRepeatDayOf(task, slot)
  const load = !id ? {} : !task ? loadStateOf(query, false, 'task')
    : repeatDay.waiting ? { loading: true } : loadStateOf(slot.query, slot.settled, 'item')
  const trainingDelete = useTrainingDelete(task, undefined)
  if (repeatDay.plan && repeatDay.day) {
    return (
      <UnifiedPlanModal
        open onClose={onClose} mode="recurring" scheduleBlock={repeatDay.plan} occurrenceDate={repeatDay.day} startScope="day"
        config={taskEditorConfig(task, config)} onSaved={onSaved} onDeleteOverride={trainingDelete}
      />
    )
  }
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="task" task={task} timeBlock={slot.slot}
      config={taskEditorConfig(task, config)} defaults={defaults} source={source} onSaved={onSaved}
      onDeleteOverride={trainingDelete}
      {...load}
    />
  )
}

/**
 * Edit a one-off block by id: the block and, when it belongs to a task, that
 * task — one item. `passThrough` carries the caller's shaping for a block of
 * its own; a task's block opens as that task (the old routing rule, so a
 * caller can never shape a task's sheet as a bare slot).
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
    return <UnifiedPlanModal open onClose={onClose} mode="schedule" {...loadStateOf(blockQuery, false, 'item')} />
  }
  if (block.task_id) {
    return (
      <UnifiedPlanModal
        open onClose={onClose} mode="task" task={task} timeBlock={task ? block : undefined} onSaved={onSaved}
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
  const { id, defaults, config, source, onSaved, occurrenceDate } = request
  const query = useScheduleBlock(id)
  const scheduleBlock = useFirstLoaded(query.data, query)
  const load = id ? loadStateOf(query, !!scheduleBlock, 'repeating item') : {}
  const trainingDelete = useTrainingDelete(undefined, scheduleBlock)
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="recurring" scheduleBlock={scheduleBlock} occurrenceDate={occurrenceDate}
      config={config} defaults={defaults} source={source} onSaved={onSaved}
      onDeleteOverride={trainingDelete}
      {...load}
    />
  )
}
