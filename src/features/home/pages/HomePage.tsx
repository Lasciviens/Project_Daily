import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useTasksBySection } from '../../todo/hooks/useTodos'
import { WeatherWidget } from '../components/WeatherWidget'
import { RuterWidget } from '../components/RuterWidget'
import { CurrencyWidget } from '../components/CurrencyWidget'
import { NewsWidget } from '../components/NewsWidget'

const NAV_CARDS = [
  { to: '/daily', label: 'Daily',   icon: '📅', desc: 'Tasks, schedule & calendar' },
  { to: '/media', label: 'Media',   icon: '🎬', desc: 'Movies & TV series' },
  { to: '/work',  label: 'Work',    icon: '💼', desc: 'Work tasks & timeline' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function HomePage() {
  const today = useTasksBySection('today')
  const todayTasks = today.data ?? []
  const done = todayTasks.filter(t => t.status === 'done').length
  const open = todayTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-ink-900">
          {greeting()}, Furkan
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">
          {format(new Date(), "EEEE, d MMMM yyyy")}
        </p>
      </div>

      {/* Quick nav cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {NAV_CARDS.map(card => (
          <Link
            key={card.to}
            to={card.to}
            className="group bg-white rounded-xl border border-ink-200 p-4 shadow-sm hover:shadow-md hover:border-accent-300 transition-all duration-150"
          >
            <div className="text-2xl mb-2">{card.icon}</div>
            <div className="text-sm font-semibold text-ink-900 group-hover:text-accent-600 transition-colors duration-150">
              {card.label}
            </div>
            <div className="text-xs text-ink-400 mt-0.5 hidden sm:block">{card.desc}</div>
          </Link>
        ))}
      </div>

      {/* Widgets row 1: Weather | Ruter | Currency */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <WeatherWidget />
        <RuterWidget />
        <CurrencyWidget />
      </div>

      {/* Row 2: Today's tasks summary | News */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Today summary */}
        <div className="bg-white rounded-xl border border-ink-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Today's Tasks</h3>
            <Link to="/daily" className="text-xs text-accent-600 hover:text-accent-700">Open Daily →</Link>
          </div>

          {today.isLoading && <div className="text-ink-400 text-sm">Loading…</div>}

          {!today.isLoading && todayTasks.length === 0 && (
            <div className="text-ink-400 text-sm">No tasks today — enjoy the day!</div>
          )}

          {!today.isLoading && todayTasks.length > 0 && (
            <>
              {/* Progress bar */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-500 rounded-full transition-all duration-300"
                    style={{ width: todayTasks.length ? `${(done / todayTasks.length) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-xs text-ink-500 flex-shrink-0">{done}/{todayTasks.length}</span>
              </div>

              {/* Task list */}
              <ul className="space-y-2">
                {todayTasks.slice(0, 6).map(t => (
                  <li key={t.id} className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      t.status === 'done' ? 'bg-green-400' :
                      t.priority === 'high' ? 'bg-red-400' :
                      t.priority === 'medium' ? 'bg-amber-400' : 'bg-ink-300'
                    }`} />
                    <span className={`text-sm flex-1 truncate ${t.status === 'done' ? 'line-through text-ink-400' : 'text-ink-700'}`}>
                      {t.title}
                    </span>
                    {t.due_time && (
                      <span className="text-xs text-ink-400 flex-shrink-0">{t.due_time.slice(0, 5)}</span>
                    )}
                  </li>
                ))}
              </ul>

              {open > 0 && (
                <div className="mt-3 text-xs text-ink-400">{open} task{open !== 1 ? 's' : ''} remaining</div>
              )}
            </>
          )}
        </div>

        {/* News */}
        <NewsWidget />
      </div>
    </div>
  )
}
