import type { ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CalendarCog, MoreHorizontal, Trash2 } from 'lucide-react'
import { IconButton } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useDeleteScheduleBlock, useDeleteTimeBlock } from '../../../daily/hooks/useSchedule'
import type { SessionPlanRef } from '../../sessionRef'

export interface MenuPlan {
  ref: SessionPlanRef
  title: string
}

export interface ExtraAction {
  label: string
  icon: ReactNode
  onSelect: () => void
}

/**
 * The deliberate second step for a planned session: change or delete the
 * plan, behind ⋯ — a tap on a session always shows the session, never its
 * schedule form. Editing opens the existing plan editors stacked above
 * (`time-block` by id, which routes a task-linked block to its task — never a
 * `timeBlock` prop, the duplicate-task bug; `schedule-block` for a template).
 */
export function SessionPlanMenu({ plans, extra = [], onDeleted, label = 'Plan actions' }: {
  plans: readonly MenuPlan[]
  extra?: readonly ExtraAction[]
  /** After a plan is deleted (the popup showing only that plan closes). */
  onDeleted?: () => void
  label?: string
}) {
  const modal = useEntityModal()
  const deleteBlock = useDeleteTimeBlock()
  const deleteTemplate = useDeleteScheduleBlock()
  if (plans.length === 0 && extra.length === 0) return null

  const edit = (p: MenuPlan) => {
    if (p.ref.kind === 'recurring') modal.open({ kind: 'schedule-block', id: p.ref.id, config: { heading: 'Change repeating plan' } })
    else modal.open({ kind: 'time-block', id: p.ref.id, config: { heading: 'Change plan' } })
  }

  const remove = async (p: MenuPlan) => {
    const recurring = p.ref.kind === 'recurring'
    const ok = await modal.confirm({
      title: recurring ? `Delete the repeating plan “${p.title}”?` : `Delete the plan “${p.title}”?`,
      message: recurring
        ? 'Every occurrence of this weekly session leaves the calendar, past and future. Logged workouts stay.'
        : 'The session leaves your schedule. A linked task stays in Tasks, and logged workouts stay.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      if (recurring) await deleteTemplate.mutateAsync(p.ref.id)
      else await deleteBlock.mutateAsync({ id: p.ref.id, dateStr: p.ref.date })
    } catch { return }
    onDeleted?.()
  }

  const suffix = (p: MenuPlan) => (plans.length > 1 ? ` · ${p.title}` : '')

  return (
    <Menu as="div" className="shrink-0">
      <MenuButton as={IconButton} label={label}><MoreHorizontal /></MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-64 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {plans.map(p => (
          <MenuItem key={`edit-${p.ref.id}`}>
            <button type="button" onClick={() => edit(p)} className="menu-item">
              <CalendarCog aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{p.ref.kind === 'recurring' ? 'Change repeating plan…' : 'Change plan…'}{suffix(p)}</span>
            </button>
          </MenuItem>
        ))}
        {extra.map(a => (
          <MenuItem key={a.label}>
            <button type="button" onClick={a.onSelect} className="menu-item">
              <span aria-hidden className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{a.icon}</span>
              <span className="truncate">{a.label}</span>
            </button>
          </MenuItem>
        ))}
        {plans.length > 0 && <div className="menu-sep" role="separator" />}
        {plans.map(p => (
          <MenuItem key={`delete-${p.ref.id}`}>
            <button type="button" onClick={() => void remove(p)} className="menu-item is-danger">
              <Trash2 aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{p.ref.kind === 'recurring' ? 'Delete repeating plan' : 'Delete plan'}{suffix(p)}</span>
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}
