import { useAutoRefreshCalendarToken } from '../../features/calendar/hooks/useCalendar'

/**
 * App-wide side effects that must run on every shell route, whatever is on
 * screen. Called once by AppShell. (The Calendar token refresh used to hide
 * inside SettingsMenu, so moving the menu would have silently stopped it.)
 * Full-screen routes outside the shell (/games) should call this too.
 */
export function useAppBootstrap() {
  useAutoRefreshCalendarToken()
}
