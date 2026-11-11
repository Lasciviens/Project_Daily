import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { readCalendarSettings, rewritesEvents, type CalendarPrefs, type CalendarSettings } from './calendarAreas'
import { fetchCalendarPrefs, saveCalendarPrefsChanges } from './calendarPrefsApi'
import { rememberCalendarPrefs, rememberedCalendarPrefsRead } from './calendarPrefsMemory'

// A read or save of the settings less than a minute old — the Apple Calendar checks at start read them first
// (appleAreas.prefsNow) — is this query's first answer, with its own time: the page that opens right after
// doesn't send the same request again. Later reads follow staleTime as before.
const recentRead = () => rememberedCalendarPrefsRead(60_000)

/** The saved calendar settings; `loaded` is false while only the defaults are shown — nothing saves from that state. */
export function useCalendarPrefs() {
  // Every read also refreshes the Google calls' copy (calendarPrefsMemory), so a change from another device reaches them.
  const query = useQuery({
    queryKey: qk.calendarPrefs,
    queryFn: () => fetchCalendarPrefs().then(p => { rememberCalendarPrefs(p); return p }),
    initialData: () => recentRead()?.prefs,
    initialDataUpdatedAt: () => recentRead()?.at,
    placeholderData: readCalendarSettings(null),
    staleTime: STALE.default,
  })
  return { prefs: query.data ?? readCalendarSettings(null), loaded: query.isSuccess && !query.isPlaceholderData, failed: query.isError, retry: query.refetch }
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

/** Settings → Calendar → Item screen: whether every row shows where its field goes. Saved at once, over the rest. */
export function useSaveShowMarks() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_show_marks',
    mutationFn: (v: { base: CalendarSettings; showMarks: boolean }) => saveCalendarPrefsChanges(v.base, { ...v.base, showMarks: v.showMarks }),
    successMessage: (_saved, v) => (v.showMarks ? 'The item screen shows where each field goes' : 'The item screen hides where each field goes'),
    onSuccess: saved => { qc.setQueryData(qk.calendarPrefs, saved); rememberCalendarPrefs(saved) },
  })
}
