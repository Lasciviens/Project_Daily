import { useQuery } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { switchNeedsAttention, switchResultText, type AreaSwitch, type CalendarPrefs } from './calendarAreas'
import { previewSwitches, switchAreas, type MoveFrom, type SwitchProgress } from './areaMoveApi'

/** How many items each switched area moves — read when the move popup opens, never cached for later. */
export function useAreaSwitchPreview(switches: readonly AreaSwitch[], from: MoveFrom) {
  const key = switches.map(s => `${s.area}:${s.to}`).join(',')
  return useQuery({
    queryKey: qk.icloud.movePreview(key, from),
    queryFn: () => previewSwitches(switches, from),
    enabled: switches.length > 0,
    staleTime: 0,
    gcTime: 0,
  })
}

/** Save the calendar settings and move the switched areas' items (the new copy first, then the old one goes).
 *  One line says where everything is; a warning when something stayed behind. */
export function useSwitchAreas() {
  return useMutationWithFeedback({
    action: 'calendar_switch_areas',
    mutationFn: (v: {
      previous: CalendarPrefs; next: CalendarPrefs; switches: readonly AreaSwitch[]; from: MoveFrom; icloudConnected: boolean
      onProgress: (p: SwitchProgress) => void
    }) => switchAreas(v.previous, v.next, v.switches, v.from, v.icloudConnected, v.onProgress),
    successMessage: r => (switchNeedsAttention(r) ? undefined : switchResultText(r)),
    onSuccess: r => { if (switchNeedsAttention(r)) toast.warning(switchResultText(r)) },
    // The status only: the popup's own count must not be asked again as it closes.
    invalidates: [qk.calendarPrefs, qk.icloud.status(), 'taskGraph'],
  })
}
