import { useState, useMemo } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useStravaActivities } from '../hooks/useStravaActivities'
import type { HevyWorkout, StravaActivity } from '../types.hevy'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(iso: string): string {
  return iso.slice(0, 10)
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getWorkoutDuration(w: HevyWorkout): number | null {
  if (!w.start_time || !w.end_time) return null
  const diff = new Date(w.end_time).getTime() - new Date(w.start_time).getTime()
  return Math.round(diff / 60_000)
}

function stravaIcon(type: StravaActivity['type']): string {
  switch (type) {
    case 'run':     return '🏃'
    case 'cycling': return '🚴'
    case 'swim':    return '🏊'
    case 'walk':    return '🚶'
    case 'yoga':    return '🧘'
    default:        return '⚡'
  }
}

function formatDistance(meters: number | null): string {
  if (!meters) return ''
  if (meters >= 1000) return ` ${(meters / 1000).toFixed(1)} km`
  return ` ${meters} m`
}

// ─── Week View ────────────────────────────────────────────────────────────────

interface DayData {
  date: Date
  workouts: HevyWorkout[]
  activities: StravaActivity[]
}

interface DayCellProps {
  day: DayData
  isToday: boolean
  selectedDate: string | null
  onSelect: (d: string) => void
}

function WeekDayCell({ day, isToday, selectedDate, onSelect }: DayCellProps) {
  const dateStr = toDateStr(day.date.toISOString())
  const isSelected = selectedDate === dateStr

  return (
    <div
      className={`flex flex-col gap-1.5 min-h-[60px] p-1.5 rounded-xl border transition-colors cursor-pointer ${
        isSelected
          ? 'border-accent-400 bg-accent-50'
          : isToday
          ? 'border-accent-200 bg-accent-50/50'
          : 'border-ink-100 bg-white hover:border-ink-200'
      }`}
      onClick={() => onSelect(isSelected ? '' : dateStr)}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-ink-500 uppercase">{formatDayLabel(day.date)}</span>
        <span className={`text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center ${
          isToday ? 'bg-accent-600 text-white' : 'text-ink-600'
        }`}>
          {day.date.getDate()}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {day.workouts.map(w => {
          const dur = getWorkoutDuration(w)
          return (
            <div
              key={w.id}
              className="rounded px-1.5 py-0.5 bg-accent-100 text-accent-800 text-[10px] font-medium leading-tight truncate"
              title={w.title}
            >
              {w.title}{dur ? ` · ${dur}m` : ''}
            </div>
          )
        })}

        {day.activities.map(a => (
          <div
            key={a.id}
            className="rounded px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-medium leading-tight truncate"
            title={a.title}
          >
            {stravaIcon(a.type)}{formatDistance(a.distance_meters)}
          </div>
        ))}
      </div>
    </div>
  )
}

interface WeekViewProps {
  weekStart: Date
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  today: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSwitchToMonth: () => void
}

function WeekView({ weekStart, workouts, activities, today, onPrev, onNext, onToday, onSwitchToMonth }: WeekViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const days: DayData[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i)
      const dateStr = toDateStr(date.toISOString())
      return {
        date,
        workouts: workouts.filter(w => toDateStr(w.hevy_created_at) === dateStr),
        activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === dateStr),
      }
    })
  }, [weekStart, workouts, activities])

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`

  const selectedDay = selectedDate
    ? days.find(d => toDateStr(d.date.toISOString()) === selectedDate)
    : null

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-500 hover:bg-cream-50 transition-colors"
          >
            ←
          </button>
          <span className="text-sm font-semibold text-ink-700 min-w-[160px] text-center">{weekLabel}</span>
          <button
            type="button"
            onClick={onNext}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-500 hover:bg-cream-50 transition-colors"
          >
            →
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToday}
            className="min-h-[44px] px-3 border border-ink-200 rounded-xl text-sm text-ink-600 hover:bg-cream-50 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onSwitchToMonth}
            className="min-h-[44px] px-3 border border-ink-200 rounded-xl text-sm text-ink-600 hover:bg-cream-50 transition-colors"
          >
            Month
          </button>
        </div>
      </div>

      {/* 7-day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(day => (
          <WeekDayCell
            key={day.date.toISOString()}
            day={day}
            isToday={isSameDay(day.date, today)}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
          />
        ))}
      </div>

      {/* Detail panel */}
      {selectedDay && (selectedDay.workouts.length > 0 || selectedDay.activities.length > 0) && (
        <div className="border border-ink-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-800">
            {selectedDay.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>

          {selectedDay.workouts.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-600 mb-1.5">Hevy Workouts</p>
              <div className="flex flex-col gap-2">
                {selectedDay.workouts.map(w => {
                  const dur = getWorkoutDuration(w)
                  return (
                    <div key={w.id} className="flex items-center justify-between gap-2 p-2.5 bg-accent-50 border border-accent-100 rounded-lg">
                      <span className="text-sm font-medium text-ink-900">{w.title}</span>
                      {dur && <span className="text-xs text-accent-600 shrink-0">{dur} min</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedDay.activities.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-1.5">Strava</p>
              <div className="flex flex-col gap-2">
                {selectedDay.activities.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <span className="text-sm font-medium text-ink-900">{stravaIcon(a.type)} {a.title}</span>
                    {a.distance_meters && (
                      <span className="text-xs text-blue-600 shrink-0">{(a.distance_meters / 1000).toFixed(2)} km</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  year: number
  month: number   // 0-based
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  today: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSwitchToWeek: () => void
}

function MonthView({ year, month, workouts, activities, today, onPrevMonth, onNextMonth, onToday, onSwitchToWeek }: MonthViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(year, month, 1)
    const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    // Mon-start: 0=Mon … 6=Sun
    const startDow = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // build cells array, pad with nulls at start
    const cells: (Date | null)[] = [
      ...Array(startDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ]
    // pad end to complete last row
    while (cells.length % 7 !== 0) cells.push(null)
    return { cells, monthLabel }
  }, [year, month])

  const workoutDates = useMemo(() => new Set(workouts.map(w => toDateStr(w.hevy_created_at))), [workouts])
  const activityDates = useMemo(() => new Set(activities.filter(a => a.start_date).map(a => toDateStr(a.start_date!))), [activities])

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null
    return {
      date: new Date(selectedDate + 'T12:00:00'),
      workouts: workouts.filter(w => toDateStr(w.hevy_created_at) === selectedDate),
      activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === selectedDate),
    }
  }, [selectedDate, workouts, activities])

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevMonth}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-500 hover:bg-cream-50 transition-colors"
          >
            ←
          </button>
          <span className="text-sm font-semibold text-ink-700 min-w-[160px] text-center">{monthLabel}</span>
          <button
            type="button"
            onClick={onNextMonth}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-500 hover:bg-cream-50 transition-colors"
          >
            →
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToday}
            className="min-h-[44px] px-3 border border-ink-200 rounded-xl text-sm text-ink-600 hover:bg-cream-50 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onSwitchToWeek}
            className="min-h-[44px] px-3 border border-ink-200 rounded-xl text-sm text-ink-600 hover:bg-cream-50 transition-colors"
          >
            Week
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-[10px] font-bold text-ink-500 uppercase text-center py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="aspect-square" />
          }
          const dateStr = toDateStr(date.toISOString())
          const hasWorkout = workoutDates.has(dateStr)
          const hasActivity = activityDates.has(dateStr)
          const isToday = isSameDay(date, today)
          const isSelected = selectedDate === dateStr

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              className={`aspect-square flex flex-col items-center justify-start pt-1 rounded-lg border transition-colors min-h-[44px] ${
                isSelected
                  ? 'border-accent-400 bg-accent-50'
                  : isToday
                  ? 'border-accent-200 bg-accent-50/50'
                  : 'border-transparent hover:border-ink-200 hover:bg-cream-50'
              }`}
            >
              <span className={`text-xs font-semibold ${
                isToday ? 'text-accent-700' : 'text-ink-700'
              }`}>
                {date.getDate()}
              </span>
              <div className="flex gap-0.5 mt-0.5">
                {hasWorkout && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
                {hasActivity && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[11px] text-ink-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-500 inline-block" /> Hevy workout</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Strava</span>
      </div>

      {/* Day detail */}
      {selectedDay && (selectedDay.workouts.length > 0 || selectedDay.activities.length > 0) && (
        <div className="border border-ink-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-800">
            {selectedDay.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>

          {selectedDay.workouts.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-600 mb-1.5">Hevy Workouts</p>
              <div className="flex flex-col gap-2">
                {selectedDay.workouts.map(w => {
                  const dur = getWorkoutDuration(w)
                  return (
                    <div key={w.id} className="flex items-center justify-between gap-2 p-2.5 bg-accent-50 border border-accent-100 rounded-lg">
                      <span className="text-sm font-medium text-ink-900">{w.title}</span>
                      {dur && <span className="text-xs text-accent-600 shrink-0">{dur} min</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedDay.activities.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-1.5">Strava</p>
              <div className="flex flex-col gap-2">
                {selectedDay.activities.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <span className="text-sm font-medium text-ink-900">{stravaIcon(a.type)} {a.title}</span>
                    {a.distance_meters && (
                      <span className="text-xs text-blue-600 shrink-0">{(a.distance_meters / 1000).toFixed(2)} km</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── TrainingCalendar (top-level) ─────────────────────────────────────────────

type CalView = 'week' | 'month'

export function TrainingCalendar() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const [view, setView] = useState<CalView>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(today))
  const [monthYear, setMonthYear] = useState<{ year: number; month: number }>(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }))

  const { data: workouts = [] } = useHevyWorkouts({ limit: 200 })
  const { data: activities = [] } = useStravaActivities({ limit: 200 })

  function handlePrevWeek() { setWeekStart(d => addDays(d, -7)) }
  function handleNextWeek() { setWeekStart(d => addDays(d, 7)) }
  function handleTodayWeek() { setWeekStart(getMondayOfWeek(today)) }

  function handlePrevMonth() {
    setMonthYear(({ year, month }) => month === 0
      ? { year: year - 1, month: 11 }
      : { year, month: month - 1 })
  }
  function handleNextMonth() {
    setMonthYear(({ year, month }) => month === 11
      ? { year: year + 1, month: 0 }
      : { year, month: month + 1 })
  }
  function handleTodayMonth() {
    setMonthYear({ year: today.getFullYear(), month: today.getMonth() })
  }

  if (view === 'week') {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <WeekView
          weekStart={weekStart}
          workouts={workouts}
          activities={activities}
          today={today}
          onPrev={handlePrevWeek}
          onNext={handleNextWeek}
          onToday={handleTodayWeek}
          onSwitchToMonth={() => setView('month')}
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <MonthView
        year={monthYear.year}
        month={monthYear.month}
        workouts={workouts}
        activities={activities}
        today={today}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleTodayMonth}
        onSwitchToWeek={() => setView('week')}
      />
    </div>
  )
}
