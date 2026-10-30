import { onApple } from './calendarAreas'
import { itemArea, type AreaInput } from './icloudEvents'
import { useCalendarPrefs } from './useCalendarPrefs'

/** Where an item's calendar event lives — its area's choice in Settings → Calendar (2b-2). Google until the saved
 *  settings are loaded (the defaults are all Google). */
export function useItemCalendarApp(input: AreaInput): 'google' | 'apple' {
  const { prefs } = useCalendarPrefs()
  return onApple(prefs.areas[itemArea(input)]) ? 'apple' : 'google'
}
