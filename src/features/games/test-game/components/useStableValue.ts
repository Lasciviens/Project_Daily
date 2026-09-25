import { useEffect, useState } from 'react'

/**
 * `value`, once it has stopped changing for `delayMs`.
 *
 * Arrowing along the shelf changes the selection several times a second; this
 * is what keeps each passing game from firing its own store request. The first
 * value is returned immediately, so opening one game costs no delay.
 */
export function useStableValue<T>(value: T, delayMs = 350): T {
  const [stable, setStable] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setStable(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return stable
}
