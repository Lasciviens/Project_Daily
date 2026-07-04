import { useState } from 'react'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
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
  onEdit:     () => void
  isPending?: boolean
}

export function ItemRow({ item, onUpdate, onDelete, onEdit, isPending }: Props) {
  const [showNotes, setShowNotes] = useState(() => !!item.notes)
  const [hovered,   setHovered]   = useState(false)
  const [planOpen,  setPlanOpen]  = useState(false)

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
      <div className="flex items-center gap-2 px-3 py-1.5 min-h-[44px]">
        {/* 3-state status button — enlarged tap target on mobile */}
        <button
          onClick={cycleStatus}
          title={`Status: ${item.status} — click to advance`}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 transition-colors lg:min-w-0 lg:min-h-0 lg:w-4 lg:h-4 lg:rounded lg:border ${
            isDone       ? 'text-emerald-500 lg:bg-emerald-400 lg:border-emerald-400 lg:text-white' :
            isInProgress ? 'text-accent-600 lg:border-accent-400 lg:bg-accent-50' :
                           'text-ink-300 lg:border-ink-300 hover:text-accent-400'
          }`}
        >
          <span className={`w-4 h-4 rounded border flex items-center justify-center ${
            isDone       ? 'bg-emerald-400 border-emerald-400 text-white' :
            isInProgress ? 'border-accent-400 bg-accent-50 text-accent-600' :
                           'border-ink-300 hover:border-accent-400'
          }`}>
            {isDone       && <span className="text-[9px] leading-none">✓</span>}
            {isInProgress && <span className="text-[9px] leading-none">–</span>}
          </span>
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
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 lg:min-w-0 lg:min-h-0 lg:w-auto lg:h-auto`}
          title={`Priority: ${item.priority} — click to change`}
        >
          <span className={`w-2 h-2 rounded-full block ${PRIORITY_DOT[item.priority]}`} />
        </button>

        {/* Title — click opens full edit modal */}
        <button
          type="button"
          onClick={onEdit}
          className={`flex-1 min-w-0 text-left text-sm truncate rounded px-0.5 hover:bg-ink-100 transition-colors duration-100 ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}
          title="Click to edit"
        >
          {item.title}
        </button>

        {/* Plan, notes, edit, delete — always visible on mobile; hover-only on desktop */}
        <div className="flex items-center gap-0.5 flex-shrink-0 lg:hidden">
          {!isDone && (
            <button
              onClick={() => setPlanOpen(true)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-accent-600 text-sm"
              title="Schedule this item"
            >📅</button>
          )}
          {hasNotes && (
            <button
              onClick={() => setShowNotes(n => !n)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-sm text-accent-500"
              title={showNotes ? 'Hide notes' : 'Show notes'}
            >≡</button>
          )}
          <button
            onClick={onEdit}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-accent-600 text-sm"
            title="Edit item"
          >✎</button>
          <button
            onClick={onDelete}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 active:text-red-400 text-sm"
            title="Delete"
          >✕</button>
        </div>

        {/* Desktop hover-only actions */}
        {hovered && (
          <div className="hidden lg:flex items-center gap-0.5 flex-shrink-0">
            {!isDone && (
              <button
                onClick={() => setPlanOpen(true)}
                className="text-[10px] text-ink-400 hover:text-accent-600"
                title="Schedule this item"
              >📅</button>
            )}
            {hasNotes && (
              <button
                onClick={() => setShowNotes(n => !n)}
                className="text-[10px] px-1 text-accent-500 hover:text-accent-700"
                title={showNotes ? 'Hide notes' : 'Show notes'}
              >≡</button>
            )}
            <button
              onClick={onEdit}
              className="text-[10px] px-1 text-ink-400 hover:text-accent-600"
              title="Edit item"
            >✎</button>
            <button
              onClick={onDelete}
              className="text-[10px] text-ink-300 hover:text-red-400"
              title="Delete"
            >✕</button>
          </div>
        )}
      </div>

      {/* Notes preview — read only, edit via modal */}
      {showNotes && hasNotes && (
        <div className="px-11 pb-1.5">
          <p className="text-xs text-ink-500 whitespace-pre-wrap">{item.notes}</p>
        </div>
      )}

      {/* Plan modal — work task (+ optional schedule block) */}
      <UnifiedPlanModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        config={{ tabs: ['schedule', 'task'], heading: 'Plan item' }}
        defaults={{
          title:          item.title,
          category:       'projects',
          domain:         'work',
          priority:       item.priority,
          alsoCreateTask: true,
        }}
        source={{ sourceType: 'project_item', sourceId: item.id }}
      />
    </div>
  )
}

