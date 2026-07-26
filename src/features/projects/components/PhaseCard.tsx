import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { StatusCycleChip, PHASE_STATUS_COLORS } from './StatusCycleChip'
import { InlineText } from './InlineText'
import { ItemRow } from './ItemRow'
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
  pendingItemId?: string
}

export function PhaseCard({
  phase, items, typeFilter,
  onUpdatePhase, onDeletePhase, onAddItem,
  onUpdateItem, onDeleteItem, onEditItem, pendingItemId,
}: Props) {
  const [open,       setOpen]       = useState(true)
  const [hovered,    setHovered]    = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const totalCount = items.length
  const doneCount  = items.filter(i => i.status === 'done').length
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const visible   = typeFilter ? items.filter(i => i.type === typeFilter) : items
  const openItems = visible.filter(i => i.status !== 'done')
  const doneItems = visible.filter(i => i.status === 'done')

  const deleteMessage = totalCount > 0
    ? `This will also remove all ${totalCount} item${totalCount !== 1 ? 's' : ''} in this phase.`
    : undefined

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden bg-cream-50">
      {/* Phase header */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-ink-50 transition-colors min-h-[44px]"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="text-ink-400 text-xs w-3">{open ? '▼' : '▶'}</span>

        <div className="basis-[calc(100%-1.5rem)] sm:basis-0 grow min-w-0">
          <InlineText
            value={phase.name}
            onSave={name => onUpdatePhase({ name })}
            className="block text-sm font-semibold text-ink-800 truncate"
            inputClass="text-sm font-semibold text-ink-800 w-full min-w-0 sm:max-w-[12rem]"
          />
        </div>

        <StatusCycleChip
          value={phase.status}
          options={PHASE_STATUSES}
          colors={PHASE_STATUS_COLORS as Partial<Record<PhaseStatus, string>>}
          onCycle={status => onUpdatePhase({ status })}
        />

        {totalCount > 0 && (
          <span className="text-[10px] text-ink-500">{doneCount}/{totalCount}</span>
        )}

        {open && (
          <button
            onClick={e => { e.stopPropagation(); onAddItem() }}
            className="hidden lg:flex text-[10px] text-accent-600 hover:text-accent-700 px-2 py-0.5 rounded hover:bg-accent-50 items-center justify-center"
          >
            + item
          </button>
        )}

        {/* Mobile: + item and ✕ folded into ONE 44px menu so the phase name
            keeps the width. Desktop keeps the inline + hover-revealed pair. */}
        <Menu as="div" className="ml-auto shrink-0 lg:hidden" onClick={e => e.stopPropagation()}>
          <MenuButton
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lg leading-none text-ink-400 active:text-ink-700 rounded press-feedback"
            aria-label="Phase actions"
            title="Phase actions"
          >⋯</MenuButton>
          <MenuItems
            anchor="bottom end"
            transition
            className="z-[60] w-44 bg-cream-50 border border-ink-200 rounded-xl shadow-card-hover overflow-hidden [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0 data-[closed]:scale-95"
          >
            <MenuItem>
              <button
                onClick={onAddItem}
                className="w-full text-left px-3 min-h-[44px] text-sm text-ink-700 data-[focus]:bg-ink-100"
              >+ Add item</button>
            </MenuItem>
            <MenuItem>
              <button
                onClick={() => setConfirmDel(true)}
                className="w-full text-left px-3 min-h-[44px] text-sm text-red-600 data-[focus]:bg-ink-100"
              >✕ Delete phase</button>
            </MenuItem>
          </MenuItems>
        </Menu>
        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDel(true) }}
            className="hidden lg:flex items-center justify-center text-[10px] text-ink-300 hover:text-red-400 ml-1"
            title="Delete phase"
          >
            ✕
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={onDeletePhase}
        title={`Delete "${phase.name}"?`}
        message={deleteMessage}
        confirmLabel="Delete phase"
      />

      {/* Progress bar */}
      {totalCount > 0 && pct > 0 && (
        <div className="h-0.5 bg-ink-100">
          <div
            className="h-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Items */}
      {open && (
        <div className="border-t border-ink-100 divide-y divide-ink-50">
          {visible.length === 0 && (
            <p className="text-xs text-ink-500 px-3 py-2">
              {typeFilter ? 'No items match the current filter' : 'Nothing here yet'}
            </p>
          )}
          {openItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onUpdate={patch => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
              onEdit={() => onEditItem(item)}
              isPending={pendingItemId === item.id}
            />
          ))}
          {doneItems.length > 0 && (
            <div className="opacity-50">
              {doneItems.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onUpdate={patch => onUpdateItem(item.id, patch)}
                  onDelete={() => onDeleteItem(item.id)}
                  onEdit={() => onEditItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
