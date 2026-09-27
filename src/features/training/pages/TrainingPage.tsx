import { useEffect, useRef, useState } from 'react'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { HevyTab } from '../components/HevyTab'
import { PTCoachTab } from '../components/PTCoachTab'
import { StravaTab } from '../components/StravaTab'
import { HevySyncButton } from '../components/HevySyncButton'
import { TrainingCalendar } from '../components/TrainingCalendar'
import { NextSessionBanner } from '../components/NextSessionBanner'

type Tab = 'hevy' | 'strava' | 'coach'

const TABS: { id: Tab; label: string }[] = [
  { id: 'hevy', label: 'Hevy' },
  { id: 'strava', label: 'Strava' },
  { id: 'coach', label: 'Coach' },
]

export function TrainingPage() {
  const [tab, setTab] = useState<Tab>('hevy')
  // The active pill is always scrolled into view rather than hidden under the
  // pinned sync buttons on a narrow phone.
  const activePillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  // Hevy fills the space up to the calendar rail on big monitors — routine
  // cards with exercise GIFs need the room.
  const wide = tab === 'hevy'

  return (
    <PageContainer width="full">
      {/* Ends where the content column + rail end, not at the viewport edge. */}
      <PageHeader title="Training" className="2xl:max-w-[117rem]">
        {/* Phones: the tabs get the whole row (all four fit) and the sync
            actions wrap under them, so no tab is cut off against a button. */}
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <div role="tablist" aria-label="Training sections" className="scroll-x -mx-4 flex min-w-0 basis-[calc(100%+2rem)] gap-1 px-4 sm:mx-0 sm:basis-auto sm:flex-1 sm:px-0">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                ref={tab === t.id ? activePillRef : undefined}
                onClick={() => setTab(t.id)}
                className="pill-tab shrink-0"
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'hevy' && <span className="ml-auto shrink-0 sm:ml-0"><HevySyncButton /></span>}
        </div>
      </PageHeader>

      {/* Content (left, sized) + a right rail: the calendar, or the Health
          stats panel for the active Health section. Next Session sits under
          the rail rather than as a full-width band. */}
      {/* The rail follows the content column (never pinned to the far
          viewport edge), and the wide tabs grow only up to 88rem. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-start lg:gap-6">
        <div className={`w-full min-w-0 lg:max-w-4xl ${wide ? '2xl:max-w-[88rem] 2xl:flex-1' : ''}`}>
          {tab === 'hevy'   && <HevyTab />}
          {tab === 'strava' && <StravaTab />}
          {tab === 'coach'  && <PTCoachTab />}
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-[440px] lg:flex-shrink-0">
          <TrainingCalendar />
          <NextSessionBanner />
        </aside>
      </div>
    </PageContainer>
  )
}
