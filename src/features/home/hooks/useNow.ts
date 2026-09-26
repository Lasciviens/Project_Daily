import { useEffect, useState } from 'react'

/** Current time in ms, re-read every `intervalMs` while `active` (for "in N min" labels). */
export function useNow(active: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0) // catch up at once after being inactive
    const id = setInterval(tick, intervalMs)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [active, intervalMs])
  return now
}
