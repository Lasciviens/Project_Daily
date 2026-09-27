// Workout date rules — pure (scripts/verify-hevy-training.cjs), re-exported
// by hevyApi. A workout's date is when it was PERFORMED (start_time);
// hevy_created_at — when the Hevy record was created — is only a fallback
// for a row with no start_time. They differ for back-dated and imported
// workouts, including anything logged from the web with a past date.

import { localDayOf } from '../../shared/utils/dateUtils'

/** PostgREST `or` filter: effective date (start_time, else hevy_created_at)
 *  within [fromISO, toISO]; either bound may be omitted. */
export function workoutWindowFilter(fromISO?: string, toISO?: string): string {
  const bounds = (col: string) => [fromISO && `${col}.gte.${fromISO}`, toISO && `${col}.lte.${toISO}`].filter(Boolean).join(',')
  return `and(${bounds('start_time')}),and(start_time.is.null,${bounds('hevy_created_at')})`
}

/** Instants covering the LOCAL days [fromDate, toDate] ('yyyy-MM-dd'). */
export function localDayBoundsIso(fromDate: string, toDate: string): { fromISO: string; toISO: string } {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  return {
    fromISO: new Date(fy, fm - 1, fd).toISOString(),
    toISO:   new Date(new Date(ty, tm - 1, td + 1).getTime() - 1).toISOString(),
  }
}

/** The local calendar day a workout was performed on ('' when unknown). */
export function workoutLocalDay(w: { start_time: string | null; hevy_created_at: string }): string {
  return localDayOf(w.start_time ?? w.hevy_created_at) ?? ''
}
