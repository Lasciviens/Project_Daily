import { useState } from 'react'
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
  pendingItemId?: string
}

export function PhaseCard({
  phase, items, typeFilter,
  onUpdatePhase, onDeletePhase, onAddItem,
  onUpdateItem, onDeleteItem, pendingItemId,
}: Props) {
  const [open,    setOpen]    = useState(true)
  const [hovered, setHovered] = useState(false)

  const totalCount = items.length
  const doneCount  = items.filter(i => i.status === 'done').length
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const visible   = typeFilter ? items.filter(i => i.type === typeFilter) : items
  const openItems = visible.filter(i => i.status !== 'done')
  const doneItems = visible.filter(i => i.status === 'done')

  function handleDeletePhase(e: React.MouseEvent) {
    e.stopPropagation()
    const msg = totalCount > 0
      ? `Delete "${phase.name}"? This will remove all ${totalCount} item${totalCount !== 1 ? 's' : ''}.`
      : `Delete phase "${phase.name}"?`
    if (!confirm(msg)) return
    onDeletePhase()
  }

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden bg-white">
      {/* Phase header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-ink-50 transition-colors"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="text-ink-400 text-xs w-3">{open ? '▼' : '▶'}</span>

        <InlineText
          value={phase.name}
          onSave={name => onUpdatePhase({ name })}
          className="text-sm font-semibold text-ink-800 flex-1"
          inputClass="text-sm font-semibold text-ink-800 w-48"
        />

        <StatusCycleChip
          value={phase.status}
          options={PHASE_STATUSES}
          colors={PHASE_STATUS_COLORS as Partial<Record<PhaseStatus, string>>}
          onCycle={status => onUpdatePhase({ status })}
        />

        {totalCount > 0 && (
          <span className="text-[10px] text-ink-400">{doneCount}/{totalCount}</span>
        )}

        {open && (
          <button
            onClick={e => { e.stopPropagation(); onAddItem() }}
            className="text-[10px] text-accent-600 hover:text-accent-700 px-2 py-0.5 rounded hover:bg-accent-50 min-h-[44px] min-w-[44px] flex items-center justify-center lg:min-h-0 lg:min-w-0"
          >
            + item
          </button>
        )}

        {/* Always visible on mobile; hover-only on desktop */}
        <button
          onClick={handleDeletePhase}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[10px] text-ink-300 hover:text-red-400 ml-1 lg:hidden"
          title="Delete phase"
        >
          ✕
        </button>
        {hovered && (
          <button
            onClick={handleDeletePhase}
            className="hidden lg:flex items-center justify-center text-[10px] text-ink-300 hover:text-red-400 ml-1"
            title="Delete phase"
          >
            ✕
          </button>
        )}
      </div>

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
            <p className="text-xs text-ink-300 px-3 py-2">
              {typeFilter ? 'No items match the current filter' : 'Nothing here yet'}
            </p>
          )}
          {openItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onUpdate={patch => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
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
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
