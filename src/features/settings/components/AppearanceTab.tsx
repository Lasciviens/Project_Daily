import type { ReactNode } from 'react'
import { Card, CardHeader, PageBoard } from '../../../shared/ui'
import { AccentSwatches, DisplaySizeSwitch, NotificationsControl, ThemeSwitch } from '../../../shared/components/SettingsMenu'
import { APPEARANCE_BOARD, type AppearanceSection } from '../settingsBoards'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <p className="text-body font-medium text-fg">{label}</p>
      {hint && <p className="text-meta text-fg-muted">{hint}</p>}
      <div>{children}</div>
    </div>
  )
}

export function AppearanceTab() {
  const sections: Record<AppearanceSection, ReactNode> = {
    look: (
      <Card>
        <CardHeader title="Look" />
        <Row label="Theme"><ThemeSwitch /></Row>
        <Row label="Accent"><AccentSwatches /></Row>
        <Row label="Display size" hint="Scales the whole app. Smaller fits more on screen — on a monitor 90 % shows the next wider layout. Saved on this device.">
          <DisplaySizeSwitch />
        </Row>
      </Card>
    ),
    notifications: (
      <Card>
        <CardHeader title="Notifications" />
        <div className="-mx-2.5"><NotificationsControl className="menu-item min-h-[44px]" /></div>
      </Card>
    ),
  }
  return <PageBoard sections={sections} layout={APPEARANCE_BOARD} stackClassName="max-w-2xl" />
}
