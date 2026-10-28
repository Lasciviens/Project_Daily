import { useEffect, useState } from 'react'
import { todayStr } from '../utils/dateUtils'

/** Today's local date (YYYY-MM-DD), kept current while the app stays open:
 *  re-checked when the app comes back, on focus and every minute — an
 *  installed app left open overnight wakes up on the next day. */
export function useTodayStr(): string {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const check = () => setToday(prev => (prev === todayStr() ? prev : todayStr()))
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    const id = setInterval(check, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      clearInterval(id)
    }
  }, [])
  return today
}

/** A page's viewed day that was today moves on with the date (the app
 *  resumed the next morning: water and food log to the new day, not
 *  yesterday's). A day picked on purpose stays. Call during render, from the
 *  component that owns `day`. */
export function useFollowToday(day: string, setDay: (day: string) => void): void {
  const today = useTodayStr()
  const [seen, setSeen] = useState(today)
  if (today !== seen) {
    setSeen(today)
    if (day === seen) setDay(today)
  }
}
