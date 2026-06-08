import { useState } from 'react'
import { StatusCycleChip, PHASE_STATUS_COLORS } from './StatusCycleChip'
import { InlineText } from './InlineText'
import { ItemRow } from './ItemRow'
import type { ProjectPhase, ProjectItem, PhaseStatus } from '../types'

const PHASE_STATUSES: PhaseStatus[] = ['pending', 'in_progress', 'done']

interface Props {
  phase:      ProjectPhase
  items:      ProjectItem[]
  onUpdatePhase:  (patch: Partial<Pick<ProjectPhase, 'name' | 'status'>>) => void
  onDeletePhase:  () => void
  onAddItem:      () => void
  onUpdateItem:   (itemId: string, patch: Parameters<typeof ItemRow>[0]['onUpdate'] extends (p: infer P) => void ? P : never) => void
  onDeleteItem:   (itemId: string) => void
  pendingItemId?: string
}

export function PhaseCard({
  phase, items,
  onUpdatePhase, onDeletePhase, onAddItem,
  onUpdateItem, onDeleteItem, pendingItemId,
}: Props) {
  const [open,    setOpen]    = useState(true)
  const [hovered, setHovered] = useState(false)

  const doneItems  = items.filter(i => i.status === 'done')
  const openItems  = items.filter(i => i.status !== 'done' && i.status !== 'cancelled')

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

        <span className="text-[10px] text-ink-400">{items.length}</span>

        {open && (
          <button
            onClick={e => { e.stopPropagation(); onAddItem() }}
            className="text-[10px] text-accent-600 hover:text-accent-700 px-2 py-0.5 rounded hover:bg-accent-50"
          >
            + item
          </button>
        )}

        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); onDeletePhase() }}
            className="text-[10px] text-ink-300 hover:text-red-400 ml-1"
            title="Delete phase"
          >
            ✕
          </button>
        )}
      </div>

      {/* Items */}
      {open && (
        <div className="border-t border-ink-100 divide-y divide-ink-50">
          {openItems.length === 0 && doneItems.length === 0 && (
            <p className="text-xs text-ink-300 px-3 py-2">Nothing here yet</p>
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
