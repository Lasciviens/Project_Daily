import { useMemo, useState } from 'react'
import { DateNav } from '../../../../shared/components/DateNav'
import { ToneDot } from '../../../../shared/ui'
import { CalendarLegend, CalViewToggle, StravaDot } from './CalendarBits'
import { DayDetailPanel } from './DayDetailPanel'
import { PLAN_TONE, WORKOUT_TONE, dayDataFor, ymd, type DayData, type ViewProps } from './calendarModel'

// ─── Month View ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function MonthView({ year, month, workouts, activities, plansByDate, todayStr, onPrev, onNext, onToday, onSwitchView, onOpenWorkout, onEditPlan }: ViewProps & { year: number; month: number }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(year, month, 1)
    const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const startDow = (first.getDay() + 6) % 7 // Mon-start: 0=Mon … 6=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = [
      ...Array(startDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    return { cells, monthLabel }
  }, [year, month])

  // One matched day per cell, so a dot means the same thing as the detail
  // below it: a covered plan is part of its workout, not a second dot.
  const dayByDate = useMemo(() => {
    const m = new Map<string, DayData>()
    for (const date of cells) {
      if (!date) continue
      const key = ymd(date)
      m.set(key, dayDataFor(key, date, workouts, activities, plansByDate, todayStr))
    }
    return m
  }, [cells, workouts, activities, plansByDate, todayStr])

  const selectedDay = selectedDate ? dayByDate.get(selectedDate) ?? null : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateNav size="md" label={monthLabel} labelClassName="min-w-[150px] text-body font-semibold text-fg" onPrev={onPrev} onNext={onNext} onToday={onToday} isToday={false} />
        <CalViewToggle value="month" onChange={v => { if (v === 'week') onSwitchView() }} />
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="py-1 text-center text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, idx) => {
          if (!date) return <div key={`empty-${idx}`} className="aspect-square" />
          const dateStr = ymd(date)
          const day = dayByDate.get(dateStr)
          const hasWorkout = (day?.sessions.length ?? 0) > 0
          const hasActivity = (day?.activities.length ?? 0) > 0
          const openPlan = day?.openPlans[0]
          const isSelected = selectedDate === dateStr
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              aria-pressed={isSelected}
              aria-label={date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              className={`flex aspect-square min-h-[44px] flex-col items-center justify-start rounded-control border pt-1 transition-colors ${
                isSelected ? 'border-accent-500 bg-accent-50' : 'border-transparent hover:border-line hover:bg-surface-hover'
              }`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-meta font-semibold tabular-nums ${
                dateStr === todayStr ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
              }`}>
                {date.getDate()}
              </span>
              <span className="mt-0.5 flex gap-0.5">
                {hasWorkout && <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />}
                {openPlan && <ToneDot tone={PLAN_TONE[openPlan.status]} className="!h-1.5 !w-1.5" />}
                {hasActivity && <StravaDot className="h-1.5 w-1.5" />}
              </span>
            </button>
          )
        })}
      </div>

      <CalendarLegend />
      <DayDetailPanel day={selectedDay} todayStr={todayStr} onOpenWorkout={onOpenWorkout} onEditPlan={onEditPlan} />
    </div>
  )
}

