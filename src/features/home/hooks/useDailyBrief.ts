import { useEffect, useMemo, useState } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { buildDailyBrief, type BriefInput, type DailyBrief } from '../briefRules'
import { weatherLabel, type WeatherData } from '../api/weatherApi'
import { useTodayOverview, type NextUpItem } from './useTodayOverview'
import { useWeather } from './useWeather'
import { useCurrencyRates } from './useCurrencyRates'
import { useWeekTrainingStats } from './useWeekTrainingStats'
import { useTasksForDay } from '../../todo/hooks/useTodos'
import { completedWithinLast24h, isOverdue } from '../../todo/taskRules'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useWaterDay } from '../../daily/hooks/useWater'
import { useTVSeries } from '../../media/hooks/useTVSeries'
import { useOpenWishes } from '../../wishes/hooks/useWishes'
import { wishPeriodLabel } from '../../wishes/wishRules'
import { useAthleteProfile } from '../../training/hooks/useAthleteProfile'
import { todayStr } from '../../../shared/utils/dateUtils'

const DAY_END_HOUR = 22

/** Local clock as fractional hours, re-read every minute and whenever the app comes back into view. */
function useHourNow(): number {
  const read = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 }
  const [hour, setHour] = useState(read)
  useEffect(() => {
    const update = () => setHour(read())
    const id = setInterval(update, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') update() }
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return hour
}

/** The hourly points still inside today (the list wraps past midnight). */
function hoursLeftToday(w: WeatherData) {
  const out: WeatherData['hours'] = []
  let prev = -1
  for (const h of w.hours) {
    const hr = Number(h.time.slice(0, 2))
    if (hr < prev) break
    out.push(h)
    prev = hr
  }
  return out
}

function weatherInput(w: WeatherData | undefined): BriefInput['weather'] {
  if (!w) return null
  const today = hoursLeftToday(w)
  const temps = today.map(h => h.temp)
  return {
    tempC: w.current.temp,
    label: weatherLabel(w.current.symbol),
    precipMm: w.current.precip1h,
    windMs: w.current.windSpeed,
    highC: temps.length > 1 ? Math.max(...temps) : undefined,
    lowC: temps.length > 1 ? Math.min(...temps) : undefined,
    rainLaterMm: today.slice(1).reduce((sum, h) => sum + h.precip, 0),
  }
}

/** Unbooked hours between now and DAY_END_HOUR, merging overlapping items. */
function freeHoursUntilEvening(upcoming: NextUpItem[], hour: number): number | null {
  if (hour >= DAY_END_HOUR) return null
  const spans = upcoming
    .map(i => [Math.max(i.startHour, hour), Math.min(i.endHour, DAY_END_HOUR)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
  let booked = 0
  let cursor = hour
  for (const [a, b] of spans) {
    const start = Math.max(a, cursor)
    if (b > start) { booked += b - start; cursor = b }
  }
  return DAY_END_HOUR - hour - booked
}

function dayLabel(date: string): string {
  const days = differenceInCalendarDays(parseISO(date), new Date())
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7) return format(parseISO(date), 'EEEE')
  return format(parseISO(date), 'd MMM')
}

/**
 * Assembles the rule-based daily brief (briefRules.ts) from data other screens
 * already load — no queries of its own beyond those shared hooks, so opening
 * Home costs nothing extra and the brief always agrees with the cards below it.
 */
export function useDailyBrief(): { brief: DailyBrief; isLoading: boolean } {
  const hour = useHourNow()
  const date = todayStr()

  const overview = useTodayOverview(date)
  const tasksQ = useTasksForDay(new Date(`${date}T00:00:00`), 'today')
  const { data: weather } = useWeather()
  const { data: currency } = useCurrencyRates()
  const training = useWeekTrainingStats()
  const { data: profile } = useAthleteProfile()
  const { data: nutrition } = useDayNutrition(date)
  const { targets } = useDayTargets()
  const { data: waterMl } = useWaterDay(date)
  const { data: tvEntries } = useTVSeries()
  const { data: openWishes } = useOpenWishes()

  const brief = useMemo(() => {
    const tasks = (tasksQ.data ?? []).filter(t => t.status !== 'cancelled')
    const open = tasks.filter(t => t.status !== 'done')
    const doneToday = tasks.filter(t => t.status === 'done' && completedWithinLast24h(t.updated_at)).length

    const next = overview.nextUp
    const nt = overview.nextTraining
    const trainingToday = nt && nt.date === date ? nt : null
    const lastAt = training.lastWorkoutAt

    const wishGroups = new Map<string, number>()
    for (const w of openWishes ?? []) {
      const label = wishPeriodLabel(w) ?? 'Open now'
      wishGroups.set(label, (wishGroups.get(label) ?? 0) + 1)
    }

    const input: BriefInput = {
      hour,
      weather: weatherInput(weather),
      tasks: tasksQ.data ? {
        open: open.map(t => ({ title: t.title, priority: t.priority, overdue: isOverdue(t), dueTime: t.due_time ?? null })),
        doneToday,
      } : null,
      schedule: overview.isLoading ? null : {
        next: next ? { title: next.title, startLabel: next.startLabel, startHour: next.startHour, inProgress: next.inProgress } : null,
        remainingCount: overview.upcoming.length,
        freeHours: freeHoursUntilEvening(overview.upcoming, hour),
      },
      training: {
        today: trainingToday ? { title: trainingToday.title, startTime: trainingToday.startTime } : null,
        next: nt && !trainingToday ? { title: nt.title, date: nt.date, dayLabel: dayLabel(nt.date) } : null,
        daysSinceLastWorkout: lastAt ? differenceInCalendarDays(new Date(), new Date(lastAt)) : null,
        weekSessions: training.hasData ? training.sessions : null,
        weekTarget: profile?.training_days_per_week ?? null,
      },
      nutrition: nutrition ? {
        kcal: nutrition.calories,
        kcalTarget: targets.calories,
        proteinG: nutrition.protein_g,
        proteinTarget: targets.protein,
        waterMl: waterMl ?? undefined,
        waterTarget: targets.water,
      } : null,
      // Episode position comes from the entry's cached counters (cheap, no TMDB call per series).
      watch: (tvEntries ?? [])
        .filter(e => e.status === 'watching')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(e => ({
          title: e.tv_series.title,
          episodeLabel: e.current_episode > 0 ? `last watched S${e.current_season}·E${e.current_episode}` : 'not started',
        })),
      wishes: [...wishGroups].map(([label, count]) => ({ label, count })),
      currency: currency ? [
        { pair: 'NOK/TRY', rate: currency.primary.rate, changePct: currency.primary.changePct },
        { pair: 'EUR/USD', rate: currency.secondary.rate, changePct: currency.secondary.changePct },
      ] : null,
    }
    return buildDailyBrief(input)
  }, [hour, date, tasksQ.data, overview, training, profile, weather, currency, nutrition, targets, waterMl, tvEntries, openWishes])

  return { brief, isLoading: tasksQ.isLoading || overview.isLoading }
}
