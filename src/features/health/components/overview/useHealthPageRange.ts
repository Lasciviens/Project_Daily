import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { isPeriod, type Period } from '../period'
import type { HealthRange } from '../sectionTypes'

// The page's ONE day + period, kept in the URL (?date=&period=) so Daily's
// "Details" link (…/health?date=2026-09-20&period=day) opens exactly that day
// and a reload keeps what you were looking at. No date = today, and "today"
// follows the clock: the page re-renders when the day changes, so a tab left
// open overnight moves on. Changes REPLACE the
// history entry — stepping through dates shouldn't fill the Back stack.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_PERIOD: Period = 'week'

function useToday(): string {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const check = () => setToday(t => (t === todayStr() ? t : todayStr()))
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

function parse(params: URLSearchParams, today: string): { anchor: string; period: Period } {
  const rawDate = params.get('date')
  const rawPeriod = params.get('period')
  return {
    anchor: rawDate && DATE_RE.test(rawDate) && rawDate < today ? rawDate : today,
    period: isPeriod(rawPeriod) ? rawPeriod : DEFAULT_PERIOD,
  }
}

export function useHealthPageRange(): HealthRange & { today: string } {
  const [params, setParams] = useSearchParams()
  const today = useToday()
  const { anchor, period } = parse(params, today)

  // A chart drill-down calls setPeriod('day') then setAnchor(date) in one
  // handler; both must land. The router's functional update reads the SAME
  // location twice, so the second write would drop the first — keep the
  // params written in this tick and build on them.
  const pending = useRef<URLSearchParams | null>(null)
  const update = useCallback((change: (cur: { anchor: string; period: Period }) => { anchor: string; period: Period }) => {
    const now = todayStr()
    const base = new URLSearchParams(pending.current ?? params)
    const next = change(parse(base, now))
    const date = next.anchor > now ? now : next.anchor
    if (date >= now) base.delete('date'); else base.set('date', date)
    if (next.period === DEFAULT_PERIOD) base.delete('period'); else base.set('period', next.period)
    pending.current = base
    queueMicrotask(() => { pending.current = null })
    setParams(base, { replace: true })
  }, [params, setParams])

  const setAnchor = useCallback((v: SetStateAction<string>) => {
    update(cur => ({ ...cur, anchor: typeof v === 'function' ? v(cur.anchor) : v }))
  }, [update])

  const setPeriod = useCallback((v: SetStateAction<Period>) => {
    update(cur => ({ ...cur, period: typeof v === 'function' ? v(cur.period) : v }))
  }, [update])

  return { anchor, setAnchor, period, setPeriod, today }
}
