import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import {
  fetchNoticePrefs, fetchNotices, fetchUnreadCount, markAllNoticesRead, saveNoticePref, setNoticeActed, setNoticesRead,
} from '../api/notificationsApi'
import { fetchClaudeKeyDates, saveClaudeKeyDates } from '../api/keyExpiryApi'
import { NOTICE_KINDS, SHOP_NOTICE_KINDS, type NoticeChannel, type NoticeKind } from '../notificationKinds'
import { formatDate } from '../../../shared/utils/dateFormat'

// A film notice and its What's new event share one "read" (212's triggers), so a read refreshes both.
const NOTICE_READS = [qk.notifications.all, qk.mediaFollows.events()] as const

/** The bell's few newest notices. */
export const DROPDOWN_LIMIT = 8
/** One page of the Notifications page (older ones load with Show more). */
export const PAGE_SIZE = 30

/** The unread count on the bell: read again every 5 minutes and when the app comes back to the front. */
export function useUnreadNotices() {
  return useQuery({ queryKey: qk.notifications.unread(), queryFn: fetchUnreadCount, staleTime: STALE.short, refetchInterval: 5 * 60_000 })
}

/** The bell's newest few (only while its drop-down is open). */
export function useDropdownNotices(enabled: boolean) {
  return useQuery({
    queryKey: qk.notifications.feed('dropdown', false),
    queryFn: () => fetchNotices({ limit: DROPDOWN_LIMIT }),
    staleTime: STALE.short,
    enabled,
  })
}

/** The page's list, a page at a time, newest first (all, or only the unread; only while the page shows it). */
export function usePageNotices(unreadOnly: boolean, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.notifications.feed('page', unreadOnly),
    queryFn: ({ pageParam }) => fetchNotices({ limit: PAGE_SIZE, before: pageParam, unreadOnly }),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.length < PAGE_SIZE ? undefined : last[last.length - 1].created_at),
    staleTime: STALE.short,
    enabled,
  })
}

/** The most unread Shop notices Needs a look lists (the feed's own cap). */
export const SHOP_LIMIT = 200

/** Shop → Needs a look's notices: the unread ones of the Shop's kinds (its list and its count read this one query). */
export function useShopNotices(enabled = true) {
  return useQuery({
    queryKey: qk.notifications.feed('shop', true),
    queryFn: () => fetchNotices({ limit: SHOP_LIMIT, unreadOnly: true, kinds: SHOP_NOTICE_KINDS }),
    staleTime: STALE.short,
    enabled,
  })
}

/** Read or unread one notice, with "Marked read · Undo". */
export function useMarkNotice() {
  const back = useMutationWithFeedback({
    action: 'notice_read_undo',
    successMessage: (_r: void, v: { id: string; read: boolean }) => (v.read ? 'Read' : 'Unread'),
    mutationFn: (v: { id: string; read: boolean }) => setNoticesRead([v.id], v.read),
    invalidates: NOTICE_READS,
  })
  return useMutationWithFeedback({
    action: 'notice_read',
    silent: 'its own toast reports it with Undo',
    mutationFn: (v: { id: string; read: boolean }) => setNoticesRead([v.id], v.read),
    onSuccess: (_r: void, v: { id: string; read: boolean }) => {
      toast.undo(v.read ? 'Marked read' : 'Marked unread', () => back.mutate({ id: v.id, read: !v.read }))
    },
    invalidates: NOTICE_READS,
  })
}

/** Every unread one read, with Undo (which makes exactly those unread again). */
export function useMarkAllNoticesRead() {
  const back = useMutationWithFeedback({
    action: 'notice_all_read_undo',
    successMessage: 'Unread again',
    mutationFn: (ids: string[]) => setNoticesRead(ids, false),
    invalidates: NOTICE_READS,
  })
  return useMutationWithFeedback({
    action: 'notice_all_read',
    successMessage: (ids: string[]) => (ids.length === 0 ? 'Nothing unread' : undefined),
    mutationFn: () => markAllNoticesRead(),
    onSuccess: (ids: string[]) => {
      if (ids.length) toast.undo(`${ids.length} marked read`, () => back.mutate(ids))
    },
    invalidates: NOTICE_READS,
  })
}

/** Opening the thing from a notice marks it read and acted on; the thing opening is the visible result. */
export function useActOnNotice() {
  return useMutationWithFeedback({
    action: 'notice_acted',
    silent: 'opening the thing is the visible result',
    mutationFn: (id: string) => setNoticeActed(id),
    invalidates: NOTICE_READS,
  })
}

// ── Where each kind goes ─────────────────────────────────────────────────────

export function useNoticePrefs() {
  return useQuery({ queryKey: qk.notifications.prefs(), queryFn: fetchNoticePrefs, staleTime: STALE.default })
}

const CHANNEL_WORDS: Record<NoticeChannel, string> = {
  in_app: 'in the app only', push_now: 'as a push within 15 minutes', push_morning: 'in the morning push', push_weekly: 'in Monday’s digest',
}

export function useSaveNoticePref() {
  return useMutationWithFeedback({
    action: 'notice_pref_save',
    successMessage: (_r: void, v: { kind: NoticeKind; channel: NoticeChannel }) =>
      `${NOTICE_KINDS.find(k => k.kind === v.kind)?.label ?? 'Notification'}: ${CHANNEL_WORDS[v.channel]}`,
    mutationFn: (v: { kind: NoticeKind; channel: NoticeChannel }) => saveNoticePref(v.kind, v.channel),
    invalidates: [qk.notifications.prefs()],
  })
}

// ── The Claude API key's dates ───────────────────────────────────────────────

export function useClaudeKeyDates() {
  return useQuery({ queryKey: qk.notifications.keyDates(), queryFn: fetchClaudeKeyDates, staleTime: STALE.default })
}

export function useSaveClaudeKeyDates() {
  return useMutationWithFeedback({
    action: 'claude_key_dates_save',
    successMessage: (r: { ends_on: string }) => `Key dates saved · ends ${formatDate(r.ends_on)}`,
    mutationFn: saveClaudeKeyDates,
    invalidates: [qk.notifications.all],
  })
}

/** Clearing the dates asks, then "Key dates cleared · Undo" (the one delete flow). */
export function useClearClaudeKeyDates() {
  return useRowsDelete({ table: 'integration_expiry', action: 'claude_key_dates_clear', invalidates: [qk.notifications.all] })
}
