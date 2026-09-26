import { ChevronRight, Search, UtensilsCrossed } from 'lucide-react'
import { isToday, format } from 'date-fns'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useDayData } from '../hooks/useDayData'
import { useUIStore } from '../../../app/store'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel } from '../../../shared/ui'
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

function RailStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-row border border-line bg-surface py-2">
      <span className="text-lead font-bold leading-none tabular-nums text-fg">{value}</span>
      <span className="mt-1 text-micro text-fg-muted">{label}</span>
    </div>
  )
}

export function DayQuickRail({ date, onOpenTasks }: { date: Date; onOpenTasks?: () => void }) {
  const dateStr = formatLocalDate(date)
  const openCommandBar = useUIStore(s => s.openCommandBar)
  const modal = useEntityModal()
  const { data: blocks = [] } = useTimeBlocks(dateStr)
  const { tasks } = useDayData(date)

  const today = isToday(date)

  // Recomputed every render on purpose (no memo): a memo keyed on [blocks]
  // kept showing a block long after it had started.
  const timedBlocks = blocks.filter(b => b.start_time).sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1))
  const nowHM = format(new Date(), 'HH:mm:ss')
  const nextBlock = today
    ? (timedBlocks.find(b => (b.start_time ?? '') >= nowHM) ?? null)
    : (timedBlocks[0] ?? null)

  const openTaskList = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const doneTasks = tasks.filter(t => t.status === 'done').length
  const plannedMin = blocks.reduce((a, b) => a + (b.duration_minutes ?? 0), 0)
  const plannedH = Math.round((plannedMin / 60) * 10) / 10

  return (
    <aside className="hidden flex-col gap-5 rounded-card border border-line bg-surface-2 p-4 xl:flex">
      <div>
        <SectionLabel className="mb-2">Quick actions</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" icon={<UtensilsCrossed />} onClick={() => modal.open({ kind: 'food-log', date: dateStr })}>Log food</Button>
          <Button size="sm" icon={<Search />} onClick={openCommandBar}>Search</Button>
        </div>
      </div>

      <div>
        <SectionLabel className="mb-2">{today ? 'Next up' : 'First up'}</SectionLabel>
        {nextBlock ? (
          <div className="flex items-center gap-3 rounded-row border border-line bg-surface px-3 py-2.5">
            <span className="shrink-0 text-ui font-bold tabular-nums text-accent-600">{nextBlock.start_time?.slice(0, 5)}</span>
            <span className="truncate text-body text-fg-2">{nextBlock.title}</span>
          </div>
        ) : (
          <p className="px-1 text-body text-fg-muted">{today ? 'Nothing more scheduled today.' : 'Nothing scheduled.'}</p>
        )}
      </div>

      <div>
        <SectionLabel className="mb-2">This day</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          <RailStat value={openTaskList.length} label="open" />
          <RailStat value={doneTasks} label="done" />
          <RailStat value={`${plannedH}h`} label="planned" />
        </div>
      </div>

      {/* flex-1: the elastic block, so the rail matches the hero's height. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex items-center justify-between">
          <SectionLabel>Open tasks</SectionLabel>
          {onOpenTasks && (
            <button type="button" onClick={onOpenTasks} className="flex min-h-[44px] items-center gap-0.5 px-1.5 text-meta font-semibold text-accent-600 hover:text-accent-700">
              All <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        {openTaskList.length === 0 ? (
          <p className="px-1 text-body text-fg-muted">Nothing open for this day.</p>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {openTaskList.slice(0, 5).map(t => <ToDoItem key={t.id} task={t} />)}
            {openTaskList.length > 5 && (
              <button type="button" onClick={onOpenTasks} className="min-h-[44px] px-1 text-left text-meta text-fg-muted hover:text-fg">
                +{openTaskList.length - 5} more
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
