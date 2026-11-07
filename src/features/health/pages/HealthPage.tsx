import { Suspense } from 'react'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { useHealthProfile } from '../../training/hooks/useAthleteProfile'
import { HealthRangeBar } from '../components/HealthRangeBar'
import { useRangeWindow } from '../components/dateNavModel'
import { HEALTH_SECTIONS } from '../components/sectionTypes'
import { OVERVIEW_BOARD } from '../healthBoards'
import { HealthProfileCard } from '../components/profile/HealthProfileCard'
import { useHealthPageRange } from '../components/overview/useHealthPageRange'
import { useHealthSection } from '../components/overview/useHealthSection'
import { useHealthHero } from '../components/overview/useHealthHero'
import { HealthHero } from '../components/overview/HealthHero'
import { HealthInsightsCard } from '../components/overview/HealthInsightsCard'
import { HealthSectionTabs, SectionPanel } from '../components/overview/SectionPanel'
import { HealthGuard as Guard } from '../components/HealthGuard'
import { HealthHeroArt } from '../components/HealthHeroArt'

// Health's own page, in windows (tabs) laid out by the metric ranking
// (docs/training-health/research/research-rank.json): Overview holds the six
// tier-1 tiles and the insights; every group then has its own window, and
// tier-3 metrics appear as compact cards only when they have data (tier 4
// left out). No composite health score (house rule). ONE day + period bar
// directly under the tabs, kept in the URL (?date=&period=), drives every
// window except Goal progress (its own window); the open window is ?section=. Only the open window mounts, so a window's
// queries run when you open it. (The alerts strip from the plan needs Health
// Auto Export's notification arrays ingested first — not built.)
//
// Overview is in the page's own code; the other windows (HealthSectionWindows.tsx)
// load when one opens, and in idle time once the page shows: their charts
// were most of the page's first download.
const HealthSectionWindow = lazyPart('health-windows', () => import('../components/HealthSectionWindows').then(m => m.HealthSectionWindow))
const OTHER_WINDOWS = [HealthSectionWindow]

export function HealthPage() {
  const range = useHealthPageRange()
  const { anchor, setAnchor, period, setPeriod, today } = range
  const [section, setSection] = useHealthSection()
  const win = useRangeWindow(range)
  const hero = useHealthHero(win)
  const { data: profile } = useHealthProfile()
  const profileIncomplete = profile != null && (profile.birthYear == null || profile.sex == null || profile.heightCm == null)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const label = HEALTH_SECTIONS.find(s => s.id === section)?.label ?? 'Health'
  useIdlePreload(OTHER_WINDOWS)

  return (
    <PageContainer>
      {/* The section tabs, then the ONE period + date bar directly under them
          (hidden on Goal progress, which reads its own 14/28/56-day window and
          shows those dates itself). Each window below is a PageBoard
          (healthBoards.ts), so a wide screen adds columns instead of length. */}
      <PageHeader title="Health" className="!mb-3" art={<HealthHeroArt />}>
        <HealthSectionTabs value={section} onChange={setSection} />
      </PageHeader>

      <div className="flex flex-col gap-4">
        {section !== 'goal' && (
          <HealthRangeBar period={period} setPeriod={setPeriod} anchor={anchor} setAnchor={setAnchor} today={today} />
        )}

        {/* Keyed by window so switching away resets one that crashed. */}
        <Guard key={section} name={label}>
          {section === 'overview' ? (
            <SectionPanel id="overview" layout={OVERVIEW_BOARD} stackGap="gap-4" sections={{
              hero: <Guard name="Hero"><HealthHero hero={hero} onViewDay={viewDay} onOpenSection={setSection} /></Guard>,
              profile: profileIncomplete && <HealthProfileCard />,
              insights: <Guard name="Insights"><HealthInsightsCard hero={hero} /></Guard>,
            }} />
          ) : (
            <Suspense fallback={<div aria-busy="true" />}>
              <HealthSectionWindow section={section} range={range} win={win} hero={hero} onViewDay={viewDay} onOpenSection={setSection} />
            </Suspense>
          )}
        </Guard>
      </div>
    </PageContainer>
  )
}
