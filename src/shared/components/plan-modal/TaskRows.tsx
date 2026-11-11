// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's task rows (step 3 of docs/features/item-screen-plan.md):
//  Waiting for and Parent, in Planning, on an edit of a task (not a repeat's
//  rule). They were their own sheets and a chip's inline field; each still
//  saves through its own one action, at once and with its own message — the
//  status through useTaskActions().setStatus (Work's columns and cards use
//  the same), the parent through ParentPicker's useSetParentTask (Google's
//  one-level rule lives there). They read the task live: the screen's own
//  copy is frozen when it opens, and these fields change outside its save.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { Truncate } from '../../ui'
import { useSubtasks, useTaskById } from '../../../features/todo/hooks/useTodos'
import { useTaskActions } from '../../../features/todo/hooks/useTaskActions'
import { ParentPicker } from '../../../features/todo/components/ParentPicker'
import { isOpenTask, isTrainingTask } from '../../../features/todo/taskRules'
import { Panel, TapRow } from './ItemRows'
import { chipClass } from './fieldStyles'
import type { PanelKey } from './TimeSection'

interface Opened {
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
}

/** Waiting for: an open task waits for someone or something (status 'waiting' + waiting_for), or doesn't. Not for a
 *  training session (its status is the session's) or a closed task. */
export function WaitingRow({ taskId, open, toggle, mark }: Opened & { taskId: string; mark?: ReactNode }) {
  const { data: task } = useTaskById(taskId)
  const act = useTaskActions()
  const [text, setText] = useState<string | null>(null)
  if (!task || isTrainingTask(task) || !isOpenTask(task)) return null
  const waiting = task.status === 'waiting'
  const shown = text ?? task.waiting_for ?? ''
  const commit = (on: boolean) => {
    const waitingFor = on ? shown.trim() : undefined
    void act.setStatus(task, on ? 'waiting' : 'open', on ? { waitingFor } : undefined).then(() => { setText(null); toggle(null) })
  }
  return (
    <>
      <TapRow label="Waiting for" mark={mark} open={open === 'waiting'} onClick={() => toggle('waiting')}
        value={waiting ? <Truncate className="min-w-0">{task.waiting_for || 'Waiting'}</Truncate> : 'No'} />
      {open === 'waiting' && (
        <Panel label="Waiting for">
          <div className="flex flex-col gap-2">
            <input
              autoFocus value={shown} onChange={e => setText(e.target.value)} placeholder="Who or what? (optional)" aria-label="Waiting for"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(true) } }} maxLength={200}
              className="input-bare w-full border-b border-line py-1.5 text-lead"
            />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => commit(true)} disabled={act.busy} className={chipClass('set')}>
                {waiting ? 'Save' : 'Waiting'}
              </button>
              {waiting && (
                <button type="button" onClick={() => commit(false)} disabled={act.busy} className={chipClass('remove')}>Not waiting</button>
              )}
            </div>
          </div>
        </Panel>
      )}
    </>
  )
}

/** Parent: the task this one is a subtask of (one level, as Google Tasks allows), picked from the open tasks. */
export function ParentRow({ taskId, open, toggle, mark }: Opened & { taskId: string; mark?: ReactNode }) {
  const { data: task } = useTaskById(taskId)
  const { data: parent } = useTaskById(task?.parent_task_id)
  const { data: subtasks = [] } = useSubtasks(taskId)
  const [query, setQuery] = useState('')
  if (!task) return null
  const value = task.parent_task_id ? <Truncate className="min-w-0">{parent?.title ?? '…'}</Truncate> : 'None'
  return (
    <>
      <TapRow label="Parent" mark={mark} value={value} open={open === 'parent'} onClick={() => toggle('parent')} />
      {open === 'parent' && (
        <Panel label="Parent task">
          <ParentPicker task={task} hasSubtasks={subtasks.length > 0} query={query} onQuery={setQuery} onClose={() => toggle(null)} className="" />
        </Panel>
      )}
    </>
  )
}
