import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { todayStr } from '../../../../shared/utils/dateUtils'

// Anchor defaults to "today" and DateNav lets the user navigate to past
// dates. Bug this fixes: if the tab stays open across midnight (or the PWA
// doesn't reload for a while), "today" moves on without the component
// re-mounting, so the anchor silently froze at whatever day the section was
// first opened — each section froze independently, so Heart and Energy could
// show different stale "last date"s depending on when each was last viewed.
// This re-checks on focus/visibility/interval and advances the anchor ONLY
// if it still equals the previously-known "today" (i.e. the user never
// navigated away from today) — an intentional look-back stays untouched.
export function useAnchorDate(): [string, Dispatch<SetStateAction<string>>] {
  const [anchor, setAnchor] = useState(todayStr())
  const lastTodayRef = useRef(todayStr())

  useEffect(() => {
    function checkForNewDay() {
      const current = todayStr()
      if (current !== lastTodayRef.current) {
        const previous = lastTodayRef.current
        lastTodayRef.current = current
        setAnchor(a => (a === previous ? current : a))
      }
    }
    document.addEventListener('visibilitychange', checkForNewDay)
    window.addEventListener('focus', checkForNewDay)
    const interval = setInterval(checkForNewDay, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', checkForNewDay)
      window.removeEventListener('focus', checkForNewDay)
      clearInterval(interval)
    }
  }, [])

  return [anchor, setAnchor]
}
