import { useEffect, useState } from 'react'

/** Now, to the minute (ISO): the Football page and the favourites' glance move a match from coming up to live to a result as time passes. */
export function useMinute(): string {
  const stamp = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  const [now, setNow] = useState(stamp)
  useEffect(() => {
    const id = window.setInterval(() => setNow(stamp()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}
