import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Circle, CircleCheck, Clapperboard, Film, KeyRound, ShoppingBag, Sparkles, Settings2 } from 'lucide-react'
import { Button, IconButton, SegmentedControl, Skeleton, ToneDot, Truncate, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { noticeDetail, noticeRoute, noticeTitle, type NoticeKind } from '../notificationKinds'
import type { Notice } from '../api/notificationsApi'
import {
  useActOnNotice, useDropdownNotices, useMarkAllNoticesRead, useMarkNotice, usePageNotices,
} from '../hooks/useNotifications'

// THE notifications list (owner, 12.11.2026: "same job, one component"): the bell's drop-down and the Notifications
// page render this one component. `dropdown` shows the newest few with "See all"; `page` adds the All | Unread switch,
// each row's Read / Unread button and Show more. A mode hides a part, never copies it.

export type NotificationListMode = 'dropdown' | 'page'

const KIND_ICON: Record<NoticeKind, ReactNode> = {
  shop_bought_draft: <ShoppingBag />,
  follow_new_title: <Clapperboard />,
  follow_trailer: <Film />,
  sign_in_expiring: <KeyRound />,
  sign_in_failed: <KeyRound />,
  claude_key_expiring: <Sparkles />,
  claude_key_rejected: <Sparkles />,
}

const SHOWS_PROBLEM: ReadonlySet<NoticeKind> = new Set(['sign_in_failed', 'claude_key_rejected'])

export function NotificationList({ mode, onDone }: { mode: NotificationListMode; onDone?: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const page = mode === 'page'
  const dropdown = useDropdownNotices(!page)
  const paged = usePageNotices(filter === 'unread')
  const rows: Notice[] = page ? (paged.data?.pages.flat() ?? []) : (dropdown.data ?? [])
  const loading = page ? paged.isLoading : dropdown.isLoading
  const failed = page ? paged.isError : dropdown.isError
  const retry = () => void (page ? paged.refetch() : dropdown.refetch())
  const readAll = useMarkAllNoticesRead()
  const today = todayStr()

  return (
    <div className={cx('flex min-w-0 flex-col', page ? 'gap-3' : 'gap-1')}>
      <div className={cx('flex items-center gap-2', !page && 'px-1.5 pt-0.5')}>
        {page
          ? <SegmentedControl size="sm" label="Show" value={filter} onChange={setFilter}
              options={[{ value: 'all', label: 'All', tip: 'All notifications' }, { value: 'unread', label: 'Unread', tip: 'Unread notifications only' }]} />
          : <p className="flex-1 text-ui font-semibold text-fg">Notifications</p>}
        <Button size="sm" variant="ghost" icon={<CheckCheck />} className={page ? 'ml-auto' : undefined}
          tip="Read all: mark every unread notification read" loading={readAll.isPending} onClick={() => readAll.mutate()}>
          Read all
        </Button>
        {!page && (
          <Link to="/settings?tab=notifications" onClick={onDone} aria-label="Settings: where each notification goes" title="Settings: where each notification goes"
            className="icon-btn h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [&_svg]:h-[18px] [&_svg]:w-[18px]">
            <Settings2 aria-hidden />
          </Link>
        )}
      </div>

      {failed ? (
        <p role="alert" className="flex items-center gap-2 px-2 py-2 text-meta text-fg-muted">
          Notifications could not be read.
          <Button size="sm" variant="ghost" onClick={retry}>Try again</Button>
        </p>
      ) : loading ? (
        <ul aria-busy="true" className="flex flex-col gap-1">
          {Array.from({ length: page ? 4 : 3 }, (_, i) => <li key={i}><Skeleton className="h-14 w-full rounded-row" /></li>)}
        </ul>
      ) : rows.length === 0 ? (
        <p className={cx('flex items-center gap-2 text-meta text-fg-muted', page ? 'py-6' : 'px-2.5 py-4')}>
          <Bell className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
          {filter === 'unread' ? 'Nothing unread.' : 'No notifications yet.'}
        </p>
      ) : (
        <ul className={cx('flex flex-col', page ? 'gap-1' : 'gap-0.5')}>
          {rows.map(n => <NoticeRow key={n.id} n={n} today={today} page={page} onDone={onDone} />)}
        </ul>
      )}

      {page && paged.hasNextPage && (
        <Button size="sm" className="self-start" loading={paged.isFetchingNextPage} onClick={() => void paged.fetchNextPage()}
          tip="More: show older notifications">More</Button>
      )}
      {!page && (
        <Link to="/notifications" onClick={onDone} className="menu-item justify-center font-semibold text-accent-600">
          See all
        </Link>
      )}
    </div>
  )
}

function NoticeRow({ n, today, page, onDone }: { n: Notice; today: string; page: boolean; onDone?: () => void }) {
  const modal = useEntityModal()
  const navigate = useNavigate()
  const act = useActOnNotice()
  const mark = useMarkNotice()
  const unread = !n.read_at

  // The way to the thing is fixed per kind (notificationKinds.ts): a Shop thing or a film opens its own popup, the
  // rest their page. Never a URL from the row.
  function open() {
    if (!n.acted_at || unread) act.mutate(n.id)
    onDone?.()
    if (n.kind === 'shop_bought_draft' && n.link_id && n.subject) modal.open({ kind: 'shop-item', id: n.link_id })
    else if ((n.kind === 'follow_new_title' || n.kind === 'follow_trailer') && n.subject_tmdb) modal.open({ kind: 'media', tmdbId: n.subject_tmdb, mediaType: 'movie' })
    else navigate(noticeRoute(n))
  }

  return (
    <li className="flex min-w-0 items-center gap-1">
      <button type="button" onClick={open} className="row row-interactive min-w-0 flex-1 items-start gap-2.5 py-2 text-left">
        <span aria-hidden data-tone={SHOWS_PROBLEM.has(n.kind) ? 'danger' : undefined}
          className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-2 [&_svg]:h-4 [&_svg]:w-4',
            SHOWS_PROBLEM.has(n.kind) ? 'tone-text' : 'text-fg-2')}>
          {KIND_ICON[n.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <Truncate className={cx('text-body', unread ? 'font-semibold text-fg' : 'font-medium text-fg-2')}>{noticeTitle(n, today)}</Truncate>
          <Truncate className="text-meta text-fg-muted">{noticeDetail(n)}</Truncate>
          <span className="text-micro tabular-nums text-fg-faint">{formatDateTime(n.created_at)}</span>
        </span>
        {unread && <span className="mt-2 shrink-0" title="Unread"><ToneDot tone="info" /><span className="sr-only">Unread</span></span>}
      </button>
      {page && (
        <IconButton size="sm" label={unread ? 'Read: mark this notification read' : 'Unread: mark this notification unread'}
          onClick={() => mark.mutate({ id: n.id, read: unread })}>
          {unread ? <CircleCheck /> : <Circle />}
        </IconButton>
      )}
    </li>
  )
}
