import { useState } from 'react'
import { InlineText } from './InlineText'
import { InlineTextArea } from './InlineTextArea'
import type { ProjectItem, ItemType, ItemPriority, ItemStatus } from '../types'

const TYPE_BADGE: Record<ItemType, string> = {
  update:      'bg-blue-50 text-blue-700 border-blue-200',
  improvement: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ui_request:  'bg-violet-50 text-violet-700 border-violet-200',
  bug:         'bg-red-50 text-red-700 border-red-200',
  wishlist:    'bg-amber-50 text-amber-700 border-amber-200',
}

const TYPE_LABEL: Record<ItemType, string> = {
  update:      'update',
  improvement: 'improve',
  ui_request:  'UI',
  bug:         'bug',
  wishlist:    'wish',
}

const TYPE_ORDER: ItemType[]    = ['update', 'improvement', 'ui_request', 'bug', 'wishlist']
const PRI_ORDER: ItemPriority[] = ['low', 'medium', 'high']
const STATUS_ORDER: ItemStatus[] = ['open', 'in_progress', 'done']

const PRIORITY_DOT: Record<ItemPriority, string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-red-400',
}

interface Props {
  item:       ProjectItem
  onUpdate:   (patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority'>>) => void
  onDelete:   () => void
  isPending?: boolean
}

export function ItemRow({ item, onUpdate, onDelete, isPending }: Props) {
  const [showNotes, setShowNotes] = useState(() => !!item.notes)
  const [hovered,   setHovered]   = useState(false)

  const isDone       = item.status === 'done'
  const isInProgress = item.status === 'in_progress'
  const hasNotes     = !!item.notes

  function cycleStatus() {
    const idx  = STATUS_ORDER.indexOf(item.status)
    const next = idx === -1 ? 'open' : STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
    onUpdate({ status: next as ItemStatus })
  }

  function cycleType() {
    const idx = TYPE_ORDER.indexOf(item.type)
    onUpdate({ type: TYPE_ORDER[(idx + 1) % TYPE_ORDER.length] })
  }

  function cyclePriority() {
    const idx = PRI_ORDER.indexOf(item.priority)
    onUpdate({ priority: PRI_ORDER[(idx + 1) % PRI_ORDER.length] })
  }

  return (
    <div
      className={`transition-opacity ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* 3-state status button */}
        <button
          onClick={cycleStatus}
          title={`Status: ${item.status} — click to advance`}
          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
            isDone       ? 'bg-emerald-400 border-emerald-400 text-white' :
            isInProgress ? 'border-accent-400 bg-accent-50 text-accent-600' :
                           'border-ink-300 hover:border-accent-400'
          }`}
        >
          {isDone       && <span className="text-[9px] leading-none">✓</span>}
          {isInProgress && <span className="text-[9px] leading-none">–</span>}
        </button>

        {/* Type badge */}
        <button
          onClick={cycleType}
          className={`text-[9px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${TYPE_BADGE[item.type]}`}
          title="Click to change type"
        >
          {TYPE_LABEL[item.type]}
        </button>

        {/* Priority dot */}
        <button
          onClick={cyclePriority}
          className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[item.priority]}`}
          title={`Priority: ${item.priority} — click to change`}
        />

        {/* Title */}
        <div className="flex-1 min-w-0">
          <InlineText
            value={item.title}
            onSave={title => onUpdate({ title })}
            className={`text-sm w-full block ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}
            inputClass="text-sm w-full text-ink-800"
          />
        </div>

        {/* Notes indicator — always visible when notes exist */}
        {(hasNotes || hovered) && (
          <button
            onClick={() => setShowNotes(n => !n)}
            className={`text-[10px] px-1 transition-colors ${
              hasNotes
                ? 'text-amber-500 hover:text-amber-700'
                : 'text-ink-400 hover:text-ink-700'
            }`}
            title={showNotes ? 'Hide notes' : 'Show notes'}
          >
            ≡
          </button>
        )}

        {/* Delete — hover only */}
        {hovered && (
          <button
            onClick={onDelete}
            className="text-[10px] text-ink-300 hover:text-red-400"
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>

      {/* Notes */}
      {showNotes && (
        <div className="px-11 pb-1.5">
          <InlineTextArea
            value={item.notes}
            onSave={notes => onUpdate({ notes })}
            placeholder="Add notes…"
          />
        </div>
      )}
    </div>
  )
}
