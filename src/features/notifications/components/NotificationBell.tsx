import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Bell } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { useUnreadNotices } from '../hooks/useNotifications'
import { NotificationList } from './NotificationList'

/**
 * The bell next to the avatar (top bar and phone header): the unread count, and a drop-down with the newest
 * notifications (the shared NotificationList in its `dropdown` mode) that leads to the Notifications page. `bar`: bordered
 * like the top bar's Ask AI and Requests; `header`: a plain icon button like the phone header's.
 */
export function NotificationBell({ look }: { look: 'bar' | 'header' }) {
  const unread = useUnreadNotices().data ?? 0
  const label = unread ? `Notifications: ${unread} unread` : 'Notifications'
  const count = unread > 99 ? '99+' : String(unread)
  return (
    <Popover>
      <PopoverButton aria-label={label} title={label}
        className={cx(look === 'bar'
          ? 'relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-control border border-line bg-surface px-2.5 text-fg-2 transition-colors duration-100 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:h-11 data-[open]:border-accent-500/30 data-[open]:bg-accent-50 data-[open]:text-accent-700'
          : 'icon-btn relative data-[open]:bg-accent-50 data-[open]:!text-accent-700')}>
        <Bell className={look === 'bar' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} strokeWidth={look === 'bar' ? 2 : 1.9} aria-hidden />
        {unread > 0 && (
          <span aria-hidden
            className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-micro font-bold leading-none tabular-nums text-on-danger ring-2 ring-canvas">
            {count}
          </span>
        )}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: 'bottom end', gap: 8, padding: 12 }}
        transition
        className="menu [--anchor-max-height:calc(100dvh-9rem)] w-[min(24rem,calc(100vw-24px))] origin-top-right overscroll-contain transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        {({ close }) => <NotificationList mode="dropdown" onDone={close} />}
      </PopoverPanel>
    </Popover>
  )
}
