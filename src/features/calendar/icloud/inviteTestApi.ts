import { call } from './icloudApi'

// The invite test (25.11.2026): a one-off live test of Apple Calendar invitations.
// One event in the Personal calendar, tomorrow 12:00–12:30, organized by the owner's own iCloud address, inviting 1–2
// addresses — iCloud emails them in the owner's name. The server builds the event, its place and the organizer; the
// browser names only the guests (docs/integrations/icloud-caldav.md → The invite test).

export type InvitePartstat = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'OTHER'

export interface InviteTestGuest {
  /** The address; null = one the test doesn't take (added on the iPhone, say). */
  email:          string | null
  /** The guest's answer as iCloud keeps it (RFC 5545 PARTSTAT). */
  partstat:       InvitePartstat
  /** iCloud's delivery code for the guest (RFC 6638 SCHEDULE-STATUS), when it gave one. */
  scheduleStatus: string | null
}

/** The test event as iCloud has it now, read after every action. */
export interface InviteTestState {
  exists:      boolean
  /** The event at the test's place is the app's own test event. */
  ours:        boolean
  /** yyyy-MM-dd while it is still 12:00–12:30 on Oslo's clock; null once moved. */
  day:         string | null
  sequence:    number | null
  etag:        string | null
  scheduleTag: string | null
  /** Masked ("o…@icloud.com"), as the iCloud card shows the Apple ID. */
  organizer:   string | null
  guests:      InviteTestGuest[]
  /** Send, Rewrite and Remove guest used today (Oslo's day), of `cap`. */
  used:        number
  cap:         number
}

export const checkInviteTest = () => call<InviteTestState>('inviteCheck')
export const sendInviteTest = (guests: string[]) => call<InviteTestState>('inviteSend', { guests })
/** `etag`: the version the card showed — the server refuses when the event changed since ("tap Check"). */
export const rewriteInviteTest = (etag: string) => call<InviteTestState>('inviteRewrite', { etag })
export const removeInviteGuest = (guest: string, etag: string) => call<InviteTestState>('inviteRemoveGuest', { guest, etag })
export const deleteInviteTest = () => call<InviteTestState>('inviteDelete')
