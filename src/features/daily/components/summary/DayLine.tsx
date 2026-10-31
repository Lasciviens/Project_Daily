import { useMemo, type ReactNode } from 'react'
import { MetaLine, Truncate } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDayTasks } from '../../../todo/hooks/useTodos'
import { useScheduleBlocks } from '../../hooks/useSchedule'
import { dayRowCounts, repeatDayKeys, repeatsToDoOn } from '../../dayItems'
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

// The day in one line, under the date in Personal's header (owner,
// 26.10.2026: "I should see basically a daily summary for anything I plan or
// do"): tasks done of the day's, training, steps, food, what was watched and
// read, and a subscription renewing that day — only what the day has. Every
// figure is the one its card (or the Day plan) shows; this line only puts
// them side by side. In the header it shows at every width (beside the
// schedule too) and never moves the cards.

/** `oneLine`: cut to one line (the full line on tap), so a long day never makes the header taller (Personal's
 *  header keeps one size between sections — owner, 31.10.2026). */
export function DayLine({ date, lead, oneLine = false }: { date: string; lead?: ReactNode; oneLine?: boolean }) {
  const today = todayStr()
  const tasks = useDayTasks(date)
  const { data: templates = [] } = useScheduleBlocks()
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
    // The Day plan's own counts (a repeat's day still to do counts as open there too).
    const counts = dayRowCounts(tasks.counts, repeatsToDoOn(templates, date, today, repeatDayKeys([...tasks.repeatDays, ...tasks.open, ...tasks.done, ...tasks.cancelled])))
    return dayLineItems({
      tasks: { done: counts.done, total: counts.done + counts.open },
      trainedMinutes: minutes,
      steps: steps.summary.value,
      kcal: date <= today ? dayFoodTotals(nut.data?.meals ?? [], date, today).calories : null,
      watched: { episodes: watched.filter(w => w.kind === 'episode').length, films: watched.filter(w => w.kind === 'movie').length },
      readMinutes: Math.floor((secondsByDay(reading.data ?? []).get(date) ?? 0) / 60),
      renewals: subs.filter(s => s.active && s.renews_on === date).map(s => s.name || s.service),
    })
  }, [tasks.counts, tasks.repeatDays, tasks.open, tasks.done, tasks.cancelled, templates, workouts.data, steps.summary.value, nut.data, watching.last30, reading.data, subs, date, today])

  const line = <MetaLine as="span" items={[lead, ...items]} className="tabular-nums" />
  if (!oneLine) return line
  const full = [typeof lead === 'string' ? lead : null, ...items].filter(Boolean).join(' · ')
  return <Truncate className="block" fullText={full}>{line}</Truncate>
}
