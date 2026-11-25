// ONE "Connect Google" = one consent for every Google service the app uses (user decision 2026-07-21): since Google
// Calendar went (owner, 25.11.2026: "Google calendar can be removed"; "Calendar only" — Google Tasks stays) that is
// Google Tasks alone. The single refresh token stored by calendar-oauth serves it.
//
// A token given before 25.11.2026 still carries `calendar.events` and `calendar.calendarlist.readonly` until the owner
// revokes the app's access (docs/deploy-checklist.md); nothing uses them, and Google Tasks keeps working on it with no
// reconnect. A new consent asks for Tasks only.
//
// Lives in its own module so the consent list has exactly one definition: the connect button sits in Settings →
// Subscriptions, and nothing else should ever hard-code a second copy of this array.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
]
