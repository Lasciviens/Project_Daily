import { useSearchParams } from 'react-router-dom'
import { PageBoard, PageContainer, PageHeader } from '../../../shared/ui'
import { DeliveryList } from '../components/DeliveryList'
import { KoboSetupCard } from '../components/KoboSetupCard'
import { LibraryTab } from '../components/LibraryTab'
import { ReadingTab } from '../components/ReadingTab'
import { SendToKoboCard } from '../components/SendToKoboCard'
import { useDeliveries, useKoboFeedState } from '../hooks/useBooks'
import { BOOK_BOARD } from '../booksBoard'

type Tab = 'library' | 'reading' | 'send'
const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'reading', label: 'Reading' },
  { id: 'send', label: 'Send to Kobo' },
]

/** Books — the library, reading time from the Kobo, and Send to Kobo (docs/kobo/PLAN.md Phases 2–4). */
export function BooksPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') as Tab : 'library'
  const select = (next: Tab) => setParams(p => { p.set('tab', next); return p }, { replace: true })
  return (
    <PageContainer>
      <PageHeader title="Books">
        <div role="tablist" aria-label="Books sections" className="scroll-x -mx-4 flex gap-1 px-4 sm:mx-0 sm:px-0">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => select(t.id)} className="pill-tab">
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>
      {tab === 'library' && <LibraryTab />}
      {tab === 'reading' && <ReadingTab />}
      {tab === 'send' && <SendTab />}
    </PageContainer>
  )
}

function SendTab() {
  const deliveries = useDeliveries()
  const state = useKoboFeedState()
  const rows = deliveries.data ?? []
  const waiting = rows.filter(r => r.status === 'queued' || r.status === 'downloaded').reduce((s, r) => s + r.size_bytes, 0)
  return (
    <PageBoard layout={BOOK_BOARD} stackGap="gap-4" sections={{
      send: <SendToKoboCard waitingBytes={waiting} />,
      inbox: <DeliveryList rows={rows} loading={deliveries.isLoading} />,
      setup: <KoboSetupCard state={state.data} />,
    }} />
  )
}
