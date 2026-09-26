import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronDown, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { StatusCycleChip } from './StatusCycleChip'
import { InlineText } from './InlineText'
import { ItemRow } from './ItemRow'
import { PHASE_STATUS_TONE } from '../projectTones'
import type { ProjectPhase, ProjectItem, PhaseStatus, ItemType } from '../types'

const PHASE_STATUSES: PhaseStatus[] = ['pending', 'in_progress', 'done']

interface Props {
  phase:          ProjectPhase
  items:          ProjectItem[]
  typeFilter?:    ItemType | null
  onUpdatePhase:  (patch: Partial<Pick<ProjectPhase, 'name' | 'status'>>) => void
  onDeletePhase:  () => void
  onAddItem:      () => void
  onUpdateItem:   (itemId: string, patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority'>>) => void
  onDeleteItem:   (itemId: string) => void
  onEditItem:     (item: ProjectItem) => void
}

export function PhaseCard({
  phase, items, typeFilter,
  onUpdatePhase, onDeletePhase, onAddItem,
  onUpdateItem, onDeleteItem, onEditItem,
}: Props) {
  const [open, setOpen] = useState(true)
  const modal = useEntityModal()

  const totalCount = items.length
  const doneCount  = items.filter(i => i.status === 'done').length
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const visible   = typeFilter ? items.filter(i => i.type === typeFilter) : items
  const openItems = visible.filter(i => i.status !== 'done')
  const doneItems = visible.filter(i => i.status === 'done')

  async function confirmDelete() {
    const ok = await modal.confirm({
      title: `Delete "${phase.name}"?`,
      message: totalCount > 0 ? `This also removes the ${totalCount} item${totalCount !== 1 ? 's' : ''} in this phase.` : undefined,
      confirmLabel: 'Delete phase',
      destructive: true,
    })
    if (ok) onDeletePhase()
  }

  const renderItem = (item: ProjectItem) => (
    <ItemRow
      key={item.id}
      item={item}
      onUpdate={patch => onUpdateItem(item.id, patch)}
      onDelete={() => onDeleteItem(item.id)}
      onEdit={() => onEditItem(item)}
    />
  )

  return (
    <div className="card group/phase overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o) }}
        className="flex min-h-[48px] cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-1.5 transition-colors hover:bg-surface-hover"
      >
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${open ? '' : '-rotate-90'}`} />

        <div className="min-w-0 grow basis-[calc(100%-1.5rem)] sm:basis-0">
          <InlineText
            value={phase.name}
            onSave={name => onUpdatePhase({ name })}
            className="block truncate text-ui font-semibold text-fg"
            inputClass="text-ui font-semibold text-fg w-full min-w-0 sm:max-w-[12rem]"
          />
        </div>

        <StatusCycleChip
          value={phase.status}
          options={PHASE_STATUSES}
          tones={PHASE_STATUS_TONE}
          onCycle={status => onUpdatePhase({ status })}
        />

        {totalCount > 0 && <span className="text-meta text-fg-muted tabular-nums">{doneCount}/{totalCount}</span>}

        {/* Desktop: inline add + a delete that appears on hover / focus. */}
        {open && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onAddItem() }}
            className="btn-ghost btn-sm hidden text-accent-600 lg:inline-flex"
          >
            <Plus aria-hidden className="h-4 w-4" /> Item
          </button>
        )}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); void confirmDelete() }}
          className="icon-btn hidden h-8 w-8 opacity-0 transition-opacity hover:text-danger group-hover/phase:opacity-100 focus-visible:opacity-100 lg:inline-grid [@media(pointer:coarse)]:opacity-100"
          aria-label={`Delete phase ${phase.name}`}
          title="Delete phase"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>

        {/* Phones: add + delete in one menu so the phase name keeps its width. */}
        <Menu as="div" className="ml-auto shrink-0 lg:hidden" onClick={e => e.stopPropagation()}>
          <MenuButton className="icon-btn" aria-label="Phase actions" title="Phase actions">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition
            className="menu w-44 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            <MenuItem>
              <button type="button" onClick={onAddItem} className="menu-item"><Plus aria-hidden className="h-4 w-4" /> Add item</button>
            </MenuItem>
            <MenuItem>
              <button type="button" onClick={() => { void confirmDelete() }} className="menu-item is-danger">
                <Trash2 aria-hidden className="h-4 w-4" /> Delete phase
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      {totalCount > 0 && pct > 0 && (
        <div className="h-0.5 bg-surface-2">
          <div className="h-full bg-success transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      {open && (
        <div className="divide-y divide-line border-t border-line">
          {visible.length === 0 && (
            <p className="px-4 py-3 text-meta text-fg-muted">
              {typeFilter ? 'No items match the current filter' : 'Nothing here yet'}
            </p>
          )}
          {openItems.map(renderItem)}
          {doneItems.length > 0 && <div className="opacity-60">{doneItems.map(renderItem)}</div>}
        </div>
      )}
    </div>
  )
}
