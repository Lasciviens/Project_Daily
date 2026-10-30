import { useEffect } from 'react'
import { useAutoRefreshCalendarToken } from '../../features/calendar/hooks/useCalendar'
import { useCalendarSeriesTopUp } from '../../features/calendar/hooks/useCalendarSeriesTopUp'
import { useICloudDrainOnOpen } from '../../features/calendar/hooks/useICloudDrainOnOpen'
import { useGoogleTasksBackgroundSync } from '../../features/todo/hooks/useGoogleTasksSync'
import { useRepeatDaysOnOpen } from '../../features/items/useItems'
import { useFootballSyncOnOpen } from '../../features/football/hooks/footballSync'
import { refreshThisDevicePush } from '../../security/accountState'

/**
 * App-wide side effects that must run on every shell route, whatever is on
 * screen. Called once by AppShell. (The Calendar token refresh used to hide
 * inside SettingsMenu, so moving the menu would have silently stopped it.)
 * Full-screen routes outside the shell (/games) should call this too.
 */
export function useAppBootstrap() {
  useAutoRefreshCalendarToken()
  // Google Tasks → app when the app opens or returns to the front (throttled).
  useGoogleTasksBackgroundSync()
  // Repeating plans on Google Calendar: retry what Google didn't take, extend a monthly plan's year of days.
  useCalendarSeriesTopUp()
  // Areas on Apple Calendar (2b-2): what waits for it goes now (the timer catches the rest).
  useICloudDrainOnOpen()
  // A repeat's day is a task on its day (156): the hourly job's fallback when the app opens.
  useRepeatDaysOnOpen()
  // Football (163): a subscribed team's coming matches into the day; a moved kick-off moves its item.
  useFootballSyncOnOpen()
  // Keeps this device's morning brief tied to the current login (security audit).
  useEffect(() => { void refreshThisDevicePush() }, [])
}
