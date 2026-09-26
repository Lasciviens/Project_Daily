import { ChevronRight, Search, UtensilsCrossed } from 'lucide-react'
import { isToday, format } from 'date-fns'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useDayData } from '../hooks/useDayData'
import { useUIStore } from '../../../app/store'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  DayQuickRail — the companion beside the Schedule hero on big monitors
//  (2xl+). Putting the schedule on its own row leaves a big empty horizontal
//  band; rather than blow the timeline up, this fills it with things worth
//  doing from Daily: quick actions, what's next, day stats and a link to all
//  tasks (the open tasks themselves are already in the Tasks column beside
//  it). Hidden below 2xl: at laptop width it squeezed to ~190px.
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
    <aside className="hidden flex-col gap-5 self-start rounded-card border border-line bg-surface-2 p-4 2xl:flex">
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

      {/* The open tasks themselves live in the Tasks column right beside
          this rail, so the rail only links to the full list. */}
      {onOpenTasks && (
        <button type="button" onClick={onOpenTasks} className="-mt-2 flex min-h-[44px] items-center gap-0.5 self-start px-1 text-meta font-semibold text-accent-600 hover:text-accent-700">
          All tasks <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </aside>
  )
}
