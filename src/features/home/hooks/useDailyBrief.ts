import { useEffect, useMemo, useState } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { formatDate } from '../../../shared/utils/dateFormat'
import { buildDailyBrief, type BriefInput, type DailyBrief } from '../briefRules'
import { hoursFromNow, weatherLabel, type WeatherData } from '../api/weatherApi'
import { useTodayOverview } from './useTodayOverview'
import { useWeather } from './useWeather'
import { useCurrencyRates } from './useCurrencyRates'
import { useWeekTrainingStats } from './useWeekTrainingStats'
import { useTasksForDay } from '../../todo/hooks/useTodos'
import { closedOn, isOverdue } from '../../todo/taskRules'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useWaterDay } from '../../daily/hooks/useWater'
import { useTVSeries } from '../../media/hooks/useTVSeries'
import { useMovies } from '../../media/hooks/useMovies'
import { useNextEpisode } from '../../media/hooks/useNextEpisode'
import type { UserTVEntry } from '../../media/types'
import { useAthleteProfile } from '../../training/hooks/useAthleteProfile'
import { todayStr } from '../../../shared/utils/dateUtils'

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
function hoursLeftToday(hours: WeatherData['hours']) {
  const out: WeatherData['hours'] = []
  let prev = -1
  for (const h of hours) {
    const hr = Number(h.time.slice(0, 2))
    if (hr < prev) break
    out.push(h)
    prev = hr
  }
  return out
}

function weatherInput(w: WeatherData | undefined): BriefInput['weather'] {
  if (!w) return null
  const fromNow = hoursFromNow(w)
  const today = hoursLeftToday(fromNow)
  const temps = today.map(h => h.temp)
  const point = (h: WeatherData['hours'][number]) => ({ time: h.time, temp: h.temp, precip: h.precip })
  return {
    tempC: w.current.temp,
    label: weatherLabel(w.current.symbol),
    precipMm: w.current.precip1h,
    windMs: w.current.windSpeed,
    windDir: w.current.windDirection,
    highC: temps.length > 1 ? Math.max(...temps) : undefined,
    lowC: temps.length > 1 ? Math.min(...temps) : undefined,
    hours: today.map(point),
    ahead: fromNow.slice(0, 12).map(point),
    // `daily` starts at tomorrow (weatherApi skips today).
    tomorrow: w.daily[0] ? { label: weatherLabel(w.daily[0].symbol), minC: w.daily[0].min, maxC: w.daily[0].max, precipMm: w.daily[0].precip } : null,
  }
}

function dayLabel(date: string): string {
  const days = differenceInCalendarDays(parseISO(date), new Date())
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7) return format(parseISO(date), 'EEEE')
  return formatDate(date)
}

/**
 * Assembles the rule-based daily brief (briefRules.ts) from data other screens
 * already load — no queries of its own beyond those shared hooks, so opening
 * Home costs nothing extra and the brief always agrees with the cards below it.
 * The one TMDB read is the shared next-episode query (cached, the same one
 * Daily's Watch next card uses), for one series only.
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
  const { data: movieEntries } = useMovies()

  // The series you touched last — the same next-episode query Daily's Watch next card uses.
  const current = useMemo(() => {
    let best: UserTVEntry | null = null
    for (const e of tvEntries ?? []) if (e.status === 'watching' && (!best || e.updated_at > best.updated_at)) best = e
    return best
  }, [tvEntries])
  const { data: nextEp } = useNextEpisode(current?.id ?? null, current?.tv_series.tmdb_id ?? null, current?.tv_series.number_of_episodes ?? null)

  const brief = useMemo(() => {
    const tasks = (tasksQ.data ?? []).filter(t => t.status !== 'cancelled')
    const open = tasks.filter(t => t.status !== 'done')
    const doneToday = tasks.filter(t => t.status === 'done' && closedOn(t, date)).length

    const next = overview.nextUp
    const nt = overview.nextTraining
    const trainingToday = nt && nt.date === date ? nt : null
    const lastAt = training.lastWorkoutAt

    const input: BriefInput = {
      hour,
      today: date,
      weather: weatherInput(weather),
      tasks: tasksQ.data ? {
        open: open.map(t => ({ title: t.title, priority: t.priority, overdue: isOverdue(t), dueTime: t.due_time ?? null })),
        doneToday,
      } : null,
      schedule: overview.isLoading ? null : {
        next: next ? { title: next.title, startLabel: next.startLabel, startHour: next.startHour, inProgress: next.inProgress } : null,
        remainingCount: overview.upcoming.length,
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
      watch: {
        next: current && nextEp ? {
          title: current.tv_series.title,
          tmdbId: current.tv_series.tmdb_id,
          season: nextEp.season,
          episode: nextEp.episode,
          episodeTitle: nextEp.episodeTitle,
          airDate: nextEp.airDate,
          caughtUp: nextEp.caughtUp,
        } : null,
        wishlist: [
          ...(movieEntries ?? []).filter(e => e.status === 'wishlist').map(e => ({ title: e.movie.title, tmdbId: e.movie.tmdb_id, mediaType: 'movie' as const, releaseDate: e.movie.release_date })),
          ...(tvEntries ?? []).filter(e => e.status === 'wishlist').map(e => ({ title: e.tv_series.title, tmdbId: e.tv_series.tmdb_id, mediaType: 'tv' as const, releaseDate: e.tv_series.first_air_date })),
        ],
      },
      nokTry: currency ? { rate: currency.primary.rate, changePct: currency.primary.changePct } : null,
    }
    return buildDailyBrief(input)
  }, [hour, date, tasksQ.data, overview, training, profile, weather, currency, nutrition, targets, waterMl, tvEntries, movieEntries, current, nextEp])

  return { brief, isLoading: tasksQ.isLoading || overview.isLoading }
}
