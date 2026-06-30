import { useState } from 'react'
import { HevyTab } from '../components/HevyTab'
import { StravaTab } from '../components/StravaTab'
import { HevySyncButton } from '../components/HevySyncButton'
import { TrainingCalendar } from '../components/TrainingCalendar'
import { NextSessionBanner } from '../components/NextSessionBanner'

type Tab = 'hevy' | 'strava'

// Royalty-free training photo (Unsplash license) used as a faint header backdrop.
const HEADER_BG =
  'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=60'

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Full-width header banner with faint training backdrop */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-200 mb-6 w-full min-h-[88px] sm:min-h-[96px]">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${HEADER_BG})` }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-r from-cream-50/85 via-cream-50/55 to-cream-50/20" aria-hidden />

        <div className="relative z-10 flex min-h-[88px] sm:min-h-[96px] items-center gap-2 flex-wrap px-4 py-4 sm:px-5">
          <h1 className="text-lg font-bold text-ink-900">Training</h1>

          {/* Hevy / Strava pills */}
          <div className="flex gap-0.5 p-0.5 bg-white/70 backdrop-blur rounded-lg border border-ink-200">
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

          {/* Sync + settings — left, beside the tabs (Hevy only) */}
          {tab === 'hevy' && <HevySyncButton iconOnly />}
        </div>
      </div>

      {/* Content (left, sized) + calendar pinned to the right edge */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="w-full lg:max-w-4xl min-w-0">
          <NextSessionBanner />
          {tab === 'hevy'   && <HevyTab />}
          {tab === 'strava' && <StravaTab />}
        </div>

        {/* Calendar — independent of the active tab, always present on the right */}
        <div className="w-full lg:w-[440px] lg:flex-shrink-0">
          <TrainingCalendar />
        </div>
      </div>
    </div>
  )
}
