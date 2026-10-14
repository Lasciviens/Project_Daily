import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { todayStr } from '../../../shared/utils/dateUtils'
import { addPlansToCalendar } from '../api/scheduleSeriesCalendar'
import { addPlansProgressText, addPlansResultText, plansToAddToCalendar } from '../calendarSeries'
import type { ScheduleBlock } from '../../daily/types'

/**
 * Every repeating plan not on Google Calendar yet, added in one tap (owner,
 * 14.10.2026 — instead of opening each plan, ticking the box and saving).
 * The same series code as the planner's box, so each starts on Google from
 * today (148). Says how many went and how many wait for the next app open.
 */
export function useAddPlansToCalendar() {
  return useMutationWithFeedback({
    action: 'add_plans_to_calendar',
    loadingMessage: (rows: readonly ScheduleBlock[]) => addPlansProgressText(plansToAddToCalendar(rows, todayStr()).length),
    mutationFn: async (rows: readonly ScheduleBlock[]) => {
      const result = await addPlansToCalendar(rows)
      // None went: an error toast (they wait on the retry list all the same).
      if (!result.added && result.failed) throw new Error(addPlansResultText(result))
      return result
    },
    successMessage: addPlansResultText,
    // The series' instances join the day's Google events (the agenda hides them as linked).
    invalidates: ['schedule'],
  })
}
