import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useTasksBySection } from '../../todo/hooks/useTodos'
import { useTimeBlocks } from '../../daily/hooks/useSchedule'
import type { Task } from '../../todo/types'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'
import { WeatherWidget } from '../components/WeatherWidget'
import { RuterWidget } from '../components/RuterWidget'
import { CurrencyWidget } from '../components/CurrencyWidget'
import { NewsWidget } from '../components/NewsWidget'
import { TrainingHomeWidget } from '../components/TrainingHomeWidget'
import { GamesHomeWidget } from '../components/GamesHomeWidget'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavCard {
  to:    string
  label: string
  icon:  string
  desc:  string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NAV_CARDS: NavCard[] = [
  { to: '/daily',    label: 'Daily',    icon: '📅', desc: 'Tasks, schedule & calendar' },
  { to: '/media',    label: 'Media',    icon: '🎬', desc: 'Movies & TV series' },
  { to: '/work',     label: 'Work',     icon: '💼', desc: 'Work tasks & timeline' },
  { to: '/training', label: 'Training', icon: '🏋️', desc: 'Workouts & health' },
  { to: '/games',    label: 'Games',    icon: '🎮', desc: 'RP5 library — coming soon' },
  { to: '/projects', label: 'Projects', icon: '📋', desc: 'Track project progress' },
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HomePage() {
  const today        = useTasksBySection('today')
  const tasks        = today.data ?? []
  const done         = tasks.filter(t => t.status === 'done').length
  const open         = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
  const progress     = tasks.length > 0 ? (done / tasks.length) * 100 : 0
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  return (
    /*
     * Layout: 3-column grid on ≥1280px
     *   Left  (280px) : Currency
     *   Center (flex) : Greeting + Nav + Weather + RUTER + Tasks
     *   Right  (380px): News
     * On <1280px: right panel drops below center
     * On <768px : all single column
     */
    <div className="min-h-[calc(100vh-56px)] flex flex-col xl:flex-row xl:items-start gap-4 p-4 xl:p-5">

      {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
      <div className="w-full xl:w-[280px] xl:flex-shrink-0 space-y-4">
        <CurrencyWidget />
        <TrainingHomeWidget />
        <GamesHomeWidget />
      </div>

      {/* ── CENTER COLUMN ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Greeting */}
        <div className="pt-1">
          <h1 className="text-xl font-bold text-ink-900">{greeting()}, Furkan</h1>
          <p className="text-xs text-ink-400 mt-0.5">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
        </div>

        {/* Quick nav cards — 2-col on mobile, 3-col on sm+ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {NAV_CARDS.map(card => (
            <Link
              key={card.to}
              to={card.to}
              className="group bg-white rounded-xl border border-ink-200 p-3 shadow-sm hover:shadow-md hover:border-accent-300 transition-shadow duration-150 min-h-[44px]"
            >
              <div className="text-xl mb-1.5">{card.icon}</div>
              <div className="text-sm font-semibold text-ink-900 group-hover:text-accent-600 transition-colors duration-150">
                {card.label}
              </div>
              <div className="text-xs text-ink-400 mt-0.5 hidden sm:block leading-tight">{card.desc}</div>
            </Link>
          ))}
        </div>

        {/* Weather */}
        <WeatherWidget />

        {/* Today's schedule */}
        <TodayScheduleWidget />

        {/* RUTER */}
        <RuterWidget />

        {/* Today's tasks */}
        <TodayTasksWidget tasks={tasks} done={done} open={open} progress={progress} isLoading={today.isLoading} onEdit={setEditingTask} />
      </div>

      {/* ── RIGHT COLUMN ────────────────────────────────────────────────── */}
      <div className="w-full xl:w-[380px] xl:flex-shrink-0">
        <NewsWidget />
      </div>

      <AddTaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        task={editingTask ?? undefined}
      />
    </div>
  )
}

// ─── Today's Schedule sub-widget ─────────────────────────────────────────────

function TodayScheduleWidget() {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const { data: blocks = [], isLoading } = useTimeBlocks(todayStr)
  const visible = blocks.filter(b => b.start_time)

  if (isLoading || visible.length === 0) return null

  function fmtTime(t: string) {
    const [h, m] = t.split(':')
    return `${h}:${m}`
  }

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Day Schedule</h3>
        <Link to="/daily" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>
      <div className="space-y-1.5">
        {visible.map(b => (
          <div key={b.id} className="flex items-center gap-2.5">
            <span className="text-[11px] text-ink-400 w-10 flex-shrink-0 font-mono">{fmtTime(b.start_time!)}</span>
            <span className="flex-1 text-sm text-ink-700 truncate">{b.title}</span>
            {b.duration_minutes >= 30 && (
              <span className="text-[10px] text-ink-300 flex-shrink-0">
                {b.duration_minutes >= 60
                  ? `${Math.floor(b.duration_minutes / 60)}h${b.duration_minutes % 60 ? `${b.duration_minutes % 60}m` : ''}`
                  : `${b.duration_minutes}m`}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Today's Tasks sub-widget ─────────────────────────────────────────────────

interface TodayTasksProps {
  tasks:     ReturnType<typeof useTasksBySection>['data'] extends undefined ? never : NonNullable<ReturnType<typeof useTasksBySection>['data']>
  done:      number
  open:      number
  progress:  number
  isLoading: boolean
  onEdit:    (task: Task) => void
}

function TodayTasksWidget({ tasks, done, open, progress, isLoading, onEdit }: TodayTasksProps) {
  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Today's Tasks</h3>
        <Link to="/daily" className="text-xs text-accent-600 hover:text-accent-700">Open Daily →</Link>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}

      {!isLoading && tasks.length === 0 && (
        <div className="text-ink-400 text-sm">No tasks today — enjoy the day!</div>
      )}

      {!isLoading && tasks.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-ink-500 flex-shrink-0">{done}/{tasks.length}</span>
          </div>

          <ul className="space-y-2">
            {tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').slice(0, 6).map(t => (
              <li
                key={t.id}
                onClick={() => onEdit(t)}
                className="flex items-center gap-2.5 cursor-pointer rounded-lg px-1 -mx-1 py-0.5 hover:bg-ink-50 transition-colors duration-150"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  t.status === 'done'     ? 'bg-green-400' :
                  t.priority === 'high'   ? 'bg-red-400'   :
                  t.priority === 'medium' ? 'bg-amber-400'  : 'bg-ink-300'
                }`} />
                <span className={`text-sm flex-1 truncate ${
                  t.status === 'done' ? 'line-through text-ink-400' : 'text-ink-700'
                }`}>
                  {t.title}
                </span>
                {t.due_time && (
                  <span className="text-xs text-ink-400 flex-shrink-0">{t.due_time.slice(0, 5)}</span>
                )}
              </li>
            ))}
          </ul>

          {open > 0 && (
            <div className="mt-2 text-xs text-ink-400">{open} task{open !== 1 ? 's' : ''} remaining</div>
          )}
        </>
      )}
    </div>
  )
}
