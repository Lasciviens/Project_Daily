import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Bell } from 'lucide-react'
import { useUnreadNotices } from '../hooks/useNotifications'
import { NotificationList } from './NotificationList'

/**
 * The bell next to the avatar (top bar and phone header): the unread count, and a drop-down with the newest
 * notifications (the shared NotificationList in its `dropdown` mode) that leads to the Notifications page.
 */
export function NotificationBell() {
  const unread = useUnreadNotices().data ?? 0
  const label = unread ? `Notifications: ${unread} unread` : 'Notifications'
  const count = unread > 99 ? '99+' : String(unread)
  return (
    <Popover>
      <PopoverButton aria-label={label} title={label}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-control text-fg-2 transition-colors duration-100 [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 data-[open]:bg-surface-hover data-[open]:text-fg">
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
        {unread > 0 && (
          <span aria-hidden
            className="absolute right-0 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-micro font-bold leading-none tabular-nums text-on-danger ring-2 ring-canvas">
            {count}
          </span>
        )}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: 'bottom end', gap: 8, padding: 12 }}
        transition
        className="menu w-[min(24rem,calc(100vw-24px))] origin-top-right transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        {({ close }) => <NotificationList mode="dropdown" onDone={close} />}
      </PopoverPanel>
    </Popover>
  )
}
