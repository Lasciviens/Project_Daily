import { useState } from 'react'
import { ErrorLogTab } from '../components/ErrorLogTab'
import { ActivityLogTab } from '../components/ActivityLogTab'

type Tab = 'activity' | 'errors'

const TABS: { id: Tab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'errors',   label: 'Errors'   },
]

export function DeveloperPage() {
  const [tab, setTab] = useState<Tab>('activity')

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-bold text-ink-900">Developer</h1>
        <div className="flex gap-0.5 p-0.5 bg-cream-50 border border-ink-200 rounded-lg">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 min-h-[44px] rounded-md text-xs font-semibold transition-colors ${
                tab === t.id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'activity' && <ActivityLogTab />}
      {tab === 'errors'   && <ErrorLogTab />}
    </div>
  )
}
