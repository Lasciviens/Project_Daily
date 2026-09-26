import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { ErrorLogTab } from '../components/ErrorLogTab'
import { ActivityLogTab } from '../components/ActivityLogTab'
import { MemoryTab } from '../components/MemoryTab'
import { ConnectionsTab } from '../components/ConnectionsTab'
import { reindexAiSearch } from '../../ai/api/aiApi'
import { toast } from '../../../app/store'
import { Button, PageContainer, PageHeader } from '../../../shared/ui'

type Tab = 'connections' | 'activity' | 'errors' | 'memory'

const TABS: { id: Tab; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'activity',    label: 'Activity' },
  { id: 'errors',      label: 'Errors' },
  { id: 'memory',      label: 'Memory' },
]

export function DeveloperPage() {
  // ?tab=connections lets the settings menu (and any future link) deep-link
  // straight to one tab instead of always landing on Activity.
  const [params, setParams] = useSearchParams()
  const initial = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') as Tab : 'activity'
  const [tab, setTab] = useState<Tab>(initial)
  const [reindexing, setReindexing] = useState(false)

  function selectTab(next: Tab) {
    setTab(next)
    setParams(p => { p.set('tab', next); return p }, { replace: true })
  }

  // Rebuilds the semantic-search index over the user's own text so the AI's
  // semantic_search tool can find it (a plain api call, not a mutation).
  async function handleReindex() {
    if (reindexing) return
    setReindexing(true)
    const tid = toast.loading('Reindexing AI search…')
    try {
      const r = await reindexAiSearch()
      toast.dismiss(tid); toast.success(`AI search reindexed (${r.indexed} items)`)
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message || 'Reindex failed')
    } finally {
      setReindexing(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Developer"
        actions={
          <Button size="sm" icon={<RefreshCw />} onClick={() => { void handleReindex() }} loading={reindexing} title="Rebuild the AI semantic-search index">
            Reindex AI search
          </Button>
        }
      >
        <div role="tablist" aria-label="Developer sections" className="scroll-x -mx-4 flex gap-1 px-4 sm:mx-0 sm:px-0">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => selectTab(t.id)} className="pill-tab">
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'activity'    && <ActivityLogTab />}
      {tab === 'errors'      && <ErrorLogTab />}
      {tab === 'memory'      && <MemoryTab />}
    </PageContainer>
  )
}
