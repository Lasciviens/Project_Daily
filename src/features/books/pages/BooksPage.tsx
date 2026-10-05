import { useSearchParams } from 'react-router-dom'
import { PageBoard, PageContainer, PageHeader } from '../../../shared/ui'
import { DeliveryList } from '../components/DeliveryList'
import { KoboSetupCard } from '../components/KoboSetupCard'
import { KoboTab } from '../components/kobo/KoboTab'
import { LibraryTab } from '../components/LibraryTab'
import { StatsTab } from '../components/StatsTab'
import { SendToKoboCard } from '../components/SendToKoboCard'
import { useDeliveries, useKoboFeedState } from '../hooks/useBooks'
import { BOOK_BOARD } from '../booksBoard'

type Tab = 'library' | 'stats' | 'send' | 'kobo'
const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'stats', label: 'Stats' },
  { id: 'send', label: 'Send to Kobo' },
  { id: 'kobo', label: 'Kobo' },
]

/** Books — the library, reading statistics from the Kobo, Send to Kobo, and the Kobo itself (docs/kobo/PLAN.md). */
export function BooksPage() {
  const [params, setParams] = useSearchParams()
  // ?tab=reading was the Stats tab's old name (Daily's Reading card and old links).
  const asked = params.get('tab') === 'reading' ? 'stats' : params.get('tab')
  const tab: Tab = TABS.some(t => t.id === asked) ? asked as Tab : 'library'
  // A tab starts clean: the other tabs' own address parts (view, section, area…) are dropped.
  const select = (next: Tab) => setParams(() => new URLSearchParams({ tab: next }), { replace: true })
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
      {tab === 'stats' && <StatsTab />}
      {tab === 'send' && <SendTab />}
      {tab === 'kobo' && <KoboTab />}
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
