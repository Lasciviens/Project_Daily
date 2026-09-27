import { useMemo } from 'react'
import type { HealthWindow } from '../healthWindowStats'
import { readVitals, type VitalsReading } from '../vitalsReading'
import { useHealthDaily } from './useHealthExport'

// The plain-language read of the Heart & vitals window (vitalsReading.ts) for
// the page's day/period. Every read uses the page's long window
// [fetchFrom, to] — the same query keys the section's charts use — so the
// reading costs no extra request apart from heart-rate recovery.

export interface VitalsReadingState {
  reading: VitalsReading
  isLoading: boolean
  /** The previous window's data is still on screen while this one loads. */
  isPlaceholderData: boolean
  /** At least one signal failed to load (the rest are still read). */
  isError: boolean
  refetch: () => void
}

export function useVitalsReading(win: HealthWindow): VitalsReadingState {
  const f = win.fetchFrom, t = win.to
  const rhr = useHealthDaily('resting_heart_rate', f, t)
  const hrv = useHealthDaily('heart_rate_variability', f, t)
  const resp = useHealthDaily('respiratory_rate', f, t)
  const spo2 = useHealthDaily('blood_oxygen_saturation', f, t)
  const temp = useHealthDaily('apple_sleeping_wrist_temperature', f, t)
  const walking = useHealthDaily('walking_heart_rate_average', f, t)
  const hrr = useHealthDaily('cardio_recovery', f, t)
  const all = [rhr, hrv, resp, spo2, temp, walking, hrr]

  const reading = useMemo(() => readVitals({
    from: win.from,
    to: win.to,
    series: {
      resting_heart_rate: rhr.data,
      heart_rate_variability: hrv.data,
      respiratory_rate: resp.data,
      blood_oxygen_saturation: spo2.data,
      apple_sleeping_wrist_temperature: temp.data,
      walking_heart_rate_average: walking.data,
      cardio_recovery: hrr.data,
    },
  }), [win.from, win.to, rhr.data, hrv.data, resp.data, spo2.data, temp.data, walking.data, hrr.data])

  return {
    reading,
    isLoading: all.some(q => q.isLoading),
    isPlaceholderData: all.some(q => q.isPlaceholderData),
    isError: all.some(q => q.isError),
    refetch: () => { for (const q of all) if (q.isError) void q.refetch() },
  }
}
