import { PageBoard, PageContainer, PageHeader, type BoardLayouts } from '../../../shared/ui'
import { NotificationList } from '../components/NotificationList'

// One bounded list, so the page stops after it: a 42rem-capped stack at every width (THEME §6.3).
type NotificationsSection = 'list'
const NOTIFICATIONS_BOARD: BoardLayouts<NotificationsSection> = { 1: ['list'] }

/** /notifications — every notification, newest first: the bell's "See all" (the same list as its drop-down). */
export function NotificationsPage() {
  return (
    <PageContainer>
      <PageHeader title="Notifications" />
      <PageBoard sections={{ list: <NotificationList mode="page" /> }} layout={NOTIFICATIONS_BOARD} stackClassName="max-w-2xl" />
    </PageContainer>
  )
}
