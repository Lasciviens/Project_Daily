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
//  THE routing rule for one-off blocks lives here, once (CLAUDE.md "Task ↔
//  Schedule model"): a block with a task_id is ALWAYS edited as its task
//  (mode 'task'), never through `timeBlock` — opening a task-linked block as
//  a standalone block is exactly how a second task used to get minted.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { UnifiedPlanModal } from './UnifiedPlanModal'
import { useTaskById } from '../../../features/todo/hooks/useTodos'
import { useTimeBlock, useScheduleBlock } from '../../../features/daily/hooks/useSchedule'
import type { EntityModalProps } from '../../modals/types'
import type { PlanResult } from './planModal.types'

/**
 * The first loaded value, frozen for the popup's lifetime: a background
 * refetch (window focus, a save elsewhere) must never re-seed the form under
 * the user's fingers. The editor re-reads on its next open anyway.
 */
function useFirstLoaded<T>(value: T | null | undefined): T | undefined {
  const [snap, setSnap] = useState<T | undefined>(undefined)
  if (snap === undefined && value != null) {
    setSnap(value)
    return value
  }
  return snap
}

type LoadState = { loading?: boolean; loadError?: { message: string; onRetry?: () => void } }

function loadStateOf(query: UseQueryResult<unknown>, loaded: boolean, what: string): LoadState {
  if (loaded) return {}
  if (query.isError) return { loadError: { message: `Couldn't load this ${what}.`, onRetry: () => { void query.refetch() } } }
  if (query.isSuccess) return { loadError: { message: `This ${what} no longer exists.` } }
  return { loading: true }
}

export function TaskEntityModal({ request, onClose }: EntityModalProps<'task'>) {
  const { id, defaults, config, source, onSaved } = request
  const query = useTaskById(id)
  const task = useFirstLoaded(query.data)
  const load = id ? loadStateOf(query, !!task, 'task') : {}
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="task" task={task}
      config={config} defaults={defaults} source={source} onSaved={onSaved}
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
  const block = useFirstLoaded(blockQuery.data)
  const taskQuery = useTaskById(block?.task_id)
  const task = useFirstLoaded(taskQuery.data)
  const onSaved: ((r: PlanResult) => void) | undefined = passThrough?.onSaved

  if (!block) {
    return <UnifiedPlanModal open onClose={onClose} mode="schedule" {...loadStateOf(blockQuery, false, 'schedule')} />
  }
  if (block.task_id) {
    return (
      <UnifiedPlanModal
        open onClose={onClose} mode="task" task={task} onSaved={onSaved}
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
  const scheduleBlock = useFirstLoaded(query.data)
  const load = id ? loadStateOf(query, !!scheduleBlock, 'repeating schedule') : {}
  return (
    <UnifiedPlanModal
      open onClose={onClose} mode="recurring" scheduleBlock={scheduleBlock}
      config={config} defaults={defaults} source={source} onSaved={onSaved}
      {...load}
    />
  )
}
