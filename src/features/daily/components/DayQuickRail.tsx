import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isToday, format } from 'date-fns'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useDayData } from '../hooks/useDayData'
import { useUIStore } from '../../../app/store'
import { FoodLogModal } from '../../recipes/components/FoodLogModal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  DayQuickRail — the companion beside the Schedule hero on wide viewports
//  (xl+, covers laptop 1469 and monitor 2450). Putting the schedule on its own
//  row leaves a big empty horizontal band; rather than blow the timeline up,
//  this fills it with things worth doing from Daily: quick actions, what's
//  next, day stats, and one-tap jumps into the other areas. Hidden below xl
//  (narrow screens have no gap to fill — the hero just goes full width).
// ─────────────────────────────────────────────────────────────────────────────

const JUMP: { to: string; icon: string; label: string }[] = [
  { to: '/work',     icon: '💼', label: 'Work' },
  { to: '/training', icon: '💪', label: 'Training' },
  { to: '/media',    icon: '🎬', label: 'Media' },
  { to: '/shop',     icon: '🛒', label: 'Shop' },
  { to: '/projects', icon: '🗂️', label: 'Projects' },
  { to: '/games',    icon: '🎮', label: 'Games' },
]

function StatTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-cream-50 border border-ink-100 py-2">
      <span className="text-lg font-bold text-ink-900 leading-none tabular-nums">{value}</span>
      <span className="text-[10px] text-ink-400 mt-0.5">{label}</span>
    </div>
  )
}

export function DayQuickRail({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)
  const openCommandBar = useUIStore(s => s.openCommandBar)
  const { data: blocks = [] } = useTimeBlocks(dateStr)
  const { tasks } = useDayData(date)
  const [logOpen, setLogOpen] = useState(false)

  const today = isToday(date)

  // Next scheduled block: on today, the next one starting at/after now; on any
  // other day, simply the first block of the day.
  const nextBlock = useMemo(() => {
    const timed = blocks.filter(b => b.start_time).sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1))
    if (!today) return timed[0] ?? null
    const nowHM = format(new Date(), 'HH:mm:ss')
    return timed.find(b => (b.start_time ?? '') >= nowHM) ?? null
  }, [blocks, today])

  const openTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
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

      {/* Jump to */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">Jump to</p>
        <div className="grid grid-cols-3 gap-2">
          {JUMP.map(j => (
            <Link key={j.to} to={j.to}
              className="flex flex-col items-center justify-center gap-1 rounded-lg bg-cream-50 border border-ink-100 py-2.5 hover:border-accent-300 transition-colors">
              <span className="text-lg leading-none">{j.icon}</span>
              <span className="text-[10px] text-ink-500">{j.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <FoodLogModal open={logOpen} onClose={() => setLogOpen(false)} date={dateStr} />
    </aside>
  )
}
