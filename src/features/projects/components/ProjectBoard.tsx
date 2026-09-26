import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { ToneDot, TonePill } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import { ITEM_PRIORITY_TONE, ITEM_STATUS_TONE, ITEM_TYPE_LABEL, ITEM_TYPE_TONE } from '../projectTones'
import type { ItemStatus, ProjectItem, ProjectPhase } from '../types'

const COLUMNS: Array<{ key: ItemStatus; label: string }> = [
  { key: 'open',        label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done',        label: 'Done' },
]
const ORDER = COLUMNS.map(c => c.key)

const ARROW = 'icon-btn h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'

interface Props {
  projectId: string
  items:     ProjectItem[]
  phases:    ProjectPhase[]
  onMove:    (itemId: string, status: ItemStatus) => void
}

/** Kanban over open / in progress / done: drag, or the arrow buttons on touch. */
export function ProjectBoard({ projectId, items, phases, onMove }: Props) {
  const modal = useEntityModal()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ItemStatus | null>(null)
  const phaseName = (id: string) => phases.find(p => p.id === id)?.name ?? '—'
  const cancelledCount = items.filter(i => i.status === 'cancelled').length

  function step(item: ProjectItem, dir: -1 | 1) {
    const idx = Math.max(0, ORDER.indexOf(item.status))
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, idx + dir))]
    if (next !== item.status) onMove(item.id, next)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, status: ItemStatus) {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('itemId')
    setDragOverCol(null)
    setDraggingId(null)
    if (itemId) onMove(itemId, status)
  }

  return (
    <div>
      {/* Phones: horizontal snap (the next column peeks); sm+: three columns. */}
      <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">
        {COLUMNS.map((col, colIdx) => {
          const colItems = items.filter(i => i.status === col.key)
          const isDropTarget = dragOverCol === col.key
          return (
            <div
              key={col.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col.key) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null) }}
              onDrop={e => handleDrop(e, col.key)}
              className={`flex min-h-[80px] w-[78%] shrink-0 snap-start flex-col gap-2 rounded-card border p-2.5 transition-colors sm:w-auto ${
                isDropTarget ? 'border-dashed border-accent-500 bg-accent-50' : 'border-line bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 section-label">
                  <ToneDot tone={ITEM_STATUS_TONE[col.key]} /> {col.label}
                </span>
                <span className="count-badge bg-surface">{colItems.length}</span>
              </div>
              {colItems.length === 0 && <p className="px-1 py-2 text-meta text-fg-muted">{isDropTarget ? 'Drop here' : 'Empty'}</p>}
              {colItems.map(item => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('itemId', item.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(item.id) }}
                  onDragEnd={() => setDraggingId(null)}
                  className={`flex cursor-grab select-none flex-col gap-1.5 rounded-row border border-line bg-surface p-2.5 shadow-card transition-opacity ${
                    draggingId === item.id ? 'opacity-30' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => modal.open({ kind: 'project-item', projectId, id: item.id })}
                    className={`-mx-0.5 rounded-md px-0.5 text-left text-body leading-snug transition-colors hover:bg-surface-hover ${
                      item.status === 'done' ? 'text-fg-faint line-through' : 'text-fg'
                    }`}
                  >
                    {item.title}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TonePill tone={ITEM_TYPE_TONE[item.type]}>{ITEM_TYPE_LABEL[item.type]}</TonePill>
                    <span title={`Priority: ${item.priority}`}><ToneDot tone={ITEM_PRIORITY_TONE[item.priority]} /></span>
                    <span className="truncate text-micro text-fg-muted">{phaseName(item.phase_id)}</span>
                    <div className="ml-auto flex items-center">
                      {colIdx > 0 && (
                        <button type="button" onClick={() => { haptic('light'); step(item, -1) }} className={ARROW} aria-label="Move left" title="Move left">
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {colIdx < COLUMNS.length - 1 && (
                        <button type="button" onClick={() => { haptic('light'); step(item, 1) }} className={ARROW} aria-label="Move right" title="Move right">
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {/* Cancelled items have no column; say so instead of letting them vanish. */}
      {cancelledCount > 0 && (
        <p className="mt-2 text-meta text-fg-muted">
          {cancelledCount} cancelled item{cancelledCount === 1 ? '' : 's'} hidden from the board — see the Phases view
        </p>
      )}
    </div>
  )
}
