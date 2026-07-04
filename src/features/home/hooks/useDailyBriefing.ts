import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { generateDailyBriefing } from '../api/briefingApi'

const STORAGE_KEY = 'lasci.dailyBriefing'

interface CachedBriefing {
  date: string   // yyyy-MM-dd it was generated for
  text: string
}

function readCache(): CachedBriefing | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CachedBriefing) : null
  } catch {
    return null
  }
}

function writeCache(entry: CachedBriefing): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // localStorage unavailable (private mode etc.) — briefing just won't persist
  }
}

/**
 * Daily AI briefing — generated automatically at most ONCE per calendar day.
 *
 * Once-a-day enforcement: the query key is the date, staleTime is Infinity, and
 * initialData is seeded from localStorage when the cached entry is for today.
 * With initialData present the query is considered fresh → no fetch. On a new
 * day the key changes, initialData is undefined → it generates exactly once,
 * then persists. `regenerate` (refetch) is the explicit manual override.
 */
export function useDailyBriefing() {
  const today  = format(new Date(), 'yyyy-MM-dd')
  const cached = readCache()

  const query = useQuery({
    queryKey:  ['dailyBriefing', today],
    queryFn:   generateDailyBriefing,
    initialData: cached?.date === today ? cached.text : undefined,
    staleTime: Infinity,
    gcTime:    Infinity,
    retry:     false,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
  })

  // Persist whatever we end up with (initial-seed or freshly generated) so a
  // later reload the same day shows it without another AI call.
  useEffect(() => {
    if (query.data) writeCache({ date: today, text: query.data })
  }, [query.data, today])

  return {
    text:        query.data ?? null,
    isLoading:   query.isFetching && !query.data,
    error:       query.error as Error | null,
    regenerate:  () => query.refetch(),
    isRefreshing: query.isFetching,
  }
}
