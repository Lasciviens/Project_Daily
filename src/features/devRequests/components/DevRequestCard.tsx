import type { DevRequest } from '../types'
import { CATEGORY_BADGE, PRIORITY_DOT } from './devRequestMeta'

interface Props {
  request:    DevRequest
  dragging:   boolean
  onDragStart: () => void
  onDragEnd:   () => void
  onCycleStatus: () => void
  onDelete:      () => void
  onEdit:        () => void
}

export function DevRequestCard({ request, dragging, onDragStart, onDragEnd, onCycleStatus, onDelete, onEdit }: Props) {
  const isDone = request.status === 'done'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex items-start gap-2 bg-white border border-ink-100 rounded-xl p-2.5 cursor-grab select-none transition-opacity ${
        dragging ? 'opacity-30' : ''
      } ${isDone ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onCycleStatus}
        title={`Status: ${request.status} (click to advance)`}
        className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center min-h-[44px] min-w-[24px] lg:min-h-0 lg:min-w-0 ${
          isDone ? 'bg-emerald-500 border-emerald-500'
            : request.status === 'in_progress' ? 'border-accent-500' : 'border-ink-300'
        }`}
      >
        {isDone && <span className="text-[9px] text-white">✓</span>}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <button
          type="button"
          onClick={onEdit}
          className={`text-left text-sm leading-snug hover:bg-ink-50 rounded px-0.5 -mx-0.5 transition-colors ${
            isDone ? 'line-through text-ink-400' : 'text-ink-800'
          }`}
        >
          {request.title}
        </button>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${CATEGORY_BADGE[request.category]}`}>
            {request.category}
          </span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[request.priority]}`} title={`priority: ${request.priority}`} />
          {request.page && <span className="text-[10px] text-ink-400 truncate">{request.page}</span>}
          {request.effort && <span className="text-[10px] text-ink-300">· {request.effort}</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 min-w-[44px] min-h-[44px] lg:min-w-[24px] lg:min-h-[24px] flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors"
        title="Delete"
      >
        ✕
      </button>
    </div>
  )
}
