import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRightLeft, Check, MoreHorizontal, Trash2 } from 'lucide-react'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useTaskActions } from '../../todo/hooks/useTaskActions'
import { dueLabel, isClosedTask, isOpenTask } from '../../todo/taskRules'
import type { Task } from '../../todo/types'
import { useMoveProjectTask } from '../hooks/useProjects'
import { DOTTED } from './peekStyle'
import type { ProjectPhase } from '../types'

/**
 * One task of a project. It IS a task (the one task table): the tick, the
 * editor (a day, a time, Google) and Delete are every page's own task
 * actions, so a project task planned for today shows on Daily, and a tick
 * there shows here. When it was closed waits behind a tap on its title.
 */
export function ProjectTaskRow({ task, phases }: { task: Task; phases: ProjectPhase[] }) {
  const act = useTaskActions()
  const move = useMoveProjectTask()
  const done = task.status === 'done'
  const closed = isClosedTask(task)
  // Today's and late ones say so in the row; a later day opens with the task.
  const due = isOpenTask(task) ? dueLabel(task) : null
  const urgentDue = due?.urgent ? due : null
  const others = phases.filter(p => p.id !== task.project_phase_id)

  return (
    <li className="group/row flex min-h-[40px] items-center gap-2 rounded-row px-1.5 hover:bg-surface-hover">
      <button
        type="button"
        onClick={() => { void act.setDone(task, !done) }}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        className="icon-btn h-8 w-8 shrink-0"
      >
        <span aria-hidden className={cx('grid h-[18px] w-[18px] place-items-center rounded-md border-2 transition-colors',
          done ? 'border-success bg-success text-white' : task.status === 'cancelled' ? 'border-line bg-surface-2' : 'border-line-strong')}>
          {done && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        {closed && task.completed_at ? (
          <HoverPeek
            trigger={<Truncate lines={2}>{task.title}</Truncate>}
            className={cx(DOTTED, 'min-w-0 text-body', done ? 'text-fg-faint line-through' : 'text-fg-muted line-through')}
            panelClassName="w-auto"
          >
            {done ? 'Done' : 'Cancelled'} {formatDate(task.completed_at)}
          </HoverPeek>
        ) : (
          <button type="button" onClick={() => act.open(task)} className="min-w-0 text-left text-body text-fg hover:underline">
            <Truncate lines={2}>{task.title}</Truncate>
          </button>
        )}
        {urgentDue && <span className="shrink-0 text-meta tabular-nums text-danger">{urgentDue.text}</span>}
      </div>
      <Menu as="div" className="shrink-0">
        <MenuButton className="icon-btn h-8 w-8 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 data-[open]:opacity-100"
          aria-label={`More for ${task.title}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </MenuButton>
        <MenuItems anchor="bottom end" transition className="menu w-52 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
          <MenuItem>
            <button type="button" className="menu-item" onClick={() => act.open(task)}>Open task</button>
          </MenuItem>
          {others.length > 0 && <div className="menu-sep" />}
          {others.length > 0 && <p className="menu-label">Move to</p>}
          {others.map(p => (
            <MenuItem key={p.id}>
              <button type="button" className="menu-item" onClick={() => move.mutate({ id: task.id, phaseId: p.id, phaseName: p.name })}>
                <ArrowRightLeft aria-hidden className="h-4 w-4 shrink-0" /> <Truncate className="min-w-0">{p.name}</Truncate>
              </button>
            </MenuItem>
          ))}
          <div className="menu-sep" />
          <MenuItem>
            <button type="button" className="menu-item is-danger" onClick={() => { void act.remove(task) }}>
              <Trash2 aria-hidden className="h-4 w-4" /> Delete
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </li>
  )
}
