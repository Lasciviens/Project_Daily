import { useState } from 'react'
import { ErrorLogTab } from '../components/ErrorLogTab'
import { ActivityLogTab } from '../components/ActivityLogTab'
import { reindexAiSearch } from '../../ai/api/aiApi'
import { toast } from '../../../app/store'

type Tab = 'activity' | 'errors'

const TABS: { id: Tab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'errors',   label: 'Errors'   },
]

export function DeveloperPage() {
  const [tab, setTab] = useState<Tab>('activity')
  const [reindexing, setReindexing] = useState(false)

  async function handleReindex() {
    if (reindexing) return
    setReindexing(true)
    const tid = toast.loading('Reindexing AI search…')
    try {
      const r = await reindexAiSearch()
      toast.dismiss(tid); toast.success(`AI search reindexed ✓ (${r.indexed} items)`)
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Reindex failed')
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="max-w-4xl px-4 sm:px-6 lg:px-8 pt-3 pb-6 sm:py-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-bold text-ink-900">Developer</h1>
        <div className="flex gap-0.5 p-0.5 bg-cream-50 border border-ink-200 rounded-lg">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 min-h-[44px] rounded-md text-xs font-semibold transition-colors ${
                tab === t.id ? 'bg-ink-950 text-white' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Rebuild the semantic-search index over the user's own text so the
            AI's semantic_search tool can find it (recipes/coach/notes/memory). */}
        <button
          onClick={handleReindex}
          disabled={reindexing}
          title="Rebuild the AI semantic-search index"
          className="ml-auto min-h-[44px] px-3 rounded-lg text-xs font-semibold border border-ink-200 text-ink-600 hover:bg-cream-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <span className={reindexing ? 'inline-block animate-spin' : ''}>⟳</span>
          Reindex AI search
        </button>
      </div>

      {tab === 'activity' && <ActivityLogTab />}
      {tab === 'errors'   && <ErrorLogTab />}
    </div>
  )
}
