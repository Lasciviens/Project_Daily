import { useEffect, useMemo, useRef, useState } from 'react'
import { DateNav } from '../../../../shared/components/DateNav'
import { ToneDot } from '../../../../shared/ui'
import { formatDistance } from '../../setFormat'
import { StravaTypeIcon } from '../StravaIcons'
import { CalendarLegend, CalViewToggle, StravaDot } from './CalendarBits'
import { DayDetailPanel } from './DayDetailPanel'
import {
  PLAN_TONE, WORKOUT_TONE, addDays, dayDataFor, formatDate, getWorkoutDuration, ymd,
  type DayData, type ViewProps,
} from './calendarModel'

interface DayCellProps {
  day: DayData
  isToday: boolean
  isSelected: boolean
  onSelect: () => void
}

// One real <button> per day (select it); the plan/workout lines inside are
// labels, not buttons — nested controls inside a role=button were invalid
// and ~18px tall. The tappable 44px rows live in DayDetailPanel below.
// A plan a workout covered is not drawn here: it is part of that workout's
// line (one line per real session, not "Lower A" twice).
function WeekDayCell({ day, isToday, isSelected, onSelect }: DayCellProps) {
  const cellRef = useRef<HTMLButtonElement>(null)

  // Phones show the week as a scrolling strip: bring the selected day (today
  // on first render) into view horizontally, without scrolling the page.
  useEffect(() => {
    const el = cellRef.current
    const strip = el?.parentElement
    if (!isSelected || !el || !strip || strip.scrollWidth <= strip.clientWidth) return
    strip.scrollLeft = el.offsetLeft - strip.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2
  }, [isSelected])

  return (
    <button
      ref={cellRef}
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      className={`flex min-h-[76px] w-[116px] flex-shrink-0 snap-start flex-col items-stretch gap-1.5 rounded-row border p-1.5 text-left transition-colors @2xl:w-auto @2xl:flex-shrink ${
        isSelected
          ? 'border-accent-500 bg-accent-50'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover'
      }`}
    >
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{day.date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-body font-bold tabular-nums ${
          isToday ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
        }`}>
          {day.date.getDate()}
        </span>
      </span>

      <span className="flex flex-col gap-1">
        {day.sessions.map(({ workout: w }) => {
          const dur = getWorkoutDuration(w)
          return (
            <span key={w.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg">
              <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />
              <span className="truncate">{w.title}{dur != null ? ` · ${dur}m` : ''}</span>
            </span>
          )
        })}
        {day.openPlans.map(({ plan: p, status }) => (
          <span key={p.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg-2">
            <ToneDot tone={PLAN_TONE[status]} className="!h-1.5 !w-1.5" />
            <span className="truncate">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
          </span>
        ))}
        {day.activities.map(a => (
          <span key={a.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg-2" title={a.title}>
            <StravaDot className="h-1.5 w-1.5" />
            <StravaTypeIcon type={a.type} className="h-3 w-3 shrink-0" />
            <span className="truncate">{a.distance_meters ? formatDistance(a.distance_meters) : a.title}</span>
          </span>
        ))}
      </span>
    </button>
  )
}

export function WeekView({ weekStart, workouts, activities, plansByDate, todayStr, onPrev, onNext, onToday, onSwitchView, onOpenWorkout, onEditPlan }: ViewProps & { weekStart: Date }) {
  // Today's detail panel is open by default so the day's plan/workouts show
  // below the grid on load.
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)

  const days: DayData[] = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    return dayDataFor(ymd(date), date, workouts, activities, plansByDate, todayStr)
  }), [weekStart, workouts, activities, plansByDate, todayStr])

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`
  const selectedDay = selectedDate ? days.find(d => ymd(d.date) === selectedDate) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateNav size="md" label={weekLabel} labelClassName="min-w-[150px] text-body font-semibold text-fg" onPrev={onPrev} onNext={onNext} onToday={onToday} isToday={false} />
        <CalViewToggle value="week" onChange={v => { if (v === 'month') onSwitchView() }} />
      </div>

      {/* Below ~42rem of its OWN width (a phone, or the 440px rail beside the
          workout list) a 7-col grid squeezes each day to ~50px and every title
          to "L…", so the week becomes a scrollable strip of readable cards. */}
      <div className="@container">
      <div className="scroll-x flex snap-x snap-mandatory gap-1.5 pb-1 @2xl:grid @2xl:grid-cols-7 @2xl:overflow-visible @2xl:pb-0">
        {days.map(day => {
          const key = ymd(day.date)
          return (
            <WeekDayCell
              key={key}
              day={day}
              isToday={key === todayStr}
              isSelected={selectedDate === key}
              onSelect={() => setSelectedDate(selectedDate === key ? null : key)}
            />
          )
        })}
      </div>
      </div>

      <CalendarLegend />
      <DayDetailPanel day={selectedDay} todayStr={todayStr} onOpenWorkout={onOpenWorkout} onEditPlan={onEditPlan} />
    </div>
  )
}

