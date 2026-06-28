import { useState } from 'react'
import { ProgramsTab } from '../components/ProgramsTab'
import { HevyTab } from '../components/HevyTab'
import { StravaTab } from '../components/StravaTab'

type Tab = 'hevy' | 'strava' | 'programs'

const TABS: { key: Tab; label: string }[] = [
  { key: 'hevy',     label: 'Hevy'     },
  { key: 'strava',   label: 'Strava'   },
  { key: 'programs', label: 'Programs' },
]

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-ink-900">Training</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 bg-ink-100 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 min-h-[44px] ${
              tab === t.key
                ? 'bg-ink-900 text-white'
                : 'bg-transparent text-ink-600 hover:text-ink-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'hevy'     && <HevyTab />}
      {tab === 'strava'   && <StravaTab />}
      {tab === 'programs' && <ProgramsTab />}
    </div>
  )
}
