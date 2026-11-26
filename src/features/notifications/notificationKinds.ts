// The notifications registry (212, docs/features/notifications.md): every kind the app tells the owner about, where it
// goes by default, and the words and the way to the thing each one shows. A notice row holds no text and no URL (the
// table only has codes: kind, link kind + id, service, end day): its title and route are built here, so a forged row
// can never carry a link. Pure and import-free.
//
// The block between the markers is copied verbatim into supabase/functions/push-send/index.ts (Deno can't import it;
// scripts/verify-notifications.cjs compares the two) — change both. The defaults are also SQL's
// notification_default_channel (212; scripts/verify-db-notifications.mjs compares them).

// <notification-text>
export type NoticeKind =
  | 'shop_bought_draft' | 'follow_new_title' | 'follow_trailer' | 'sign_in_expiring' | 'sign_in_failed'
  | 'claude_key_expiring' | 'claude_key_rejected'
export type NoticeService = 'psn' | 'trakt' | 'strava' | 'google' | 'icloud' | 'anthropic'
export type NoticePush = 'push_now' | 'push_morning' | 'push_weekly'

/** What a notice says and where it leads come only from these facts (a row's codes and its thing's name). */
export interface NoticeFacts {
  kind: NoticeKind
  service: NoticeService | null
  /** The day a sign-in or key ends (YYYY-MM-DD). */
  due_on: string | null
  /** The thing's name, read from its own table (a Shop thing, a film); null when it is gone. */
  subject: string | null
}

export const NOTICE_SERVICE_NAMES: Record<NoticeService, string> = {
  psn: 'PlayStation', trakt: 'Trakt', strava: 'Strava', google: 'Google', icloud: 'Apple Calendar', anthropic: 'Anthropic',
}

const noticeDays = (today: string, day: string) =>
  Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
const noticeDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`

/** "today", "tomorrow", "in 7 days" or "on 10.12.2026" (passed), from the day it ends. */
export function noticeWhen(today: string, day: string): string {
  const left = noticeDays(today, day)
  if (left < 0) return `on ${noticeDate(day)}`
  if (left === 0) return 'today'
  if (left === 1) return 'tomorrow'
  return `in ${left} days`
}

const serviceName = (s: NoticeService | null) => (s ? NOTICE_SERVICE_NAMES[s] ?? 'A service' : 'A service')

/** The notice's one line, in English (`today` is the reader's day, YYYY-MM-DD). */
export function noticeTitle(n: NoticeFacts, today: string): string {
  switch (n.kind) {
    case 'shop_bought_draft': return 'Bought through a plan: check the purchase'
    case 'follow_new_title': return 'New film from a follow'
    case 'follow_trailer': return 'New trailer from a follow'
    case 'sign_in_expiring': return `${serviceName(n.service)} sign-in ends ${n.due_on ? noticeWhen(today, n.due_on) : 'soon'}`
    case 'sign_in_failed': return `${serviceName(n.service)} needs you to sign in again`
    case 'claude_key_expiring': return `Claude API key ends ${n.due_on ? noticeWhen(today, n.due_on) : 'soon'}`
    case 'claude_key_rejected': return 'Anthropic rejected the Claude API key'
    default: return 'Notification'
  }
}

/** The second line: the thing's name, else what to do. */
export function noticeDetail(n: NoticeFacts): string {
  if (n.subject) return n.subject
  switch (n.kind) {
    case 'shop_bought_draft': return 'The thing is not on the list any more'
    case 'follow_new_title': case 'follow_trailer': return 'The film is not in What’s new any more'
    case 'sign_in_expiring': return n.due_on ? `Ends ${noticeDate(n.due_on)} · renew it in Settings → Subscriptions` : 'Renew it in Settings → Subscriptions'
    case 'sign_in_failed': return 'Connect it again in Settings → Subscriptions'
    case 'claude_key_expiring': return n.due_on ? `Ends ${noticeDate(n.due_on)} · make a new key in the Anthropic Console` : 'Make a new key in the Anthropic Console'
    case 'claude_key_rejected': return 'Put a working key in ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets)'
    default: return ''
  }
}

/** The app address a notice leads to (a hash route without the '#'). Fixed per kind: never read from a row. */
export function noticeRoute(n: Pick<NoticeFacts, 'kind'>): string {
  switch (n.kind) {
    case 'shop_bought_draft': return '/shop'
    case 'follow_new_title': case 'follow_trailer': return '/media?view=lists'
    default: return '/settings?tab=subscriptions'
  }
}

/** One push for the notices a run claimed (now, or the weekly digest); null when there are none. */
export function noticePush(items: readonly NoticeFacts[], digest: 'now' | 'weekly', today: string): { title: string; body: string; url: string; tag: string } | null {
  if (items.length === 0) return null
  if (items.length === 1 && digest === 'now') {
    const n = items[0]
    return { title: `🔔 ${noticeTitle(n, today)}`, body: noticeDetail(n), url: `#${noticeRoute(n)}`, tag: 'notifications' }
  }
  const lines = items.slice(0, 4).map(n => (n.subject ? `${noticeTitle(n, today)}: ${n.subject}` : noticeTitle(n, today)))
  const more = items.length > 4 ? ` · +${items.length - 4} more` : ''
  return {
    title: digest === 'weekly' ? `🔔 This week: ${items.length} notification${items.length === 1 ? '' : 's'}` : `🔔 ${items.length} notifications`,
    body: `${lines.join(' · ')}${more}`,
    url: '#/notifications',
    tag: digest === 'weekly' ? 'notifications-weekly' : 'notifications',
  }
}

/** The most of a thing's name a push shows (the bell shows up to 300). */
export const NOTICE_PUSH_SUBJECT_MAX = 60

/** A thing's name as a push may carry it (guardian, 26.11.2026): printable characters only — no control, format or
 *  bidi characters, no line breaks —, spaces folded, at most NOTICE_PUSH_SUBJECT_MAX characters; null when nothing is left. */
export function noticePushSubject(s: string | null): string | null {
  if (!s) return null
  // Line breaks and tabs become a space first; every other control, format (bidi) or private character goes.
  const t = s.replace(/[\t\n\v\f\r\u0085\p{Zl}\p{Zp}]/gu, ' ').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const chars = [...t]
  return chars.length > NOTICE_PUSH_SUBJECT_MAX ? `${chars.slice(0, NOTICE_PUSH_SUBJECT_MAX - 1).join('').trimEnd()}…` : t
}

/** The morning push's one line for the notices sent to the morning ('' when none). */
export function noticeMorningLine(items: readonly NoticeFacts[], today: string): string {
  if (items.length === 0) return ''
  const first = items.slice(0, 2).map(n => noticeTitle(n, today)).join(', ')
  return ` · 🔔 ${first}${items.length > 2 ? ` +${items.length - 2}` : ''}`
}
// </notification-text>

export type NoticeChannel = 'in_app' | NoticePush

export interface NoticeKindInfo {
  kind: NoticeKind
  /** The Settings line. */
  label: string
  /** What sends it, in one sentence. */
  hint: string
  defaultChannel: NoticeChannel
}

/** Every kind, in the order Settings lists them. */
export const NOTICE_KINDS: readonly NoticeKindInfo[] = [
  { kind: 'sign_in_failed', label: 'A sign-in stopped working', hint: 'Trakt, Strava, Google or Apple Calendar refused the stored sign-in: connect it again.', defaultChannel: 'push_now' },
  { kind: 'sign_in_expiring', label: 'A sign-in ends soon', hint: 'PlayStation’s sign-in token: 14, 7 and 1 days before it ends.', defaultChannel: 'push_morning' },
  { kind: 'claude_key_rejected', label: 'Claude API key rejected', hint: 'Anthropic refused the server’s key: the AI features stop until it is replaced.', defaultChannel: 'push_now' },
  { kind: 'claude_key_expiring', label: 'Claude API key ends soon', hint: '14, 7 and 1 days before the end you typed on the Anthropic card.', defaultChannel: 'push_morning' },
  { kind: 'shop_bought_draft', label: 'Bought through a plan', hint: 'A ticked Shop plan marked a thing bought: check the purchase (also in Shop → Needs a look).', defaultChannel: 'in_app' },
  { kind: 'follow_new_title', label: 'New film from a follow', hint: 'A director, actor, studio or series you follow has a new film.', defaultChannel: 'push_weekly' },
  { kind: 'follow_trailer', label: 'New trailer from a follow', hint: 'A new trailer for a film from something you follow.', defaultChannel: 'in_app' },
]

export const NOTICE_KIND_SET: ReadonlySet<string> = new Set(NOTICE_KINDS.map(k => k.kind))
export const isNoticeKind = (k: unknown): k is NoticeKind => typeof k === 'string' && NOTICE_KIND_SET.has(k)
export const NOTICE_SERVICE_SET: ReadonlySet<string> = new Set(Object.keys(NOTICE_SERVICE_NAMES))

export const NOTICE_CHANNELS: readonly { value: NoticeChannel; label: string; tip: string }[] = [
  { value: 'in_app', label: 'In app', tip: 'In app: only the bell, no push' },
  { value: 'push_now', label: 'Now', tip: 'Now: a push within 15 minutes' },
  { value: 'push_morning', label: 'Morning', tip: 'Morning: one line in the morning push' },
  { value: 'push_weekly', label: 'Weekly', tip: 'Weekly: in Monday’s 08:00 digest' },
]
export const isNoticeChannel = (c: unknown): c is NoticeChannel => typeof c === 'string' && NOTICE_CHANNELS.some(x => x.value === c)
