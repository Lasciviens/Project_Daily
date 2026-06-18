import { useState } from 'react'
import { isToday, isTomorrow } from 'date-fns'
import { InlineText } from './InlineText'
import { InlineTextArea } from './InlineTextArea'
import { useCreateTask } from '../../todo/hooks/useTodos'
import { useCreateTimeBlock } from '../../daily/hooks/useSchedule'
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
  const [showNotes,     setShowNotes]     = useState(() => !!item.notes)
  const [hovered,       setHovered]       = useState(false)
  const [showPlan,      setShowPlan]      = useState(false)
  const [planDate,      setPlanDate]      = useState('')
  const [askSchedule,   setAskSchedule]   = useState(false)
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)
  const createTask      = useCreateTask()
  const createTimeBlock = useCreateTimeBlock()

  async function handlePlan() {
    if (!planDate) return
    const { task } = await createTask.mutateAsync({
      title:    item.title,
      domain:   'work',
      section:  isToday(new Date(planDate + 'T00:00:00')) ? 'today'
              : isTomorrow(new Date(planDate + 'T00:00:00')) ? 'tomorrow'
              : 'this_week',
      priority: item.priority,
      due_date: planDate,
    })
    setPendingTaskId(task.id)
    setShowPlan(false)
    setAskSchedule(true)
  }

  function confirmSchedule(yes: boolean) {
    if (yes && pendingTaskId && planDate) {
      createTimeBlock.mutate({
        date:             planDate,
        title:            item.title,
        start_time:       '17:00:00',
        duration_minutes: 60,
        color:            'blue',
        source_type:      'task',
        source_id:        pendingTaskId,
      })
    }
    setAskSchedule(false)
    setPendingTaskId(null)
    setPlanDate('')
  }

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

        {/* Plan, notes, delete — always visible on mobile; hover-only on desktop */}
        <div className="flex items-center gap-0.5 flex-shrink-0 lg:hidden">
          {!isDone && (
            <button
              onClick={() => setShowPlan(p => !p)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-accent-600 text-sm"
              title="Schedule this item"
            >📅</button>
          )}
          {(hasNotes || true) && (
            <button
              onClick={() => setShowNotes(n => !n)}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center text-sm transition-colors ${
                hasNotes ? 'text-amber-500' : 'text-ink-300'
              }`}
              title={showNotes ? 'Hide notes' : 'Show notes'}
            >≡</button>
          )}
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
                onClick={() => setShowPlan(p => !p)}
                className="text-[10px] text-ink-400 hover:text-accent-600"
                title="Schedule this item"
              >📅</button>
            )}
            {(hasNotes || hovered) && (
              <button
                onClick={() => setShowNotes(n => !n)}
                className={`text-[10px] px-1 transition-colors ${
                  hasNotes ? 'text-amber-500 hover:text-amber-700' : 'text-ink-400 hover:text-ink-700'
                }`}
                title={showNotes ? 'Hide notes' : 'Show notes'}
              >≡</button>
            )}
            <button
              onClick={onDelete}
              className="text-[10px] text-ink-300 hover:text-red-400"
              title="Delete"
            >✕</button>
          </div>
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

      {/* Plan date picker */}
      {showPlan && (
        <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
          <input
            type="date"
            lang="en-GB"
            value={planDate}
            onChange={e => setPlanDate(e.target.value)}
            className="text-sm border border-ink-200 rounded-lg px-2 py-2 outline-none focus:border-accent-400 min-h-[44px]"
          />
          <button
            onClick={handlePlan}
            disabled={!planDate || createTask.isPending}
            className="text-xs px-3 py-2 bg-accent-500 text-white rounded-lg disabled:opacity-40 min-h-[44px]"
          >
            {createTask.isPending ? '…' : 'Plan'}
          </button>
          <button onClick={() => setShowPlan(false)} className="text-xs text-ink-400 min-h-[44px] px-2 flex items-center">Cancel</button>
        </div>
      )}

      {/* Schedule confirmation */}
      {askSchedule && (
        <div className="px-3 pb-2 flex items-center gap-2 flex-wrap bg-cream-50 rounded-lg mx-3 mb-1 p-2">
          <span className="text-xs text-ink-600">Also add to day schedule at 17:00?</span>
          <button onClick={() => confirmSchedule(true)}  className="text-xs px-3 py-2 bg-accent-500 text-white rounded min-h-[44px]">Yes</button>
          <button onClick={() => confirmSchedule(false)} className="text-xs px-3 py-2 bg-ink-100 text-ink-600 rounded min-h-[44px]">No</button>
        </div>
      )}
    </div>
  )
}

