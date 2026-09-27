import { useMemo } from 'react'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'
import { useSleepData, useHealthDaily } from '../../../health/hooks/useHealthExport'
import { mean, personalBaseline } from '../../../health/healthWindowStats'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { nightEndingOn } from '../../../health/healthDateLabels'
import { sleepNote, restingHrNote, type RecoveryNote } from '../../plan/recovery'

/** Resting-HR baseline: the 60 days BEFORE the last-7-day window. */
const BASELINE_DAYS = 60

/** Last night's sleep and resting heart rate vs your own usual level — two
 *  plain lines, no score (plan/recovery.ts). Reads the Health page's hooks,
 *  so it shares their cache. */
export function useRecoveryNotes(): { notes: RecoveryNote[]; isLoading: boolean } {
  const today = useTodayStr()
  const yesterday = shiftDateStr(today, -1)
  const weekStart = shiftDateStr(today, -6)
  const baseFrom = shiftDateStr(today, -(BASELINE_DAYS + 7))
  const { data: sleep, isLoading: loadingSleep } = useSleepData(yesterday, today)
  const { data: rhr, isLoading: loadingRhr } = useHealthDaily('resting_heart_rate', baseFrom, today)

  const notes = useMemo(() => {
    // Only the night that ended today counts as "last night" — never an older
    // record (the night before last when today's hasn't synced yet).
    const last = nightEndingOn(sleep?.nights ?? [], today)
    const series = rhr ?? []
    const rhr7 = mean(series.filter(d => d.date >= weekStart).map(d => d.value))
    const base = personalBaseline(series, { from: baseFrom, to: shiftDateStr(today, -7), minPoints: 14 })
    return [
      last
        ? sleepNote({ date: last.date, hours: last.total }, today, today)
        : (sleep ? { tone: 'neutral' as const, text: 'No sleep recorded last night yet — it shows once your watch has synced.' } : null),
      restingHrNote(rhr7, base?.median ?? null),
    ].filter((n): n is RecoveryNote => n != null)
  }, [sleep, rhr, today, weekStart, baseFrom])

  return { notes, isLoading: loadingSleep || loadingRhr }
}
