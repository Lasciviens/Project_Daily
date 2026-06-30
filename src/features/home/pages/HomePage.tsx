import { useState, useRef, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isPast } from 'date-fns'
import { useTasksBySection } from '../../todo/hooks/useTodos'
import { useCreateTask } from '../../todo/hooks/useTodos'
import { useTimeBlocks } from '../../daily/hooks/useSchedule'
import type { Task } from '../../todo/types'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { WeatherWidget } from '../components/WeatherWidget'
import { RuterWidget } from '../components/RuterWidget'
import { CurrencyWidget } from '../components/CurrencyWidget'
import { NewsWidget } from '../components/NewsWidget'
import { TrainingHomeWidget } from '../components/TrainingHomeWidget'
import { GamesHomeWidget } from '../components/GamesHomeWidget'
import { ProjectsHomeWidget } from '../components/ProjectsHomeWidget'
import { RecentMediaWidget } from '../components/RecentMediaWidget'

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
     *   Left  (280px) : Currency + Training + Games
     *   Center (flex) : Greeting + Week + Nav + Weather + Schedule + Ruter + Tasks
     *   Right  (380px): News + Recent Media
     * On <1280px: right panel drops below center
     * On <768px : all single column
     */
    <div className="min-h-[calc(100vh-56px)] flex flex-col xl:flex-row xl:items-start gap-4 p-4 xl:p-5">

      {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
      <div className="w-full xl:w-[280px] xl:flex-shrink-0 space-y-4">
        <CurrencyWidget />
        <ProjectsHomeWidget />
        <TrainingHomeWidget />
        <GamesHomeWidget />
      </div>

      {/* ── CENTER COLUMN ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Greeting + week strip */}
        <div className="pt-1">
          <h1 className="text-xl font-bold text-ink-900">{greeting()}, Furkan</h1>
          <p className="text-xs text-ink-400 mt-0.5">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
        </div>

        {/* Week progress strip */}
        <WeekStrip />

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
      <div className="w-full xl:w-[380px] xl:flex-shrink-0 space-y-4">
        <NewsWidget />
        <RecentMediaWidget />
      </div>

      <UnifiedPlanModal
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        config={{ tabs: ['task', 'schedule'], heading: 'Edit Task' }}
        task={editingTask ?? undefined}
      />
    </div>
  )
}

// ─── Week strip ───────────────────────────────────────────────────────────────

function WeekStrip() {
  const now   = new Date()
  const start = startOfWeek(now, { weekStartsOn: 1 })
  const end   = endOfWeek(now,   { weekStartsOn: 1 })
  const days  = eachDayOfInterval({ start, end })

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm px-4 py-3">
      <div className="flex items-center justify-between">
        {days.map(day => {
          const isT  = isToday(day)
          const past = !isT && isPast(day)
          return (
            <Link
              key={day.toISOString()}
              to={`/daily?date=${format(day, 'yyyy-MM-dd')}`}
              className="flex flex-col items-center gap-1 group"
            >
              <span className="text-[9px] font-medium uppercase text-ink-400">
                {format(day, 'EEE')}
              </span>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors duration-150 ${
                isT  ? 'bg-accent-500 text-white' :
                past ? 'bg-ink-100 text-ink-400'  :
                       'text-ink-700 group-hover:bg-ink-100'
              }`}>
                {format(day, 'd')}
              </span>
            </Link>
          )
        })}
      </div>
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
  const [quickTitle, setQuickTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateTask()

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !quickTitle.trim()) return
    const title = quickTitle.trim()
    setQuickTitle('')
    create.mutate({
      title,
      section:  'today',
      domain:   'personal',
      priority: 'medium',
    })
  }

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Today's Tasks</h3>
        <Link to="/daily" className="text-xs text-accent-600 hover:text-accent-700">Open Daily →</Link>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}

      {!isLoading && tasks.length === 0 && (
        <div className="text-ink-400 text-sm mb-3">No tasks today — enjoy the day!</div>
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

          <ul className="space-y-2 mb-3">
            {tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').slice(0, 6).map(t => (
              <li
                key={t.id}
                onClick={() => onEdit(t)}
                className="flex items-center gap-2.5 cursor-pointer rounded-lg px-1 -mx-1 py-2 min-h-[44px] hover:bg-ink-50 transition-colors duration-150"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  t.status === 'done'     ? 'bg-green-400' :
                  t.priority === 'high'   ? 'bg-red-400'   :
                  t.priority === 'medium' ? 'bg-accent-400'  : 'bg-ink-300'
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

          {open > 6 && (
            <div className="mb-3 text-xs text-ink-400">{open} tasks remaining</div>
          )}
        </>
      )}

      {/* Quick-add inline input */}
      <div className="flex items-center gap-2 border-t border-ink-100 pt-3 mt-1">
        <input
          ref={inputRef}
          value={quickTitle}
          onChange={e => setQuickTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Quick add task… (Enter to save)"
          disabled={create.isPending}
          className="flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white placeholder:text-ink-300 disabled:opacity-50 min-h-[44px]"
        />
      </div>
    </div>
  )
}
