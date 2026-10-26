import { useMemo } from 'react'
import { cx } from '../../../../shared/ui'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDayTasks } from '../../../todo/hooks/useTodos'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { getWorkoutDuration } from '../../../training/components/calendar/calendarModel'
import { makeWindow } from '../../../health/healthWindowStats'
import { useMetricWindow } from '../../../health/hooks/useHealthWindow'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useWatchingGlance } from '../../../media/hooks/useYearReview'
import { useReadingEvents } from '../../../books/hooks/useLibrary'
import { secondsByDay } from '../../../books/readingAggregate'
import { useSubscriptions } from '../../../settings/hooks/useSubscriptions'
import { dayFoodTotals } from '../../foodGlance'
import { dayLineItems } from '../../personalGlance'

// The day in one line, above Personal's cards (owner, 26.10.2026: "I should
// see basically a daily summary for anything I plan or do"): tasks done of
// the day's, training, steps, food, what was watched and read, and a
// subscription renewing that day — only what the day has. Every figure is
// the one its card (or the Tasks list) shows; this line only puts them side
// by side. Beside the schedule (a wide board) it is visually hidden, as the
// heading it replaces was.

export function DayLine({ date, hidden = false }: { date: string; hidden?: boolean }) {
  const today = todayStr()
  const tasks = useDayTasks(date)
  const workouts = useHevyWorkoutsRange(date, date)
  const win = useMemo(() => makeWindow(date, date, today), [date, today])
  const steps = useMetricWindow('step_count', win)
  const nut = useDayNutrition(date)
  const watching = useWatchingGlance(date)
  const reading = useReadingEvents(120)
  const { data: subs = [] } = useSubscriptions()

  const items = useMemo(() => {
    const watched = watching.last30.filter(w => w.day === date)
    const minutes = (workouts.data ?? []).reduce((a, w) => a + (getWorkoutDuration(w) ?? 0), 0)
    return dayLineItems({
      tasks: { done: tasks.counts.done, total: tasks.counts.done + tasks.counts.open },
      trainedMinutes: minutes,
      steps: steps.summary.value,
      kcal: date <= today ? dayFoodTotals(nut.data?.meals ?? [], date, today).calories : null,
      watched: { episodes: watched.filter(w => w.kind === 'episode').length, films: watched.filter(w => w.kind === 'movie').length },
      readMinutes: Math.floor((secondsByDay(reading.data ?? []).get(date) ?? 0) / 60),
      renewals: subs.filter(s => s.active && s.renews_on === date).map(s => s.name || s.service),
    })
  }, [tasks.counts, workouts.data, steps.summary.value, nut.data, watching.last30, reading.data, subs, date, today])

  const when = date === today ? 'Today' : formatWeekdayDate(date)
  return (
    <h2 className={cx(hidden ? 'sr-only' : 'mb-2', 'flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-meta text-fg-muted')}>
      <span className="section-label !text-fg">{when}</span>
      {items.length === 0
        ? <span>· nothing logged yet</span>
        : items.map(item => <span key={item} className="whitespace-nowrap tabular-nums"><span aria-hidden>· </span>{item}</span>)}
    </h2>
  )
}
