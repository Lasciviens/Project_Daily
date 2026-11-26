import type { ReactNode } from 'react'
import { Card, CardHeader, PageBoard, SegmentedControl, Skeleton, type BoardLayouts } from '../../../shared/ui'
import { NotificationsControl } from '../../../shared/components/SettingsMenu'
import { NOTICE_CHANNELS, NOTICE_KINDS, type NoticeChannel } from '../notificationKinds'
import { useNoticePrefs, useSaveNoticePref } from '../hooks/useNotifications'

// Settings → Notifications (212): this device's push switch, and every kind the app tells the owner about with where
// it goes — the list is the code registry (notificationKinds.ts), so this is also how the owner sees what the app
// watches. A kind with no choice saved goes where its default says.

type NotificationSettingsSection = 'device' | 'kinds'
// Two bounded cards: on a phone one list; from the laptop the device beside the (longer) list of kinds.
const NOTIFICATION_SETTINGS_BOARD: BoardLayouts<NotificationSettingsSection> = {
  1: ['kinds', 'device'],
  2: { main: '42rem', columns: [['kinds'], ['device']] },
}

export function NotificationSettingsTab() {
  const sections: Record<NotificationSettingsSection, ReactNode> = {
    device: (
      <Card>
        <CardHeader title="This device" />
        <div className="-mx-2.5"><NotificationsControl className="menu-item min-h-[44px]" /></div>
        <p className="mt-2 text-meta text-fg-muted">
          A push reaches the app installed on the iPhone home screen, with notifications turned on. Every push shows on the
          lock screen, and it can arrive a few minutes late.
        </p>
      </Card>
    ),
    kinds: <NoticeKindsCard />,
  }
  return <PageBoard sections={sections} layout={NOTIFICATION_SETTINGS_BOARD} stackClassName="max-w-2xl" />
}

function NoticeKindsCard() {
  const prefs = useNoticePrefs()
  const save = useSaveNoticePref()
  return (
    <Card>
      <CardHeader title="What the app tells you" />
      <p className="text-meta text-fg-muted">
        Every notification shows under the bell. Now: a push within 15 minutes. Morning: one line in the morning push.
        Weekly: Monday’s 08:00 digest.
      </p>
      <ul className="mt-1 flex flex-col">
        {NOTICE_KINDS.map(k => {
          const value: NoticeChannel = prefs.data?.[k.kind] ?? k.defaultChannel
          return (
            <li key={k.kind} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
              <div className="min-w-0">
                <p className="text-body font-medium text-fg">{k.label}</p>
                <p className="text-meta text-fg-muted">{k.hint}</p>
              </div>
              {prefs.isLoading
                ? <Skeleton className="h-9 w-64 rounded-control" />
                : <SegmentedControl size="sm" fit label={`${k.label}: where it goes`} value={value}
                    onChange={channel => save.mutate({ kind: k.kind, channel })}
                    options={NOTICE_CHANNELS.map(c => ({ value: c.value, label: c.label, tip: c.tip }))} />}
            </li>
          )
        })}
      </ul>
      {prefs.isError && <p role="alert" className="text-meta text-fg-muted">Your choices could not be read: the defaults show.</p>}
    </Card>
  )
}
