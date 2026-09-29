import { ChevronRight, Search, UtensilsCrossed } from 'lucide-react'
import { isToday, format } from 'date-fns'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useDayData } from '../hooks/useDayData'
import { useUIStore } from '../../../app/store'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Truncate } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  DayQuickRail — the companion to the Schedule hero on wide pages: quick
//  actions, what's next, day stats and a link to all tasks (the open tasks
//  themselves are already in the Tasks column of the hero). Daily's PageBoard
//  places it (dailyBoards.ts): a side column beside the hero at 1920px, one
//  strip under the hero at 2450px — it lays itself out by its OWN width
//  (a column below 40rem, three blocks in a row above). Not shown on phones,
//  tablets or the 1469 laptop, where it would squeeze beside the hero.
// ─────────────────────────────────────────────────────────────────────────────

const NEXT_SHOWN = 3

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
  // The next three, so the rail has something to say beside a tall hero.
  const nextBlocks = (today ? timedBlocks.filter(b => (b.start_time ?? '') >= nowHM) : timedBlocks).slice(0, NEXT_SHOWN)

  const openTaskList = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const doneTasks = tasks.filter(t => t.status === 'done').length
  const plannedMin = blocks.reduce((a, b) => a + (b.duration_minutes ?? 0), 0)
  const plannedH = Math.round((plannedMin / 60) * 10) / 10

  return (
    <aside aria-label="Day overview" className="@container rounded-card border border-line bg-surface-2 p-4">
      <div className="flex flex-col gap-5 @[40rem]:grid @[40rem]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,15rem)] @[40rem]:items-start @[40rem]:gap-5">
        <div>
          <SectionLabel className="mb-2">Quick actions</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" icon={<UtensilsCrossed />} onClick={() => modal.open({ kind: 'food-log', date: dateStr })}>Log food</Button>
            <Button size="sm" icon={<Search />} onClick={openCommandBar}>Search</Button>
          </div>
        </div>

        <div>
          <SectionLabel className="mb-2">{today ? 'Next up' : 'First up'}</SectionLabel>
          {nextBlocks.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {nextBlocks.map(b => (
                <li key={b.id} className="flex items-center gap-3 rounded-row border border-line bg-surface px-3 py-2.5">
                  <span className="shrink-0 text-ui font-bold tabular-nums text-accent-600">{b.start_time?.slice(0, 5)}</span>
                  <Truncate className="text-body text-fg-2">{b.title}</Truncate>
                </li>
              ))}
            </ul>
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
          {/* The open tasks themselves live in the hero's Tasks column, so the
              rail only links to the full list. */}
          {onOpenTasks && (
            <button type="button" onClick={onOpenTasks} className="mt-1 flex min-h-[44px] items-center gap-0.5 px-1 text-meta font-semibold text-accent-600 hover:text-accent-700">
              All tasks <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
