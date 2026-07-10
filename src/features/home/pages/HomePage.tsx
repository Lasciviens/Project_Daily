import { useState, useRef, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTasksForDay, useCreateTask } from '../../todo/hooks/useTodos'
import { useTimeBlocks } from '../../daily/hooks/useSchedule'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { Task } from '../../todo/types'
import { DOMAIN_TAG_CLASS, DOMAIN_LABEL } from '../../todo/domainColors'
import { completedWithinLast24h } from '../../todo/taskRules'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { DailyBriefing } from '../components/DailyBriefing'
import { TodaySummary } from '../components/TodaySummary'
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NAV_CARDS: NavCard[] = [
  { to: '/daily',    label: 'Daily',    icon: '📅' },
  { to: '/media',    label: 'Media',    icon: '🎬' },
  { to: '/work',     label: 'Work',     icon: '💼' },
  { to: '/training', label: 'Training', icon: '🏋️' },
  { to: '/games',    label: 'Games',    icon: '🎮' },
  { to: '/projects', label: 'Projects', icon: '📋' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function HomePage() {
  // Same date-scoped query Daily uses — section='today' AND due today (or
  // undated), rather than every task ever filed into the 'today' bucket.
  const today        = useTasksForDay(new Date(), 'today')
  const allTasks      = today.data ?? []
  const doneTasks     = allTasks.filter(t => t.status === 'done' && completedWithinLast24h(t.updated_at))
  const tasks         = allTasks.filter(t => t.status !== 'done' || completedWithinLast24h(t.updated_at))
  const done          = doneTasks.length
  const open          = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
  // Progress denominator excludes cancelled tasks (they're not rendered in the
  // visible list either) — including them understated progress and made the
  // done/total label inconsistent with what's actually shown.
  const countable     = tasks.filter(t => t.status !== 'cancelled')
  const progress      = countable.length > 0 ? (done / countable.length) * 100 : 0
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

      {/* Mobile-only lead: morning briefing + weather, in that order, ahead
          of everything else. Below xl the 3-column layout drops to a
          single DOM-ordered stack (Left col → Center col → Right col), which
          buried these two behind Currency/Projects/Training/Games — moved
          here instead of reshuffling the desktop columns themselves. */}
      <div className="xl:hidden space-y-4">
        <DailyBriefing />
        <WeatherWidget />
      </div>

      {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
      <div className="w-full xl:w-[280px] xl:flex-shrink-0 space-y-4">
        <CurrencyWidget />
        <ProjectsHomeWidget />
        <TrainingHomeWidget />
        <GamesHomeWidget />
      </div>

      {/* ── CENTER COLUMN ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* AI morning briefing — leads the page on desktop; mobile gets its
            own copy above (see the xl:hidden block) instead of this one. */}
        <div className="hidden xl:block">
          <DailyBriefing />
        </div>

        {/* Overview summary */}
        <TodaySummary />

        {/* Quick nav — compact pills, all six fit on one row from sm+ */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {NAV_CARDS.map(card => (
            <Link
              key={card.to}
              to={card.to}
              className="group flex items-center justify-center gap-1.5 bg-white rounded-lg border border-ink-200 px-2 min-h-[44px] shadow-sm hover:shadow-md hover:border-accent-300 transition-shadow duration-150 press-feedback"
            >
              <span className="text-base leading-none">{card.icon}</span>
              <span className="text-xs font-semibold text-ink-800 group-hover:text-accent-600 transition-colors duration-150 truncate">
                {card.label}
              </span>
            </Link>
          ))}
        </div>

        {/* Today's schedule */}
        <TodayScheduleWidget />

        {/* Weather + transit side-by-side on desktop; mobile shows Weather
            separately up top (see the xl:hidden block above), Ruter still
            flows here either way. Grid breakpoint matches the xl cutoff
            used for Weather's visibility so there's no leftover empty
            column at in-between widths. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <div className="hidden xl:block">
            <WeatherWidget />
          </div>
          <RuterWidget />
        </div>

        {/* Today's tasks */}
        <TodayTasksWidget tasks={tasks} done={done} total={countable.length} open={open} progress={progress} isLoading={today.isLoading} onEdit={setEditingTask} />
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

// ─── Today's Schedule sub-widget ─────────────────────────────────────────────

function TodayScheduleWidget() {
  const { data: blocks = [], isLoading } = useTimeBlocks(todayStr())
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
  tasks:     Task[]
  done:      number
  total:     number   // done/total denominator — excludes cancelled tasks
  open:      number
  progress:  number
  isLoading: boolean
  onEdit:    (task: Task) => void
}

function TodayTasksWidget({ tasks, done, total, open, progress, isLoading, onEdit }: TodayTasksProps) {
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

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-cream-200 animate-pulse" />
          ))}
        </div>
      )}

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
            <span className="text-xs text-ink-500 flex-shrink-0">{done}/{total}</span>
          </div>

          <ul className="space-y-1 mb-3">
            {tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').slice(0, 5).map(t => (
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
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${DOMAIN_TAG_CLASS[t.domain]}`}>
                  {DOMAIN_LABEL[t.domain]}
                </span>
                {t.due_time && (
                  <span className="text-xs text-ink-400 flex-shrink-0 font-mono">{t.due_time.slice(0, 5)}</span>
                )}
              </li>
            ))}
          </ul>

          {open > 5 && (
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
