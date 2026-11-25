import { onApple } from './calendarAreas'
import { itemArea, type AreaInput } from './icloudEvents'
import { useCalendarPrefs } from './useCalendarPrefs'

/** Where an item's calendar event lives: Apple Calendar when its area is in use (Settings → Calendar), else nowhere
 *  ('none' — only in the app). Apple Calendar is the only calendar since Google Calendar went (25.11.2026). */
export function useItemCalendarApp(input: AreaInput): 'apple' | 'none' {
  const { prefs } = useCalendarPrefs()
  return onApple(prefs.areas[itemArea(input)]) ? 'apple' : 'none'
}
