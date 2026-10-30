import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidate, qk } from '../../../shared/query'
import { anyAreaOnAppleNow, drainICloudNow } from '../areas/appleAreas'

/** At most this often when the app comes back to the front (it reads iCloud each time). */
const AGAIN_AFTER_MS = 2 * 60_000

/**
 * When the app opens or comes back to the front (at most every 2 minutes), while an area is on Apple Calendar (2b-2,
 * 2c): changes made in Apple Calendar come back first — the day's lists and Settings → Calendar are read again when
 * they did — then what waits in the queue goes to Apple. Silent: nothing was asked for; the timer does the same every
 * few minutes anyway.
 */
export function useICloudDrainOnOpen() {
  const qc = useQueryClient()
  const last = useRef(0)
  useEffect(() => {
    const run = () => {
      if (Date.now() - last.current < AGAIN_AFTER_MS) return
      last.current = Date.now()
      void anyAreaOnAppleNow().then(async on => {
        if (!on) return
        const r = await drainICloudNow({ look: true })
        if (r.readBackApplied) void invalidate(qc, 'taskGraph')
        if (r.calendarsRenamed) void qc.invalidateQueries({ queryKey: qk.calendarPrefs })
      })
    }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [qc])
}
