import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  format, addDays, parseISO, startOfWeek, endOfWeek, eachDayOfInterval,
  isToday, isPast, differenceInCalendarDays, getISOWeek,
} from 'date-fns'
import { useTasksBySection } from '../../todo/hooks/useTodos'
import { useTimeBlocks, useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { fetchWeather, weatherIcon } from '../api/weatherApi'

const OSLO = { lat: 59.9139, lon: 10.7522 }

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function relativeDay(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date())
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7)   return format(parseISO(dateStr), 'EEE')
  return format(parseISO(dateStr), 'd MMM')
}

/**
 * Home overview — the at-a-glance summary that leads the page: greeting, week
 * strip, compact weather, and the day's headline numbers (tasks, next block,
 * next training session). Self-contained; shares query caches with the widgets.
 */
export function TodaySummary() {
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const { data: tasks = [] }  = useTasksBySection('today')
  const { data: blocks = [] } = useTimeBlocks(todayStr)
  const { data: training = [] } = useTrainingBlocks(todayStr, format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  const { data: weather } = useQuery({
    queryKey: ['weather', 'oslo'],
    queryFn:  () => fetchWeather(OSLO.lat, OSLO.lon),
    staleTime: 10 * 60_000,
  })

  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
  const done = tasks.filter(t => t.status === 'done').length

  const nowHHMM = format(new Date(), 'HH:mm')
  const nextBlock = blocks
    .filter(b => b.start_time && b.start_time.slice(0, 5) >= nowHHMM)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))[0]

  const nextSession = training
    .filter(b => b.date > todayStr || (b.date === todayStr && (b.start_time ?? '99:99') >= nowHHMM))
    .sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')))[0]

  // Week strip
  const days = eachDayOfInterval({
    start: startOfWeek(new Date(), { weekStartsOn: 1 }),
    end:   endOfWeek(new Date(),   { weekStartsOn: 1 }),
  })

  return (
    <div className="bg-white rounded-2xl border border-ink-200 shadow-sm p-5">
      {/* Header row: greeting + compact weather */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-900">{greeting()}, Furkan</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            {format(new Date(), 'EEEE, d MMMM yyyy')} · Week {getISOWeek(new Date())}
          </p>
        </div>
        {weather && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-2xl leading-none">{weatherIcon(weather.current.symbol)}</span>
            <span className="text-lg font-bold text-ink-900">{weather.current.temp}°</span>
          </div>
        )}
      </div>

      {/* Week strip */}
      <div className="flex items-center justify-between mt-4">
        {days.map(day => {
          const isT  = isToday(day)
          const past = !isT && isPast(day)
          return (
            <Link
              key={day.toISOString()}
              to={`/daily?date=${format(day, 'yyyy-MM-dd')}`}
              className="flex flex-col items-center gap-1 group"
            >
              <span className="text-[9px] font-medium uppercase text-ink-400">{format(day, 'EEE')}</span>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                isT  ? 'bg-accent-500 text-white' :
                past ? 'bg-ink-100 text-ink-400'  :
                       'text-ink-700 group-hover:bg-ink-100'
              }`}>{format(day, 'd')}</span>
            </Link>
          )
        })}
      </div>

      {/* At-a-glance chips */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <Link to="/daily" className="rounded-xl bg-ink-50 hover:bg-ink-100 transition-colors p-2.5 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Tasks</p>
          <p className="text-sm font-bold text-ink-900 mt-0.5">
            {open} <span className="font-normal text-ink-400">open</span>
          </p>
          <p className="text-[10px] text-ink-400">{done}/{tasks.length} done</p>
        </Link>

        <Link to="/daily" className="rounded-xl bg-ink-50 hover:bg-ink-100 transition-colors p-2.5 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Next up</p>
          {nextBlock ? (
            <>
              <p className="text-sm font-bold text-ink-900 mt-0.5 truncate">{nextBlock.title}</p>
              <p className="text-[10px] text-ink-400">{nextBlock.start_time!.slice(0, 5)}</p>
            </>
          ) : (
            <p className="text-sm text-ink-400 mt-0.5">Nothing left</p>
          )}
        </Link>

        <Link to="/training" className="rounded-xl bg-ink-50 hover:bg-ink-100 transition-colors p-2.5 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Training</p>
          {nextSession ? (
            <>
              <p className="text-sm font-bold text-ink-900 mt-0.5 truncate">{nextSession.title}</p>
              <p className="text-[10px] text-ink-400">{relativeDay(nextSession.date)}</p>
            </>
          ) : (
            <p className="text-sm text-ink-400 mt-0.5">None planned</p>
          )}
        </Link>
      </div>
    </div>
  )
}
