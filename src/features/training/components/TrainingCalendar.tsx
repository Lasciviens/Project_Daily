import { useCallback, useState, useMemo } from 'react'
import { useHevyWorkoutsRange } from '../hooks/useHevyWorkouts'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useTodayStr } from '../hooks/useTrainingSessions'
import { useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { projectRecurringBlocksForDay } from '../../daily/components/dayAgendaProjection'
import { useEntityModal } from '../../../shared/modals'
import { Card } from '../../../shared/ui'
import { localDayBoundsIso } from '../workoutDates'
import { WeekView } from './calendar/WeekView'
import { MonthView } from './calendar/MonthView'
import { addDays, getMondayOfWeek, ymd, type CalendarPlanItem } from './calendar/calendarModel'

// Training calendar: Hevy workouts, Strava activities and planned sessions
// (one-off blocks + projected recurring templates) for the visible week or
// month — a plan a workout covered folds into that workout's entry
// (calendar/calendarSessions.ts). Views, day cells and the detail panel live
// in ./calendar/.

// ─── TrainingCalendar (top-level) ─────────────────────────────────────────────

type CalView = 'week' | 'month'

export function TrainingCalendar() {
  // Kept current across midnight (a PWA left open overnight kept yesterday).
  const todayStr = useTodayStr()
  const today = useMemo(() => new Date(`${todayStr}T00:00:00`), [todayStr])
  const [view, setView] = useState<CalView>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()))
  const [monthYear, setMonthYear] = useState<{ year: number; month: number }>(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  }))

  // Reached only through a row's ⋯ menu ("Edit plan") — tapping a session
  // opens the workout, never the schedule editor. A task-linked plan block
  // must open the TASK, never the block via `timeBlock` (that minted a second
  // task — the real duplicate-task bug); the shared block editor applies that
  // routing rule once for every caller; a recurring occurrence opens its
  // template (it can never be task-linked).
  const modal = useEntityModal()
  const editPlan = useCallback((item: CalendarPlanItem) => {
    if (item.kind === 'recurring' && item.scheduleBlock) {
      modal.open({ kind: 'schedule-block', id: item.scheduleBlock.id, config: { heading: 'Edit recurring session' } })
    } else if (item.timeBlock) {
      modal.open({ kind: 'time-block', id: item.timeBlock.id, config: { heading: 'Edit session' } })
    }
  }, [modal])
  const openWorkout = useCallback((id: string) => modal.open({ kind: 'hevy-workout', id }), [modal])

  // The visible range drives EVERY read — workouts and Strava too, which
  // used to be "the latest 200", so older months looked empty.
  const { rangeFrom, rangeTo } = useMemo(() => {
    if (view === 'week') return { rangeFrom: ymd(weekStart), rangeTo: ymd(addDays(weekStart, 6)) }
    return {
      rangeFrom: ymd(new Date(monthYear.year, monthYear.month, 1)),
      rangeTo:   ymd(new Date(monthYear.year, monthYear.month + 1, 0)),
    }
  }, [view, weekStart, monthYear])
  const bounds = useMemo(() => localDayBoundsIso(rangeFrom, rangeTo), [rangeFrom, rangeTo])

  const { data: workouts = [] } = useHevyWorkoutsRange(rangeFrom, rangeTo)
  const { data: activities = [] } = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 500 })
  const { data: planBlocks = [] } = useTrainingBlocks(rangeFrom, rangeTo)

  // Recurring training templates, projected onto the visible range with the
  // same pure helper DayAgenda uses.
  const { data: allScheduleBlocks = [] } = useScheduleBlocks()
  const trainingScheduleBlocks = useMemo(() => allScheduleBlocks.filter(b => b.category === 'training'), [allScheduleBlocks])

  const plansByDate = useMemo(() => {
    const m = new Map<string, CalendarPlanItem[]>()
    const push = (date: string, item: CalendarPlanItem) => m.set(date, [...(m.get(date) ?? []), item])

    for (const b of planBlocks) push(b.date, { id: b.id, title: b.title, kind: 'block', timeBlock: b })

    if (trainingScheduleBlocks.length) {
      for (let cursor = new Date(`${rangeFrom}T00:00:00`); ymd(cursor) <= rangeTo; cursor = addDays(cursor, 1)) {
        const dateStr = ymd(cursor)
        for (const p of projectRecurringBlocksForDay(dateStr, cursor.getDay(), trainingScheduleBlocks)) {
          // One entry per day a session STARTS on (a one-off block has no
          // spillover row here either).
          if (p.spillover) continue
          const scheduleBlock = trainingScheduleBlocks.find(s => s.id === p.canonicalId)
          if (scheduleBlock) push(dateStr, { id: `${p.canonicalId}__${dateStr}`, title: p.title, kind: 'recurring', scheduleBlock })
        }
      }
    }
    return m
  }, [planBlocks, trainingScheduleBlocks, rangeFrom, rangeTo])

  const shared = { workouts, activities, plansByDate, todayStr, onOpenWorkout: openWorkout, onEditPlan: editPlan }

  return (
    <Card className="w-full">
      {view === 'week' ? (
        <WeekView
          {...shared}
          weekStart={weekStart}
          onPrev={() => setWeekStart(d => addDays(d, -7))}
          onNext={() => setWeekStart(d => addDays(d, 7))}
          onToday={() => setWeekStart(getMondayOfWeek(today))}
          onSwitchView={() => setView('month')}
        />
      ) : (
        <MonthView
          {...shared}
          year={monthYear.year}
          month={monthYear.month}
          onPrev={() => setMonthYear(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }))}
          onNext={() => setMonthYear(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }))}
          onToday={() => setMonthYear({ year: today.getFullYear(), month: today.getMonth() })}
          onSwitchView={() => setView('week')}
        />
      )}
    </Card>
  )
}
