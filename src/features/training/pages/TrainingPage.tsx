import { useState } from 'react'
import { HevyTab } from '../components/HevyTab'
import { StravaTab } from '../components/StravaTab'
import { HealthTab } from '../components/HealthTab'
import { HevySyncButton } from '../components/HevySyncButton'
import { TrainingCalendar } from '../components/TrainingCalendar'
import { NextSessionBanner } from '../components/NextSessionBanner'
import { HealthStatsPanel } from '../components/health/HealthStatsPanel'
import type { SectionId } from '../components/health/sectionTypes'

type Tab = 'hevy' | 'strava' | 'health'

const TAB_LABELS: Record<Tab, string> = { hevy: 'Hevy', strava: 'Strava', health: 'Health' }

// Royalty-free training photo (Unsplash license) used as a faint header backdrop.
const HEADER_BG =
  'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=60'

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')
  const [healthSection, setHealthSection] = useState<SectionId>('overview')

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

          {/* Hevy / Strava / Health pills */}
          <div className="flex gap-0.5 p-0.5 bg-white/70 backdrop-blur rounded-lg border border-ink-200">
            {(['hevy', 'strava', 'health'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors duration-150 min-h-[44px] ${
                  tab === t
                    ? 'bg-ink-900 text-white'
                    : 'bg-transparent text-ink-600 hover:text-ink-900'
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Sync + settings — left, beside the tabs (Hevy only) */}
          {tab === 'hevy' && <HevySyncButton iconOnly />}
        </div>
      </div>

      {/* Content (left, sized) + calendar pinned to the right edge */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className={`w-full lg:max-w-4xl min-w-0 ${tab === 'health' ? '2xl:max-w-none 2xl:flex-1' : ''}`}>
          <NextSessionBanner />
          {tab === 'hevy'   && <HevyTab />}
          {tab === 'strava' && <StravaTab />}
          {tab === 'health' && <HealthTab section={healthSection} onSectionChange={setHealthSection} />}
        </div>

        {/* Hevy/Strava: training calendar, always relevant. Health: the
            calendar isn't useful here, so this space becomes a short
            (non-AI, plain computed) stats/analysis panel for whichever
            Health section is active instead. */}
        <div className="w-full lg:w-[440px] lg:flex-shrink-0">
          {tab === 'health' ? <HealthStatsPanel section={healthSection} /> : <TrainingCalendar />}
        </div>
      </div>
    </div>
  )
}
