import { Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, Check, ChevronDown, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { useEntityModal } from '../../../shared/modals'
import { cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { Task } from '../../todo/types'
import { useDeletePhase, useMovePhase, useUpdatePhase } from '../hooks/useProjects'
import { nextSortOrder, swapWith } from '../projectModel'
import { AddTaskInline } from './AddTaskInline'
import { ProjectTaskRow } from './ProjectTaskRow'
import { DOTTED } from './peekStyle'
import type { ProjectArea, ProjectPhase } from '../types'

/**
 * One phase: its name and how many of its tasks are done; open, its finish
 * line ("Done when"), its tasks and "Add a task". The current phase opens by
 * itself; the others wait for a tap (details on demand).
 */
export function PhaseCard({ phase, index, tasks, phases, current, area, focusAdd }: {
  phase: ProjectPhase
  index: number
  tasks: Task[]
  phases: ProjectPhase[]
  current: boolean
  area: ProjectArea
  /** Opens with the add box focused (the header's "Task" button). */
  focusAdd?: boolean
}) {
  const modal = useEntityModal()
  const update = useUpdatePhase()
  const move = useMovePhase()
  const del = useDeletePhase()
  const done = phase.status === 'done'
  const counted = tasks.filter(t => t.status !== 'cancelled')
  const doneCount = counted.filter(t => t.status === 'done').length
  const dateText = phase.done_at ? `Done ${formatDate(phase.done_at)}` : phase.target_on ? `Target ${formatDate(phase.target_on)}` : null
  const up = swapWith(phases, phase.id, -1)
  const down = swapWith(phases, phase.id, 1)

  return (
    <Disclosure as="section" defaultOpen={current || !!focusAdd}
      className={cx('rounded-card border', current ? 'border-accent-200 bg-accent-50/40' : 'border-line bg-surface')}>
      {({ open }) => (
        <>
          <div className="flex items-center gap-2 py-1.5 pl-2 pr-1">
            <DisclosureButton className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 rounded-row text-left">
              <PhaseMark done={done} current={current} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-ui text-fg">
                  <span className="text-fg-muted tabular-nums">{index + 1} · </span>{phase.name}
                </span>
              </span>
              {counted.length > 0 && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{doneCount}/{counted.length}</span>}
              <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform motion-reduce:transition-none', open ? '' : '-rotate-90')} />
            </DisclosureButton>
            <Menu as="div" className="shrink-0">
              <MenuButton className="icon-btn h-9 w-9" aria-label={`More for ${phase.name}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </MenuButton>
              <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
                <MenuItem>
                  <button type="button" className="menu-item" onClick={() => modal.open({ kind: 'project-phase', projectId: phase.project_id, id: phase.id })}>
                    <Pencil aria-hidden className="h-4 w-4" /> Edit phase
                  </button>
                </MenuItem>
                <MenuItem>
                  <button type="button" className="menu-item"
                    onClick={() => update.mutate({ id: phase.id, patch: { status: done ? 'in_progress' : 'done' } })}>
                    {done ? <RotateCcw aria-hidden className="h-4 w-4" /> : <Check aria-hidden className="h-4 w-4" />} {done ? 'Reopen' : 'Mark done'}
                  </button>
                </MenuItem>
                {up && (
                  <MenuItem>
                    <button type="button" className="menu-item" onClick={() => move.mutate({ a: up[0], b: up[1] })}>
                      <ArrowUp aria-hidden className="h-4 w-4" /> Move up
                    </button>
                  </MenuItem>
                )}
                {down && (
                  <MenuItem>
                    <button type="button" className="menu-item" onClick={() => move.mutate({ a: down[0], b: down[1] })}>
                      <ArrowDown aria-hidden className="h-4 w-4" /> Move down
                    </button>
                  </MenuItem>
                )}
                <div className="menu-sep" />
                <MenuItem>
                  <button type="button" className="menu-item is-danger" onClick={() => {
                    void del.run([phase.id], {
                      title: `Delete ${phase.name}?`, message: 'Its tasks stay in the project, with no phase.', done: `${phase.name} deleted`,
                    })
                  }}>
                    <Trash2 aria-hidden className="h-4 w-4" /> Delete phase
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </div>
          <DisclosurePanel className="flex flex-col gap-1 border-t border-line px-2 pb-2 pt-1.5">
            {phase.done_when ? (
              <HoverPeek trigger="Done when" className={cx(DOTTED, 'self-start px-1.5 pb-1 text-meta text-fg-muted')} panelClassName="w-72">
                <p>{phase.done_when}</p>
                {dateText && <p className="mt-1 text-fg-muted">{dateText}</p>}
              </HoverPeek>
            ) : dateText && <p className="px-1.5 pb-1 text-meta text-fg-muted">{dateText}</p>}
            {tasks.length > 0 && <ul className="flex flex-col">{tasks.map(t => <ProjectTaskRow key={t.id} task={t} phases={phases} />)}</ul>}
            <AddTaskInline projectId={phase.project_id} phaseId={phase.id} area={area} nextOrder={nextSortOrder(tasks)} autoFocus={focusAdd} />
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  )
}

function PhaseMark({ done, current }: { done: boolean; current: boolean }) {
  if (done) {
    return (
      <span aria-label="Done" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white">
        <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span aria-label={current ? 'Now' : 'Not done'} className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
      current ? 'border-accent-500' : 'border-line-strong')}>
      {current && <span aria-hidden className="h-2 w-2 rounded-full bg-accent-500" />}
    </span>
  )
}
