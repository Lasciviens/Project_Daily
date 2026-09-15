// ONE "Connect Google" = one consent covering every Google service the app
// pulls (user decision 2026-07-21, supersedes the earlier per-service-client
// plan): Calendar + Tasks. The single refresh token stored by calendar-oauth
// then serves both. Adding a future scope (Gmail briefing, contacts
// birthdays, …) = append here + one re-consent.
//
// `calendar.calendarlist.readonly` (added — real bug, fixed): without it,
// `GET /users/me/calendarList` (calendarApi.ts's fetchCalendarList, used by
// useCalendarList) 403s, so a user's SUBSCRIBED/secondary calendars never
// populated the calendar picker (WeekWidget's "⊞ Filter calendars") at all —
// `calendar.events` only grants read/write on EVENTS, never on calendar
// list/metadata. This is the narrowest scope that covers it (never the
// broader `calendar`/`calendar.readonly`, which would also grant read access
// to every OTHER calendar's full settings). Existing connected users must
// reconnect once to pick up a new scope — the app has no way to silently
// widen an already-granted consent.
//
// Lives in its own module so the consent list has exactly one definition:
// the connect button now sits in Developer → Connections, but nothing else
// should ever hard-code a second copy of this array.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks',
]
