import { Link } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { PageBoard, PageContainer, PageHeader, type BoardLayouts } from '../../../shared/ui'
import { NotificationList } from '../components/NotificationList'

// One bounded list, so the page stops after it: a 42rem-capped stack at every width (THEME §6.3).
type NotificationsSection = 'list'
const NOTIFICATIONS_BOARD: BoardLayouts<NotificationsSection> = { 1: ['list'] }

/** /notifications — every notification, newest first: the bell's "See all" (the same list as its drop-down). */
export function NotificationsPage() {
  return (
    <PageContainer>
      <PageHeader title="Notifications" actions={
        <Link to="/settings?tab=notifications" className="btn-secondary btn-sm" title="Settings: where each notification goes"
          aria-label="Settings: where each notification goes">
          <Settings2 className="h-4 w-4" aria-hidden />Settings
        </Link>
      } />
      <PageBoard sections={{ list: <NotificationList mode="page" /> }} layout={NOTIFICATIONS_BOARD} stackClassName="max-w-2xl" />
    </PageContainer>
  )
}
