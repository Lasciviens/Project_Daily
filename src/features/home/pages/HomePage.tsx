import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useTasksBySection } from '../../todo/hooks/useTodos'
import { WeatherWidget } from '../components/WeatherWidget'
import { RuterWidget } from '../components/RuterWidget'
import { CurrencyWidget } from '../components/CurrencyWidget'
import { NewsWidget } from '../components/NewsWidget'
import { TrainingHomeWidget } from '../components/TrainingHomeWidget'

interface NavCard {
  to:    string
  label: string
  icon:  string
  desc:  string
}

const NAV_CARDS: NavCard[] = [
  { to: '/daily',    label: 'Daily',    icon: '📅', desc: 'Tasks & schedule' },
  { to: '/media',    label: 'Media',    icon: '🎬', desc: 'Movies & TV' },
  { to: '/work',     label: 'Work',     icon: '💼', desc: 'Work tasks' },
  { to: '/training', label: 'Training', icon: '🏋️', desc: 'Workouts & health' },
  { to: '/projects', label: 'Projects', icon: '🗂️', desc: 'Projects & phases' },
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function HomePage() {
  const today     = useTasksBySection('today')
  const tasks     = today.data ?? []
  const done      = tasks.filter(t => t.status === 'done').length
  const open      = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
  const progress  = tasks.length > 0 ? (done / tasks.length) * 100 : 0

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col xl:flex-row xl:items-start gap-3 sm:gap-4 p-3 sm:p-4 xl:p-5 overflow-x-hidden">
      <div className="w-full xl:w-[280px] xl:flex-shrink-0 space-y-3 sm:space-y-4">
        <CurrencyWidget />
        <TrainingHomeWidget />
      </div>

      <div className="flex-1 min-w-0 space-y-3 sm:space-y-4">
        <div className="pt-1">
          <h1 className="text-lg sm:text-xl font-bold text-ink-900">{greeting()}, Furkan</h1>
          <p className="text-xs text-ink-400 mt-0.5">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {NAV_CARDS.map(card => (
            <Link
              key={card.to}
              to={card.to}
              className="group bg-white rounded-xl border border-ink-200 p-3 shadow-sm hover:shadow-md hover:border-accent-300 transition-all duration-150 min-h-[88px] flex flex-col justify-center"
            >
              <div className="text-xl mb-1.5">{card.icon}</div>
              <div className="text-sm font-semibold text-ink-900 group-hover:text-accent-600 transition-colors duration-150 truncate">
                {card.label}
              </div>
              <div className="text-xs text-ink-400 mt-0.5 hidden sm:block leading-tight">{card.desc}</div>
            </Link>
          ))}
        </div>

        <WeatherWidget />
        <RuterWidget />
        <TodayTasksWidget tasks={tasks} done={done} open={open} progress={progress} isLoading={today.isLoading} />
      </div>

      <div className="w-full xl:w-[380px] xl:flex-shrink-0">
        <NewsWidget />
      </div>
    </div>
  )
}

interface TodayTasksProps {
  tasks:     ReturnType<typeof useTasksBySection>['data'] extends undefined ? never : NonNullable<ReturnType<typeof useTasksBySection>['data']>
  done:      number
  open:      number
  progress:  number
  isLoading: boolean
}

function TodayTasksWidget({ tasks, done, open, progress, isLoading }: TodayTasksProps) {
  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Today's Tasks</h3>
        <Link to="/daily" className="min-h-[44px] flex items-center text-xs text-accent-600 hover:text-accent-700">Open Daily →</Link>
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
            {tasks.slice(0, 6).map(t => (
              <li key={t.id} className="flex items-center gap-2.5 min-h-[32px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  t.status === 'done'     ? 'bg-green-400' :
                  t.priority === 'high'   ? 'bg-red-400'   :
                  t.priority === 'medium' ? 'bg-amber-400'  : 'bg-ink-300'
                }`} />
                <span className={`text-sm flex-1 min-w-0 truncate ${
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
