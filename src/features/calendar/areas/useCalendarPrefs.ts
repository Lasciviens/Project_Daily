import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { readCalendarPrefs, type CalendarPrefs } from './calendarAreas'
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

/** "Calendar settings saved". The written row is the result. */
export function useSaveCalendarPrefs() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_calendar_prefs',
    mutationFn: (v: { base: CalendarPrefs; next: CalendarPrefs }) => saveCalendarPrefsChanges(v.base, v.next),
    successMessage: 'Calendar settings saved',
    onSuccess: saved => { qc.setQueryData(qk.calendarPrefs, saved); rememberCalendarPrefs(saved) },
  })
}
