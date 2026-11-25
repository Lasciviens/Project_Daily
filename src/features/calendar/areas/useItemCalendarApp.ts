import { onApple } from './calendarAreas'
import { itemArea, type AreaInput } from './icloudEvents'
import { useCalendarPrefs } from './useCalendarPrefs'
import { useICloudStatus } from '../icloud/useICloud'
import type { CalendarApp } from '../../items/itemRules'

/** Where an item's calendar event lives: Apple Calendar when its area is in use (Settings → Calendar) and iCloud is
 *  connected; 'icloud-off' when the area is in use but iCloud says it is not connected (the item waits in the queue,
 *  and nothing says "Apple Calendar"); else nowhere ('none' — only in the app). Apple Calendar is the only calendar
 *  since Google Calendar went (25.11.2026). While the status is read (or the read failed) it stays Apple's. */
export function useItemCalendarApp(input: AreaInput): CalendarApp {
  const { prefs } = useCalendarPrefs()
  const icloud = useICloudStatus()
  if (!onApple(prefs.areas[itemArea(input)])) return 'none'
  return icloud.data?.connected === false ? 'icloud-off' : 'apple'
}
