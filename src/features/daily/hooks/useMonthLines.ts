import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useWatchesBetween } from '../../media/hooks/useYearReview'
import { useShopItems } from '../../shop/hooks/useShop'
import { useShopCosts } from '../../shop/hooks/useShopMoney'
import { moneyCtx } from '../../shop/ownModel'
import { moneyEvents } from '../../shop/statsModel'
import { useHevyWorkoutsRange } from '../../training/hooks/useHevyWorkouts'
import { useStravaActivities } from '../../training/hooks/useStravaActivities'
import { useTrainingPlansByDate } from '../../training/hooks/useTrainingPlans'
import { usePlanContext } from '../../training/hooks/usePlanContext'
import { localDayBoundsIso } from '../../training/workoutDates'
import { dayDataFor, type CalendarPlanItem } from '../../training/components/calendar/calendarModel'
import { planStartHHMM } from '../../training/components/calendar/calendarSessions'
import { dayMarkOf } from '../../training/components/calendar/monthGridModel'
import { mediaByDay, moneyByDay, plansByDay, type MonthDayFacts, type MonthKind } from '../monthLines'
import { useTimeBlocksRange } from './useSchedule'

/**
 * The month calendar's lines besides tasks (Personal → Month): every kind read
 * ONCE for the month — never one read per day — through its feature's own
 * hooks, and turned into per-day facts by `monthLines.ts`. A hidden kind's
 * own month read is switched off where its hook allows it (workouts, Strava,
 * slots, Shop); the libraries it shares with other screens stay as they are.
 * `from` / `to`: yyyy-MM-dd, the month's first and last day.
 */
export function useMonthLines(from: string, to: string, hidden: readonly MonthKind[]) {
  const qc = useQueryClient()
  const today = useTodayStr()
  const on = (k: MonthKind) => !hidden.includes(k)

  // Training: Training's month calendar's own reads and rules (dayDataFor → dayMarkOf).
  const workouts = useHevyWorkoutsRange(from, to, { enabled: on('training') })
  const bounds = useMemo(() => localDayBoundsIso(from, to), [from, to])
  const activities = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 500 }, { enabled: on('training') })
  const plans = useTrainingPlansByDate(from, to)
  const { skips, routineOf } = usePlanContext()
  const routineOfPlan = useCallback((p: CalendarPlanItem, date: string) => routineOf({ title: p.title, date, startHHMM: planStartHHMM(p) }), [routineOf])

  // Plans: the month's slots (the app's own; Google Calendar's events went with it, 25.11.2026).
  const slots = useTimeBlocksRange(from, to, { enabled: on('plans') })

  // Media: every watch on its own day (the year review's reads).
  const media = useWatchesBetween(from, to)

  // Money: Shop's Stats definition of spent (moneyEvents), at each row's own day's rate.
  const items = useShopItems({ enabled: on('money') })
  const costs = useShopCosts({ enabled: on('money') })

  const training = useMemo(() => {
    const out = new Map<string, { sessions: number; mark: ReturnType<typeof dayMarkOf> }>()
    if (!workouts.data && !plans.data.size) return out
    for (let d = new Date(`${from}T12:00:00`); ; d.setDate(d.getDate() + 1)) {
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (day > to) break
      const data = dayDataFor(day, new Date(d), workouts.data ?? [], activities.data ?? [], plans.data, today, skips, routineOfPlan)
      const mark = dayMarkOf(data)
      if (data.sessions.length || mark) out.set(day, { sessions: data.sessions.length, mark })
    }
    return out
  }, [from, to, workouts.data, activities.data, plans.data, today, skips, routineOfPlan])

  const planCounts = useMemo(() => plansByDay(slots.data ?? []), [slots.data])
  const watched = useMemo(() => mediaByDay(media.watches), [media.watches])
  const spent = useMemo(() => {
    if (!items.data) return new Map()
    return moneyByDay(moneyEvents(items.data, moneyCtx(costs.data ?? [], null), from.slice(0, 7), to.slice(0, 7)))
  }, [items.data, costs.data, from, to])

  const factsOf = useCallback((day: string): Omit<MonthDayFacts, 'tasks'> => ({
    training: training.get(day),
    plans:    planCounts.get(day),
    media:    watched.get(day),
    money:    spent.get(day),
  }), [training, planCounts, watched, spent])

  // A failed read is named, never read as "nothing" (THEME §5); Try again reads the failed ones again.
  const failed: MonthKind[] = []
  if (on('training') && (workouts.isError || plans.isError)) failed.push('training')
  if (on('plans') && slots.isError) failed.push('plans')
  if (on('media') && media.failed) failed.push('media')
  if (on('money') && (items.isError || costs.isError)) failed.push('money')
  const retry = useCallback(() => {
    void qc.refetchQueries({ type: 'active', predicate: q => q.state.status === 'error' })
  }, [qc])

  // A day's lines are one list across these reads: it shows once every shown kind has answered
  // (or failed), so no line moves when a later read lands (THEME §5: one order waits for its own).
  const loading = (on('training') && (workouts.isLoading || activities.isLoading || plans.isLoading))
    || (on('plans') && slots.isLoading)
    || (on('media') && media.loading)
    || (on('money') && (items.isLoading || costs.isLoading))

  return { factsOf, failed, retry, ready: !loading }
}
