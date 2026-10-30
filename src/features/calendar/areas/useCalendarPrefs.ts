import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { readCalendarPrefs, rewritesEvents, type CalendarPrefs } from './calendarAreas'
import { fetchCalendarPrefs, saveCalendarPrefsChanges } from './calendarPrefsApi'
import { rememberCalendarPrefs } from './calendarPrefsMemory'

/** The saved calendar settings; `loaded` is false while only the defaults are shown — nothing saves from that state. */
export function useCalendarPrefs() {
  // Every read also refreshes the Google calls' copy (calendarPrefsMemory), so a change from another device reaches them.
  const query = useQuery({
    queryKey: qk.calendarPrefs,
    queryFn: () => fetchCalendarPrefs().then(p => { rememberCalendarPrefs(p); return p }),
    placeholderData: readCalendarPrefs(null),
    staleTime: STALE.default,
  })
  return { prefs: query.data ?? readCalendarPrefs(null), loaded: query.isSuccess && !query.isPlaceholderData, failed: query.isError, retry: query.refetch }
}

/** "Calendar settings saved" — and, when the change rewrites events already in Apple Calendar, that they update. */
export function useSaveCalendarPrefs() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_calendar_prefs',
    mutationFn: (v: { base: CalendarPrefs; next: CalendarPrefs }) => saveCalendarPrefsChanges(v.base, v.next),
    successMessage: (_saved, v) => rewritesEvents(v.base, v.next)
      ? 'Calendar settings saved · events in Apple Calendar update in the background'
      : 'Calendar settings saved',
    onSuccess: saved => { qc.setQueryData(qk.calendarPrefs, saved); rememberCalendarPrefs(saved) },
  })
}
