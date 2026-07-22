import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getISOWeek, getISOWeekYear } from 'date-fns'
import { generateWeeklyReview } from '../api/weeklyReviewApi'

const STORAGE_KEY = 'lasci.weeklyReview'

interface CachedReview { week: string; text: string }

function weekKey(): string {
  const now = new Date()
  return `${getISOWeekYear(now)}-W${String(getISOWeek(now)).padStart(2, '0')}`
}

function readCache(): CachedReview | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as CachedReview : null }
  catch { return null }
}
function writeCache(entry: CachedReview): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entry)) } catch { /* private mode */ }
}

/**
 * Weekly AI review — generated automatically at most ONCE per ISO week, same
 * lazy+cached mechanism as the daily briefing: query key = the ISO week, initial
 * data seeded from localStorage when it's for the current week, staleTime
 * Infinity. New week → key changes → generates once. `regenerate` is the manual
 * override. Disabled while the card is collapsed so no AI request is spent.
 */
export function useWeeklyReview(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const week   = weekKey()
  const cached = readCache()

  const query = useQuery({
    queryKey:    ['weeklyReview', week],
    queryFn:     generateWeeklyReview,
    enabled,
    initialData: cached?.week === week ? cached.text : undefined,
    staleTime:   Infinity,
    gcTime:      Infinity,
    retry:       false,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
  })

  useEffect(() => {
    if (query.data) writeCache({ week, text: query.data })
  }, [query.data, week])

  return {
    text:         query.data ?? null,
    isLoading:    query.isFetching && !query.data,
    error:        query.error as Error | null,
    regenerate:   () => query.refetch(),
    isRefreshing: query.isFetching,
  }
}
