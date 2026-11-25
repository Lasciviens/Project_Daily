import { useCallback, useState } from 'react'
import { hiddenOf, toggleHidden, type MonthKind } from '../monthLines'

/** Which kinds the month calendar hides: remembered on this device (a view choice,
 *  like Owned's layout) and cleared at sign-out (security/accountState.ts). */
export const MONTH_KINDS_KEY = 'lasci.daily.monthHidden'

function read(): MonthKind[] {
  try { return hiddenOf(localStorage.getItem(MONTH_KINDS_KEY)) } catch { return [] }
}

export function useMonthKinds(): { hidden: MonthKind[]; toggle: (kind: MonthKind) => void } {
  const [hidden, setHidden] = useState<MonthKind[]>(read)
  const toggle = useCallback((kind: MonthKind) => {
    setHidden(prev => {
      const next = toggleHidden(prev, kind)
      try { localStorage.setItem(MONTH_KINDS_KEY, JSON.stringify(next)) } catch { /* storage unavailable: kept for this visit */ }
      return next
    })
  }, [])
  return { hidden, toggle }
}
