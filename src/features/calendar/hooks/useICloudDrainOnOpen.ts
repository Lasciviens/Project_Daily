import { useEffect, useRef } from 'react'
import { anyAreaOnAppleNow, drainICloudNow } from '../areas/appleAreas'

/**
 * Once per app open, when an area is on Apple Calendar (2b-2): what waits in the queue goes to Apple now — a change
 * made on the server since (a training moved, a repeat's day) or one a save couldn't send. Silent: nothing was asked
 * for; the timer (175) sends it within minutes anyway.
 */
export function useICloudDrainOnOpen() {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void anyAreaOnAppleNow().then(on => { if (on) void drainICloudNow() })
  }, [])
}
