import { CalendarPlus } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { plansToAddToCalendar } from '../calendarSeries'
import { useAddPlansToCalendar } from '../hooks/useAddPlansToCalendar'

/**
 * Settings → Subscriptions → Google: puts every repeating plan that isn't on
 * Google Calendar yet on it in one tap (148). Shown only while there is one
 * to add; each starts on Google from today, never with its past weeks.
 */
export function AddPlansToCalendarButton() {
  const { data: rows = [] } = useScheduleBlocks()
  const add = useAddPlansToCalendar()
  const count = plansToAddToCalendar(rows, todayStr()).length
  if (!count && !add.isPending) return null
  return (
    <Button
      size="sm" icon={<CalendarPlus />} loading={add.isPending} onClick={() => add.mutate(rows)}
      title="Add every repeating plan that isn't on Google Calendar yet — each starts there today"
    >
      Add {count} plan{count === 1 ? '' : 's'} to Calendar
    </Button>
  )
}
