import { PageBoard } from '../../../../shared/ui'
import { KOBO_BOARD } from '../../booksBoard'
import { AskedCard } from './AskedCard'
import { KoboDeviceCard } from './KoboDeviceCard'
import { KoboSettingsCard } from './KoboSettingsCard'
import { MenuOrderCard } from './MenuOrderCard'
import { SleepScreenCard } from './SleepScreenCard'

/** Control the Kobo from the app: sleep screen, KOReader settings and menus, what it reported. */
export function KoboTab() {
  return (
    <PageBoard layout={KOBO_BOARD} stackGap="gap-4" sections={{
      device: <KoboDeviceCard />,
      sleep: <SleepScreenCard />,
      settings: <KoboSettingsCard />,
      menu: <MenuOrderCard />,
      asked: <AskedCard />,
    }} />
  )
}
