import { useState } from 'react'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { HealthTab } from '../components/HealthTab'
import { HealthStatsPanel } from '../components/HealthStatsPanel'
import type { SectionId, HealthRange } from '../components/sectionTypes'
import { useAnchorDate } from '../components/useAnchorDate'
import type { Period } from '../components/PeriodToggle'

// Health's own page (it used to be the third tab of Training). Apple Health
// data via Health Auto Export; see CLAUDE.md → Health data.
export function HealthPage() {
  const [section, setSection] = useState<SectionId>('overview')
  const [anchor, setAnchor] = useAnchorDate()
  const [period, setPeriod] = useState<Period>('week')
  const range: HealthRange = { anchor, setAnchor, period, setPeriod }

  return (
    <PageContainer width="full">
      <PageHeader title="Health" className="2xl:max-w-[117rem]" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-start lg:gap-6">
        <div className="w-full min-w-0 lg:max-w-4xl 2xl:max-w-[88rem] 2xl:flex-1">
          <HealthTab section={section} onSectionChange={setSection} range={range} />
        </div>
        <aside className="flex w-full flex-col gap-4 lg:w-[440px] lg:flex-shrink-0">
          <HealthStatsPanel section={section} range={range} />
        </aside>
      </div>
    </PageContainer>
  )
}
