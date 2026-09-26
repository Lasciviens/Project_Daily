import type { ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import {
  ArrowDown, ArrowUp, Ban, CornerDownRight, ExternalLink, ListTree, MoreHorizontal, Pencil, RotateCcw, Trash2,
} from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { Task } from '../types'

export interface ToDoItemActionHandlers {
  onEdit:        () => void
  onSetParent:   () => void
  onMoveToList:  () => void
  onCancel:      () => void
  onReopen:      () => void
  onDelete:      () => void
  onMoveUp?:     () => void
  onMoveDown?:   () => void
  canMoveUp?:    boolean
  canMoveDown?:  boolean
  busy:          boolean
}

interface Props extends ToDoItemActionHandlers {
  task: Task
}

// Mobile: ONE 44px ⋯ menu instead of up to five side-by-side icon buttons —
// those held ~136px of a 393px row and starved the title down to ~101px (a
// normal title wrapped to six lines). Every action stays reachable, and the
// row tap itself is still the fast path to edit.
export function ToDoItemMenu({ task, ...h }: Props) {
  const isCancelled = task.status === 'cancelled'
  return (
    <Menu as="div" className="shrink-0 lg:hidden" onClick={e => e.stopPropagation()}>
      <MenuButton className="icon-btn text-fg-faint" title="More actions" aria-label="More actions">
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        transition
        className="menu w-52 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <Item icon={<Pencil />} onClick={h.onEdit}>Edit</Item>
        {h.onMoveUp && <Item icon={<ArrowUp />} onClick={h.onMoveUp} disabled={!h.canMoveUp}>Move up</Item>}
        {h.onMoveDown && <Item icon={<ArrowDown />} onClick={h.onMoveDown} disabled={!h.canMoveDown}>Move down</Item>}
        <Item icon={<CornerDownRight />} onClick={h.onSetParent}>Set parent…</Item>
        <Item icon={<ListTree />} onClick={h.onMoveToList}>Move to list…</Item>
        {task.google_web_view_link && (
          <MenuItem>
            <a href={task.google_web_view_link} target="_blank" rel="noreferrer" className="menu-item [&_svg]:h-4 [&_svg]:w-4">
              <ExternalLink aria-hidden /> Open in Google Tasks
            </a>
          </MenuItem>
        )}
        <div className="menu-sep" />
        {/* Cancel keeps a record, unlike Delete. Reopen re-fires migration
            071's "un-cancelled" trigger branch, which enqueues a fresh outbox
            'create' since Google Tasks has no undelete of its own. */}
        {!isCancelled
          ? <Item icon={<Ban />} onClick={h.onCancel} disabled={h.busy}>Cancel task</Item>
          : <Item icon={<RotateCcw />} onClick={h.onReopen} disabled={h.busy}>Reopen</Item>}
        <Item icon={<Trash2 />} onClick={h.onDelete} disabled={h.busy} danger>Delete</Item>
      </MenuItems>
    </Menu>
  )
}

function Item({ icon, onClick, disabled, danger, children }: {
  icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode
}) {
  return (
    <MenuItem disabled={disabled}>
      <button
        type="button" onClick={onClick}
        className={cx('menu-item data-[disabled]:opacity-40 [&_svg]:h-4 [&_svg]:w-4', danger && 'is-danger')}
      >
        <span aria-hidden className="contents">{icon}</span>
        {children}
      </button>
    </MenuItem>
  )
}

/** Desktop hover strip (lg+ with a mouse); the row itself stays the edit target. */
export function ToDoItemHoverActions({ task, ...h }: Props) {
  const isCancelled = task.status === 'cancelled'
  return (
    <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
      {h.onMoveUp && <HoverBtn label="Move up" onClick={h.onMoveUp} disabled={!h.canMoveUp}><ArrowUp /></HoverBtn>}
      {h.onMoveDown && <HoverBtn label="Move down" onClick={h.onMoveDown} disabled={!h.canMoveDown}><ArrowDown /></HoverBtn>}
      <HoverBtn label="Edit" onClick={h.onEdit}><Pencil /></HoverBtn>
      <HoverBtn label="Set parent task" onClick={h.onSetParent}><CornerDownRight /></HoverBtn>
      <HoverBtn label="Move to list" onClick={h.onMoveToList}><ListTree /></HoverBtn>
      {task.google_web_view_link && (
        <a
          href={task.google_web_view_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          title="Open in Google Tasks" aria-label="Open in Google Tasks"
          className="grid h-7 w-7 place-items-center rounded-control text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg [&_svg]:h-3.5 [&_svg]:w-3.5"
        ><ExternalLink aria-hidden /></a>
      )}
      {!isCancelled
        ? <HoverBtn label="Cancel (keeps a record, unlike Delete)" onClick={h.onCancel} disabled={h.busy}><Ban /></HoverBtn>
        : <HoverBtn label="Reopen (re-creates it on Google Tasks if connected)" onClick={h.onReopen} disabled={h.busy}><RotateCcw /></HoverBtn>}
      <HoverBtn label="Delete" onClick={h.onDelete} disabled={h.busy} danger><Trash2 /></HoverBtn>
    </div>
  )
}

function HoverBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode
}) {
  return (
    <button
      type="button" title={label} aria-label={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={cx(
        'grid h-7 w-7 place-items-center rounded-control text-fg-faint transition-colors hover:bg-surface-hover disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5',
        danger ? 'hover:text-danger' : 'hover:text-fg',
      )}
    >
      <span aria-hidden className="contents">{children}</span>
    </button>
  )
}
