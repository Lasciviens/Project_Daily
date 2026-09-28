import { useMemo, useState } from 'react'
import { Card } from '../../../../shared/ui'
import { DateNav } from '../../../../shared/components/DateNav'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { useHevyWorkoutsRange } from '../../hooks/useHevyWorkouts'
import { useStravaActivities } from '../../hooks/useStravaActivities'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { useTrainingPlansByDate } from '../../hooks/useTrainingPlans'
import { useAthleteProfile } from '../../hooks/useAthleteProfile'
import { localDayBoundsIso } from '../../workoutDates'
import { mondayOf } from '../../progressAggregate'
import { dayDataFor, type DayData } from './calendarModel'
import { DAY_MARK_LABEL, monthGridRange, monthOf, monthWeeks, shiftMonth } from './monthGrid'
import { DayMarkGlyph, StravaBar } from './DayMarkGlyph'
import { MonthGrid } from './MonthGrid'
import { DayDetailPanel } from './DayDetailPanel'

function Legend() {
  return (
    <InfoBubble label="What the marks mean">
      <span className="flex flex-col gap-1.5">
        {(['done', 'today', 'upcoming', 'missed'] as const).map(m => (
          <span key={m} className="flex items-center gap-2"><span className="grid w-4 place-items-center"><DayMarkGlyph mark={m} /></span>{DAY_MARK_LABEL[m]}</span>
        ))}
        <span className="flex items-center gap-2"><span className="grid w-4 place-items-center"><StravaBar /></span>Strava activity</span>
        <span className="mt-1 block">A plan a workout covered counts as trained. The column on the right counts each week&apos;s workouts (against your training days per week, set in Coach → Profile).</span>
      </span>
    </InfoBubble>
  )
}

/**
 * Log's calendar: ONE month (the current week emphasised), borderless day
 * cells with one mark each, a Strava bar, the week totals, and the selected
 * day's sessions below. Hevy workouts, Strava activities and planned
 * sessions (one-off blocks + projected recurring templates) for every day on
 * the grid, neighbouring months' days included so each week total is whole.
 */
export function TrainingMonthCalendar() {
  const todayStr = useTodayStr()
  const [view, setView] = useState(() => monthOf(todayStr))
  const [selected, setSelected] = useState<string | null>(todayStr)

  const weeks = useMemo(() => monthWeeks(view.year, view.month), [view])
  const { from, to } = monthGridRange(weeks)
  const bounds = useMemo(() => localDayBoundsIso(from, to), [from, to])

  const { data: workouts = [] } = useHevyWorkoutsRange(from, to)
  const { data: activities = [] } = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 500 })
  const { data: plansByDate } = useTrainingPlansByDate(from, to)
  const { data: profile } = useAthleteProfile()

  const dayByDate = useMemo(() => {
    const m = new Map<string, DayData>()
    for (const w of weeks) for (const c of w.cells) m.set(c.date, dayDataFor(c.date, new Date(`${c.date}T12:00:00`), workouts, activities, plansByDate, todayStr))
    return m
  }, [weeks, workouts, activities, plansByDate, todayStr])

  const todayMonth = monthOf(todayStr)
  const onTodayMonth = todayMonth.year === view.year && todayMonth.month === view.month
  const label = fmtDateEnGB(new Date(view.year, view.month, 1, 12), { month: 'long', year: 'numeric' })
  const selectedDay = selected ? dayByDate.get(selected) ?? null : null

  return (
    <Card padded={false} className="@container flex flex-col gap-2 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <DateNav
          size="md"
          label={label}
          labelClassName="min-w-[9.5rem] text-ui font-semibold text-fg"
          onPrev={() => { setView(v => shiftMonth(v, -1)); setSelected(null) }}
          onNext={() => { setView(v => shiftMonth(v, 1)); setSelected(null) }}
          onToday={() => { setView(todayMonth); setSelected(todayStr) }}
          isToday={onTodayMonth}
        />
        <Legend />
      </div>
      <MonthGrid
        weeks={weeks}
        dayByDate={dayByDate}
        todayStr={todayStr}
        currentWeek={mondayOf(todayStr)}
        selected={selected}
        onSelect={d => setSelected(prev => (prev === d ? null : d))}
        weeklyTarget={profile?.training_days_per_week ?? null}
      />
      {selected && <DayDetailPanel day={selectedDay} dateStr={selected} todayStr={todayStr} />}
    </Card>
  )
}
