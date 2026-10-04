import { PageBoard, PageContainer, PageHeader } from '../../../shared/ui'
import { DeliveryList } from '../components/DeliveryList'
import { KoboSetupCard } from '../components/KoboSetupCard'
import { SendToKoboCard } from '../components/SendToKoboCard'
import { useDeliveries, useKoboFeedState } from '../hooks/useBooks'
import { BOOK_BOARD } from '../booksBoard'

/** Books — Send to Kobo (docs/kobo/PLAN.md roadmap Phase 2). The library and reading stats come in Phases 3–4. */
export function BooksPage() {
  const deliveries = useDeliveries()
  const state = useKoboFeedState()
  const rows = deliveries.data ?? []
  const waiting = rows.filter(r => r.status === 'queued' || r.status === 'downloaded').reduce((s, r) => s + r.size_bytes, 0)
  return (
    <PageContainer>
      <PageHeader title="Books" />
      <PageBoard layout={BOOK_BOARD} stackGap="gap-4" sections={{
        send: <SendToKoboCard waitingBytes={waiting} />,
        inbox: <DeliveryList rows={rows} loading={deliveries.isLoading} />,
        setup: <KoboSetupCard state={state.data} />,
      }} />
    </PageContainer>
  )
}
