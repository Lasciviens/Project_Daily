import { useState } from 'react'
import { isToday, format } from 'date-fns'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useDayData } from '../hooks/useDayData'
import { useUIStore } from '../../../app/store'
import { FoodLogModal } from '../../recipes/components/FoodLogModal'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  DayQuickRail — the companion beside the Schedule hero on wide viewports
//  (xl+, covers laptop 1469 and monitor 2450). Putting the schedule on its own
//  row leaves a big empty horizontal band; rather than blow the timeline up,
//  this fills it with things worth doing from Daily: quick actions, what's
//  next, day stats, and the day's open tasks. Hidden below xl
//  (narrow screens have no gap to fill — the hero just goes full width).
// ─────────────────────────────────────────────────────────────────────────────

function StatTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-cream-50 border border-ink-100 py-2">
      <span className="text-lg font-bold text-ink-900 leading-none tabular-nums">{value}</span>
      <span className="text-[10px] text-ink-400 mt-0.5">{label}</span>
    </div>
  )
}

export function DayQuickRail({ date, onOpenTasks }: { date: Date; onOpenTasks?: () => void }) {
  const dateStr = formatLocalDate(date)
  const openCommandBar = useUIStore(s => s.openCommandBar)
  const { data: blocks = [] } = useTimeBlocks(dateStr)
  const { tasks } = useDayData(date)
  const [logOpen, setLogOpen] = useState(false)

  const today = isToday(date)

  // Next scheduled block: on today, the next one starting at/after now; on any
  // other day, simply the first block of the day.
  // Recomputed every render on purpose (no memo): the page re-renders each
  // minute via the header clock, and a memo keyed on [blocks] kept showing a
  // block long after it had started.
  const timedBlocks = blocks.filter(b => b.start_time).sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1))
  const nowHM = format(new Date(), 'HH:mm:ss')
  const nextBlock = today
    ? (timedBlocks.find(b => (b.start_time ?? '') >= nowHM) ?? null)
    : (timedBlocks[0] ?? null)

  const openTaskList = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const openTasks = openTaskList.length
  const doneTasks = tasks.filter(t => t.status === 'done').length
  const plannedMin = blocks.reduce((a, b) => a + (b.duration_minutes ?? 0), 0)
  const plannedH = Math.round((plannedMin / 60) * 10) / 10

  const actionBtn = 'flex items-center gap-2 rounded-lg border border-ink-200 bg-cream-50 px-3 min-h-[40px] text-xs font-medium text-ink-700 hover:border-accent-300 hover:text-accent-700 transition-colors'

  return (
    <aside className="hidden xl:flex flex-col gap-4 rounded-2xl border border-ink-200 bg-ink-100/40 p-4">
      {/* Quick actions */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">Quick actions</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setLogOpen(true)} className={actionBtn}>🍽️ <span>Log food</span></button>
          <button onClick={openCommandBar} className={actionBtn}>🔍 <span>Search ⌘K</span></button>
        </div>
      </div>

      {/* Next up */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">{today ? 'Next up' : 'First up'}</p>
        {nextBlock ? (
          <div className="rounded-lg bg-cream-50 border border-ink-100 px-3 py-2.5 flex items-center gap-3">
            <span className="text-sm font-bold text-accent-600 tabular-nums shrink-0">{nextBlock.start_time?.slice(0, 5)}</span>
            <span className="text-xs text-ink-700 truncate">{nextBlock.title}</span>
          </div>
        ) : (
          <p className="text-xs text-ink-400 px-1">{today ? 'Nothing more scheduled today.' : 'Nothing scheduled.'}</p>
        )}
      </div>

      {/* Day stats */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">This day</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile value={openTasks} label="open" />
          <StatTile value={doneTasks} label="done" />
          <StatTile value={`${plannedH}h`} label="planned" />
        </div>
      </div>

      {/* Open tasks — the day's actionable list, visible without switching
          tabs (was the "Jump to" nav grid, removed on user request: tasks are
          worth this space, duplicate navigation wasn't). flex-1 makes this the
          elastic block, so the rail always matches the hero's height instead
          of ending short (equal-height aesthetics). */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400">Open tasks</p>
          {onOpenTasks && (
            <button onClick={onOpenTasks} className="text-[11px] text-accent-600 hover:text-accent-700 font-medium min-h-[32px] px-1">
              All →
            </button>
          )}
        </div>
        {openTaskList.length === 0 ? (
          <p className="text-xs text-ink-400 px-1">Nothing open for this day.</p>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {openTaskList.slice(0, 5).map(t => <ToDoItem key={t.id} task={t} />)}
            {openTaskList.length > 5 && (
              <button onClick={onOpenTasks} className="text-[11px] text-ink-400 hover:text-ink-700 text-left px-1 min-h-[32px]">
                +{openTaskList.length - 5} more…
              </button>
            )}
          </div>
        )}
      </div>

      <FoodLogModal open={logOpen} onClose={() => setLogOpen(false)} date={dateStr} />
    </aside>
  )
}
