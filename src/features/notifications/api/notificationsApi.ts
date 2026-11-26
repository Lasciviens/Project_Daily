import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import {
  NOTICE_SERVICE_SET, isNoticeChannel, isNoticeKind,
  type NoticeChannel, type NoticeFacts, type NoticeKind, type NoticeService,
} from '../notificationKinds'

// The notifications (211/212, docs/features/notifications.md). Rows are the server's: the browser reads them and sets
// read_at and acted_at, nothing else. Every field of an answer is checked here (a row is input too): an unknown kind or
// a field of the wrong shape is left out, never shown. A database before 212 has no feed function: the plain 211 read
// (no names); before 211 no table: none (missing-table guards, never an error). Remove the fallbacks once 212 is live.

export type NoticeLinkKind = 'shop_item' | 'media_follow_event'

export interface Notice extends NoticeFacts {
  id: string
  link_kind: NoticeLinkKind | null
  link_id: string | null
  created_at: string
  read_at: string | null
  acted_at: string | null
  /** A followed film's TMDB id (opens its popup). */
  subject_tmdb: number | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const SUBJECT_MAX = 300
const isMissingTable = (e: { code?: string } | null) => !!e && ['42P01', 'PGRST205'].includes(e.code ?? '')
const isMissingFunction = (e: { code?: string } | null) => !!e && ['42883', 'PGRST202'].includes(e.code ?? '')
const isMissingColumn = (e: { code?: string } | null) => !!e && ['42703', 'PGRST204'].includes(e.code ?? '')

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

/** One row as the screen may show it, or null when any field is not what the kind needs. */
export function noticeFromRow(r: Record<string, unknown>): Notice | null {
  const id = str(r.id), created = stamp(r.created_at)
  if (!id || !UUID.test(id) || !created || !isNoticeKind(r.kind)) return null
  const linkKind = r.link_kind === 'shop_item' || r.link_kind === 'media_follow_event' ? r.link_kind : null
  const linkId = str(r.link_id)
  if ((linkKind === null) !== (r.link_kind == null) || (linkKind && !(linkId && UUID.test(linkId)))) return null
  const service = r.service == null ? null : NOTICE_SERVICE_SET.has(String(r.service)) ? (r.service as NoticeService) : undefined
  if (service === undefined) return null
  const due = r.due_on == null ? null : typeof r.due_on === 'string' && DAY.test(r.due_on) ? r.due_on : undefined
  if (due === undefined) return null
  const subject = str(r.subject)
  const tmdb = typeof r.subject_tmdb === 'number' && Number.isInteger(r.subject_tmdb) && r.subject_tmdb > 0 ? r.subject_tmdb : null
  return {
    id, kind: r.kind as NoticeKind, link_kind: linkKind, link_id: linkKind ? linkId : null, service, due_on: due,
    created_at: created, read_at: stamp(r.read_at), acted_at: stamp(r.acted_at),
    subject: subject ? subject.slice(0, SUBJECT_MAX) : null, subject_tmdb: tmdb,
  }
}

const clean = (rows: unknown): Notice[] =>
  (Array.isArray(rows) ? rows : []).map(r => noticeFromRow(r as Record<string, unknown>)).filter((n): n is Notice => n !== null)

/** The newest notices (the bell: a few; the page: a page of them, older ones with `before`). */
export async function fetchNotices(o: { limit: number; before?: string | null; unreadOnly?: boolean }): Promise<Notice[]> {
  const { data, error } = await supabase.rpc('notification_feed', { p_limit: o.limit, p_before: o.before ?? null, p_unread_only: !!o.unreadOnly })
  if (!error) return clean(data)
  if (isMissingTable(error)) return []
  if (!isMissingFunction(error)) throw error
  // Before 212: 211's columns, no names.
  let q = supabase.from('notifications').select('id, kind, link_kind, link_id, created_at, read_at')
    .order('created_at', { ascending: false }).limit(o.limit)
  if (o.before) q = q.lt('created_at', o.before)
  if (o.unreadOnly) q = q.is('read_at', null)
  const old = await q
  if (old.error) {
    if (isMissingTable(old.error)) return []
    throw old.error
  }
  return clean(old.data)
}

/** How many notices are unread (the bell's count). */
export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (error) {
    if (isMissingTable(error)) return 0
    throw error
  }
  return count ?? 0
}

/** Read or unread again (its Undo). */
export async function setNoticesRead(ids: readonly string[], read: boolean): Promise<void> {
  if (ids.length === 0) return
  const user = await requireUser()
  const { error } = await supabase.from('notifications')
    .update({ read_at: read ? new Date().toISOString() : null }).in('id', [...ids]).eq('user_id', user.id)
  if (error) throw error
}

/** Every unread notice read; answers which ones, so Undo makes exactly those unread again. */
export async function markAllNoticesRead(): Promise<string[]> {
  const user = await requireUser()
  const { data, error } = await supabase.from('notifications')
    .update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null).select('id')
  if (error) throw error
  return ((data ?? []) as { id: unknown }[]).map(r => String(r.id))
}

/** Opened from the notice: read, and acted on (212's acted_at; before 212 only read). */
export async function setNoticeActed(id: string): Promise<void> {
  const user = await requireUser()
  const now = new Date().toISOString()
  const { error } = await supabase.from('notifications').update({ read_at: now, acted_at: now }).eq('id', id).eq('user_id', user.id)
  if (error && isMissingColumn(error)) return setNoticesRead([id], true)
  if (error) throw error
}

// ── Where each kind goes ─────────────────────────────────────────────────────

/** The owner's choices (a kind with no row goes where its default says). */
export async function fetchNoticePrefs(): Promise<Partial<Record<NoticeKind, NoticeChannel>>> {
  const { data, error } = await supabase.from('notification_prefs').select('kind, channel').limit(100)
  if (error) {
    if (isMissingTable(error)) return {}
    throw error
  }
  const out: Partial<Record<NoticeKind, NoticeChannel>> = {}
  for (const r of (data ?? []) as { kind: unknown; channel: unknown }[]) if (isNoticeKind(r.kind) && isNoticeChannel(r.channel)) out[r.kind] = r.channel
  return out
}

export async function saveNoticePref(kind: NoticeKind, channel: NoticeChannel): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('notification_prefs')
    .upsert({ user_id: user.id, kind, channel }, { onConflict: 'user_id,kind' })
  if (error) {
    if (isMissingTable(error)) throw new Error('Notification settings need migration 212, which is not applied yet')
    throw error
  }
}
