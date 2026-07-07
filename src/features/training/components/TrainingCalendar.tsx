import { useState, useMemo } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import type { HevyWorkout, StravaActivity } from '../types.hevy'
import type { TimeBlock } from '../../daily/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(iso: string): string {
  return iso.slice(0, 10)
}

// Local YYYY-MM-DD (avoids the UTC shift that toISOString would introduce)
const ymd = formatLocalDate

// Dot colour for a planned training day, relative to today.
function planDotClass(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'bg-green-500'
  return dateStr > todayStr ? 'bg-blue-500' : 'bg-red-500'
}

// The day a workout was actually performed (session start), falling back to
// the Hevy record creation time only when start_time is missing.
function workoutDay(w: HevyWorkout): string {
  return toDateStr(w.start_time ?? w.hevy_created_at)
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
  plans: TimeBlock[]
}

interface DayCellProps {
  day: DayData
  isToday: boolean
  selectedDate: string | null
  todayStr: string
  onSelect: (d: string) => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (b: TimeBlock) => void
}

function WeekDayCell({ day, isToday, selectedDate, todayStr, onSelect, onOpenWorkout, onOpenPlan }: DayCellProps) {
  const dateStr = ymd(day.date)
  const isSelected = selectedDate === dateStr

  return (
    <div
      className={`flex flex-col items-stretch gap-1.5 min-h-[76px] p-1.5 rounded-2xl border transition-colors cursor-pointer ${
        isSelected
          ? 'border-accent-400 bg-accent-50 ring-1 ring-accent-300'
          : isToday
          ? 'border-accent-200 bg-accent-50/40'
          : 'border-ink-100 bg-white hover:border-ink-300 hover:bg-cream-50'
      }`}
      onClick={() => onSelect(isSelected ? '' : dateStr)}
    >
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] font-bold text-ink-400 uppercase tracking-wide">{formatDayLabel(day.date)}</span>
        <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full ${
          isToday ? 'bg-accent-600 text-white' : 'text-ink-700'
        }`}>
          {day.date.getDate()}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {/* Planned training sessions (future blue / today green / past red) */}
        {day.plans.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={e => { e.stopPropagation(); onOpenPlan(p) }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-cream-100 text-ink-600 text-[10px] font-medium leading-tight truncate hover:bg-cream-200 transition-colors text-left"
            title={`Planned: ${p.title} — click to edit`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${planDotClass(dateStr, todayStr)}`} />
            <span className="truncate">{p.title}</span>
          </button>
        ))}

        {day.workouts.map(w => {
          const dur = getWorkoutDuration(w)
          return (
            <button
              key={w.id}
              type="button"
              onClick={e => { e.stopPropagation(); onOpenWorkout(w.id) }}
              className="text-left rounded px-1.5 py-0.5 bg-accent-100 text-accent-800 text-[10px] font-medium leading-tight truncate hover:bg-accent-200 transition-colors"
              title={`${w.title} — view details`}
            >
              {w.title}{dur ? ` · ${dur}m` : ''}
            </button>
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

interface SelectedDay {
  date:       Date
  workouts:   HevyWorkout[]
  activities: StravaActivity[]
  plans:      TimeBlock[]
}

// Shared by WeekView and MonthView — was pixel-for-pixel duplicated in both.
function DayDetailPanel({
  selectedDay, dateKey, todayStr, onOpenWorkout, onOpenPlan,
}: {
  selectedDay:   SelectedDay | null | undefined
  dateKey:       string
  todayStr:      string
  onOpenWorkout: (id: string) => void
  onOpenPlan:    (b: TimeBlock) => void
}) {
  if (!selectedDay || (selectedDay.workouts.length === 0 && selectedDay.activities.length === 0 && selectedDay.plans.length === 0)) {
    return null
  }

  return (
    <div className="border border-ink-200 rounded-xl p-3 flex flex-col gap-2">
      <p className="text-sm font-bold text-ink-800">
        {selectedDay.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
      </p>

      {selectedDay.plans.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1.5">Planned</p>
          <div className="flex flex-col gap-2">
            {selectedDay.plans.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPlan(p)}
                className="w-full text-left flex items-center gap-2 p-2.5 bg-cream-100 border border-ink-100 rounded-lg hover:bg-cream-200 transition-colors min-h-[44px]"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${planDotClass(dateKey, todayStr)}`} />
                <span className="text-sm font-medium text-ink-900">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDay.workouts.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-600 mb-1.5">Hevy Workouts</p>
          <div className="flex flex-col gap-2">
            {selectedDay.workouts.map(w => {
              const dur = getWorkoutDuration(w)
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onOpenWorkout(w.id)}
                  className="w-full text-left flex items-center justify-between gap-2 p-2.5 bg-accent-50 border border-accent-100 rounded-lg hover:bg-accent-100 transition-colors min-h-[44px]"
                >
                  <span className="text-sm font-medium text-ink-900">{w.title}</span>
                  {dur && <span className="text-xs text-accent-600 shrink-0">{dur} min</span>}
                </button>
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
  )
}

interface WeekViewProps {
  weekStart: Date
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, TimeBlock[]>
  todayStr: string
  today: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSwitchToMonth: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (b: TimeBlock) => void
}

function WeekView({ weekStart, workouts, activities, plansByDate, todayStr, today, onPrev, onNext, onToday, onSwitchToMonth, onOpenWorkout, onOpenPlan }: WeekViewProps) {
  // Today's detail panel is expanded by default (no click needed) so the
  // day's plan/workouts/activities flow visibly below the grid on load.
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)

  const days: DayData[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i)
      const dateStr = ymd(date)
      return {
        date,
        workouts: workouts.filter(w => workoutDay(w) === dateStr),
        activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === dateStr),
        plans: plansByDate.get(dateStr) ?? [],
      }
    })
  }, [weekStart, workouts, activities, plansByDate])

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`

  const selectedDay = selectedDate
    ? days.find(d => ymd(d.date) === selectedDate)
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
            todayStr={todayStr}
            onSelect={setSelectedDate}
            onOpenWorkout={onOpenWorkout}
            onOpenPlan={onOpenPlan}
          />
        ))}
      </div>

      {/* Detail panel */}
      <DayDetailPanel
        selectedDay={selectedDay}
        dateKey={selectedDay ? ymd(selectedDay.date) : ''}
        todayStr={todayStr}
        onOpenWorkout={onOpenWorkout}
        onOpenPlan={onOpenPlan}
      />
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  year: number
  month: number   // 0-based
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, TimeBlock[]>
  todayStr: string
  today: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSwitchToWeek: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (b: TimeBlock) => void
}

function MonthView({ year, month, workouts, activities, plansByDate, todayStr, today, onPrevMonth, onNextMonth, onToday, onSwitchToWeek, onOpenWorkout, onOpenPlan }: MonthViewProps) {
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

  const workoutDates = useMemo(() => new Set(workouts.map(workoutDay)), [workouts])
  const activityDates = useMemo(() => new Set(activities.filter(a => a.start_date).map(a => toDateStr(a.start_date!))), [activities])

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null
    return {
      date: new Date(selectedDate + 'T12:00:00'),
      workouts: workouts.filter(w => workoutDay(w) === selectedDate),
      activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === selectedDate),
      plans: plansByDate.get(selectedDate) ?? [],
    }
  }, [selectedDate, workouts, activities, plansByDate])

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
          const dateStr = ymd(date)
          const hasWorkout = workoutDates.has(dateStr)
          const hasActivity = activityDates.has(dateStr)
          const hasPlan = plansByDate.has(dateStr)
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
                {hasPlan && <span className={`w-1.5 h-1.5 rounded-full ${planDotClass(dateStr, todayStr)}`} />}
                {hasWorkout && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
                {hasActivity && <span className="w-1.5 h-1.5 rounded-full bg-[#FC4C02]" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-[11px] text-ink-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Plan today</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Plan upcoming</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Plan past</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-500 inline-block" /> Workout</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#FC4C02] inline-block" /> Strava</span>
      </div>

      {/* Day detail */}
      <DayDetailPanel
        selectedDay={selectedDay}
        dateKey={selectedDate ?? ''}
        todayStr={todayStr}
        onOpenWorkout={onOpenWorkout}
        onOpenPlan={onOpenPlan}
      />
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

  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [selectedPlanBlock, setSelectedPlanBlock] = useState<TimeBlock | null>(null)

  const { data: workouts = [] } = useHevyWorkouts({ limit: 200 })
  const { data: activities = [] } = useStravaActivities({ limit: 200 })

  // Visible date range for the current view → fetch planned training sessions.
  const { rangeFrom, rangeTo } = useMemo(() => {
    if (view === 'week') {
      return { rangeFrom: ymd(weekStart), rangeTo: ymd(addDays(weekStart, 6)) }
    }
    return {
      rangeFrom: ymd(new Date(monthYear.year, monthYear.month, 1)),
      rangeTo:   ymd(new Date(monthYear.year, monthYear.month + 1, 0)),
    }
  }, [view, weekStart, monthYear])

  const { data: planBlocks = [] } = useTrainingBlocks(rangeFrom, rangeTo)

  // date → planned training blocks for that day
  const plansByDate = useMemo(() => {
    const m = new Map<string, TimeBlock[]>()
    for (const b of planBlocks) {
      const bucket = m.get(b.date) ?? []
      bucket.push(b)
      m.set(b.date, bucket)
    }
    return m
  }, [planBlocks])

  const todayStr = ymd(today)

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

  return (
    <div className="w-full">
      {view === 'week' ? (
        <WeekView
          weekStart={weekStart}
          workouts={workouts}
          activities={activities}
          plansByDate={plansByDate}
          todayStr={todayStr}
          today={today}
          onPrev={handlePrevWeek}
          onNext={handleNextWeek}
          onToday={handleTodayWeek}
          onSwitchToMonth={() => setView('month')}
          onOpenWorkout={setSelectedWorkoutId}
          onOpenPlan={setSelectedPlanBlock}
        />
      ) : (
        <MonthView
          year={monthYear.year}
          month={monthYear.month}
          workouts={workouts}
          activities={activities}
          plansByDate={plansByDate}
          todayStr={todayStr}
          today={today}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleTodayMonth}
          onSwitchToWeek={() => setView('week')}
          onOpenWorkout={setSelectedWorkoutId}
          onOpenPlan={setSelectedPlanBlock}
        />
      )}

      <HevyWorkoutDetail
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
      />

      <UnifiedPlanModal
        open={!!selectedPlanBlock}
        onClose={() => setSelectedPlanBlock(null)}
        config={{ tabs: ['schedule'], heading: 'Edit Session' }}
        timeBlock={selectedPlanBlock ?? undefined}
      />
    </div>
  )
}
