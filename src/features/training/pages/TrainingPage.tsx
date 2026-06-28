import { useState } from 'react'
import { HevyTab } from '../components/HevyTab'
import { StravaTab } from '../components/StravaTab'
import { HevySyncButton } from '../components/HevySyncButton'

type Tab = 'hevy' | 'strava'

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')

  return (
    <div className="px-3 py-3">
      {/* Compact header row */}
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-base font-bold text-ink-900">Training</h1>

        {/* Hevy / Strava pills */}
        <div className="flex gap-0.5 p-0.5 bg-ink-100 rounded-lg">
          {(['hevy', 'strava'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors duration-150 min-h-[44px] ${
                tab === t
                  ? 'bg-ink-900 text-white'
                  : 'bg-transparent text-ink-600 hover:text-ink-900'
              }`}
            >
              {t === 'hevy' ? 'Hevy' : 'Strava'}
            </button>
          ))}
        </div>

        {/* Sync — icon-only, appears only on Hevy tab */}
        {tab === 'hevy' && (
          <div className="ml-auto">
            <HevySyncButton iconOnly />
          </div>
        )}
      </div>

      {tab === 'hevy'   && <HevyTab />}
      {tab === 'strava' && <StravaTab />}
    </div>
  )
}
