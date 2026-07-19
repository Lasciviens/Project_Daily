import type { Task } from '../../todo/types'
import { PRIORITY_META, dueLabel } from './workMeta'

interface Props {
  tasks:        Task[]
  onMarkDone:   (id: string) => void
  onClearFocus: (id: string) => void
  onEdit:       (task: Task) => void
}

// The "what am I doing right now" zone — focused tasks as a horizontal
// snap-scroll strip (replaces the old paged 2-card hero).
export default function FocusStrip({ tasks, onMarkDone, onClearFocus, onEdit }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-cream-50/60 px-4 py-2.5 flex items-center gap-2 text-ink-400 text-xs">
        <span className="text-sm">⚡</span>
        <span>No focus — hit ⚡ on any task to pin it here</span>
      </div>
    )
  }

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none scroll-fade-x pb-1 snap-x snap-mandatory">
      {tasks.map(task => {
        const due  = dueLabel(task)
        const prio = PRIORITY_META[task.priority]
        return (
          <div
            key={task.id}
            className="snap-start flex-shrink-0 w-[280px] sm:w-[320px] rounded-xl border border-accent-200 bg-gradient-to-br from-accent-50 to-cream-50 px-3.5 py-2.5 flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-accent-500">⚡ Focus</span>
              <button
                onClick={() => onClearFocus(task.id)}
                title="Remove focus"
                className="text-[10px] text-ink-300 hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center md:inline px-1"
              >
                ✕
              </button>
            </div>

            <button
              type="button"
              onClick={() => onEdit(task)}
              className="text-left text-sm font-bold text-ink-900 leading-snug hover:text-accent-700 transition-colors truncate"
              title={task.title}
            >
              {task.title}
            </button>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] leading-none ${prio.cls}`}>{prio.icon} {prio.label}</span>
              {due && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${due.urgent ? 'bg-red-50 text-red-600' : 'bg-ink-100 text-ink-500'}`}>
                  {due.text}
                </span>
              )}
              {task.waiting_for && (
                <span className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-full truncate max-w-[130px]">
                  ⏳ {task.waiting_for}
                </span>
              )}
              <button
                onClick={() => onMarkDone(task.id)}
                className="ml-auto min-h-[44px] md:min-h-[30px] px-3 rounded-lg bg-accent-500 text-white text-xs font-semibold hover:bg-accent-600 transition-colors"
              >
                ✓ Done
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
