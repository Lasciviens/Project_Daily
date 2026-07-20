import { useState } from 'react'
import { HevyTab } from '../components/HevyTab'
import { PTCoachTab } from '../components/PTCoachTab'
import { StravaTab } from '../components/StravaTab'
import { HealthTab } from '../components/HealthTab'
import { HevySyncButton } from '../components/HevySyncButton'
import { TrainingCalendar } from '../components/TrainingCalendar'
import { NextSessionBanner } from '../components/NextSessionBanner'
import { HealthStatsPanel } from '../components/health/HealthStatsPanel'
import type { SectionId } from '../components/health/sectionTypes'

type Tab = 'hevy' | 'strava' | 'health' | 'coach'
type HevySub = 'workouts' | 'routines' | 'prs' | 'muscles' | 'body' | 'exercises'

const TAB_LABELS: Record<Tab, string> = { hevy: 'Hevy', strava: 'Strava', health: 'Health', coach: '🧠 Coach' }

// Royalty-free training photo (Unsplash license) used as a faint header backdrop.
const HEADER_BG =
  'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=60'

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')
  const [healthSection, setHealthSection] = useState<SectionId>('overview')
  const [hevySub, setHevySub] = useState<HevySub>('workouts')
  void hevySub // sub-tab no longer affects layout width, but the callback contract stays

  // Hevy + Health both fill the space up to the calendar rail on big
  // monitors now — routine cards with exercise GIFs need the room.
  const wide = tab === 'health' || tab === 'hevy'

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* Header — ONE compact row on every size (title · scrollable tab pills ·
          sync). The faint training photo backdrop is desktop-only; on mobile
          it's dropped and the tall min-height removed to reclaim vertical space
          (the banner used to stack 2-3 rows tall on a phone). */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-200 mb-4 w-full">
        <div
          className="hidden sm:block absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${HEADER_BG})` }}
          aria-hidden
        />
        <div className="hidden sm:block absolute inset-0 bg-gradient-to-r from-cream-50/85 via-cream-50/55 to-cream-50/20" aria-hidden />

        <div className="relative z-10 flex items-center gap-2 px-3 py-2.5 sm:px-5 sm:py-4">
          <h1 className="text-lg font-bold text-ink-900 shrink-0">Training</h1>

          {/* Hevy / Strava / Health / Coach pills — horizontal-scroll so they
              never wrap under the title on a narrow phone. */}
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <div className="inline-flex gap-0.5 p-0.5 bg-cream-50/70 backdrop-blur rounded-lg border border-ink-200">
              {(['hevy', 'strava', 'health', 'coach'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`shrink-0 whitespace-nowrap px-3 rounded-md text-xs font-semibold capitalize transition-colors duration-150 min-h-[44px] ${
                    tab === t
                      ? 'bg-ink-950 text-white'
                      : 'bg-transparent text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Sync (Hevy only) — pinned right, never wraps */}
          {tab === 'hevy' && <span className="shrink-0"><HevySyncButton iconOnly /></span>}
        </div>
      </div>

      {/* Content (left, sized) + calendar pinned to the right edge */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className={`w-full lg:max-w-4xl min-w-0 ${wide ? '2xl:max-w-none 2xl:flex-1' : ''}`}>
          {tab === 'hevy'   && <HevyTab onSubTabChange={setHevySub} />}
          {tab === 'strava' && <StravaTab />}
          {tab === 'health' && <HealthTab section={healthSection} onSectionChange={setHealthSection} />}
          {tab === 'coach'  && <PTCoachTab />}
        </div>

        {/* Hevy/Strava: training calendar, always relevant. Health: the
            calendar isn't useful here, so this space becomes a short
            (non-AI, plain computed) stats/analysis panel for whichever
            Health section is active instead. Next Session lives UNDER the
            calendar (per request) — it was a full-width band above the
            content for one line of text, the exact width waste being
            standardised away. */}
        <div className="w-full lg:w-[440px] lg:flex-shrink-0 flex flex-col gap-4">
          {tab === 'health' ? <HealthStatsPanel section={healthSection} /> : <TrainingCalendar />}
          <NextSessionBanner />
        </div>
      </div>
    </div>
  )
}
