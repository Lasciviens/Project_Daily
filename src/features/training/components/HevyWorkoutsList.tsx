import { useMemo, useState } from 'react'
import { format, startOfMonth } from 'date-fns'
import { ChevronLeft, ChevronRight, Dumbbell, Plus } from 'lucide-react'
import { useHevyWorkouts, useHevyWorkoutsRange } from '../hooks/useHevyWorkouts'
import { useTodayStr } from '../hooks/useTrainingSessions'
import { useOpenTrainingSessionTasks } from '../../todo/hooks/useTodos'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { mondayOfStr, formatLocalDate } from '../../../shared/utils/dateUtils'
import { entityModal } from '../../../shared/modals'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { workoutLocalDay } from '../api/hevyApi'
import { sessionsInWeek } from '../progressAggregate'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import type { Task } from '../../todo/types'

const PAGE_SIZE = 20

/** Log → Hevy: this-week / this-month counts (exact, from a date range — not
 *  "however many of the latest 200 fall in the week") with "Log workout",
 *  then the paged workout cards, newest performed first. */
export function HevyWorkoutsList({ onLogWorkout }: { onLogWorkout: () => void }) {
  const [page, setPage] = useState(0)
  const today = useTodayStr()

  const { data: workouts = [], isLoading } = useHevyWorkouts({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, includeExercises: true })

  const weekStart = mondayOfStr(today)
  const monthStart = formatLocalDate(startOfMonth(new Date(`${today}T12:00:00`)))
  const countFrom = weekStart < monthStart ? weekStart : monthStart
  const { data: recent = [] } = useHevyWorkoutsRange(countFrom, today)

  const { weekCount, monthCount } = useMemo(() => {
    const sessions = recent.map(w => ({ id: w.id, date: workoutLocalDay(w) }))
    return {
      weekCount:  sessionsInWeek(sessions, weekStart),
      monthCount: sessions.filter(s => s.date >= monthStart && s.date <= today).length,
    }
  }, [recent, weekStart, monthStart, today])
  // "This month" is the calendar month — name it so it's never read as 30 days.
  const monthLabel = format(new Date(`${today}T12:00:00`), 'MMMM')

  // Open planned sessions by the day they're SCHEDULED (the linked block's
  // date), falling back to the task's due date — since migration 077 those
  // are independent, so a moved session used to go unmatched.
  const { data: openTasks = [] } = useOpenTrainingSessionTasks()
  const pageDays = workouts.map(workoutLocalDay).filter(Boolean).sort()
  const { data: pageBlocks = [] } = useTrainingBlocks(pageDays[0] ?? today, pageDays[pageDays.length - 1] ?? today)
  const taskByDay = useMemo(() => {
    const blockDayByTask = new Map<string, string>()
    for (const b of pageBlocks) if (b.task_id) blockDayByTask.set(b.task_id, b.date)
    const map = new Map<string, Task>()
    for (const t of openTasks) {
      const day = blockDayByTask.get(t.id) ?? t.due_date
      if (day && !map.has(day)) map.set(day, t)
    }
    return map
  }, [openTasks, pageBlocks])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:max-w-[44.5rem]">
        <div className="flex flex-wrap gap-3 text-meta text-fg-muted">
          <span><strong className="tabular-nums text-fg">{weekCount}</strong> this week</span>
          <span className="text-fg-faint" aria-hidden>·</span>
          <span><strong className="tabular-nums text-fg">{monthCount}</strong> in {monthLabel}</span>
        </div>
        <Button variant="primary" size="sm" icon={<Plus />} onClick={onLogWorkout}>Log workout</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 justify-start gap-2 sm:grid-cols-[repeat(auto-fill,minmax(19rem,22rem))]">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} rounded="rounded-card" className="h-[88px]" />
          ))}
        </div>
      ) : workouts.length === 0 ? (
        <EmptyState bordered icon={<Dumbbell />} title="No workouts yet" description="Sync to import your Hevy data." />
      ) : (
        // Content-sized columns (19–22rem); leftover width stays on the right.
        <div className="grid grid-cols-1 items-start justify-start gap-2 sm:grid-cols-[repeat(auto-fill,minmax(19rem,22rem))]">
          {workouts.map(workout => (
            <HevyWorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => entityModal.open({ kind: 'training-session', workoutId: workout.id })}
              matchedTask={taskByDay.get(workoutLocalDay(workout))}
            />
          ))}
        </div>
      )}

      {!isLoading && (page > 0 || workouts.length === PAGE_SIZE) && (
        <div className="flex justify-between gap-2 pt-3">
          {page > 0
            ? <Button icon={<ChevronLeft />} onClick={() => setPage(p => p - 1)}>Previous</Button>
            : <div />}
          {workouts.length === PAGE_SIZE
            ? <Button onClick={() => setPage(p => p + 1)}>Next <ChevronRight className="h-4 w-4" aria-hidden /></Button>
            : <div />}
        </div>
      )}
    </>
  )
}
