import { useEffect, useRef } from 'react'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { todayStr } from '../../../shared/utils/dateUtils'
import { ActivityRings } from './ActivityRings'
import { HealthWorkoutsList } from './HealthWorkoutsList'
import { StepsSection } from './StepsSection'
import { EnergySection } from './EnergySection'
import { HeartSection } from './HeartSection'
import { SleepSection } from './SleepSection'
import { BodySection } from './BodySection'
import { SECTIONS, type SectionId, type HealthRange } from './sectionTypes'
import { DateNav } from './DateNav'
import { PeriodToggle } from './PeriodToggle'
import { labelForAnchor, stepAnchor, useRangeWindow } from './dateNav'

// Apple Health browse view: activity rings + one section per metric group.
// The page owns section, day and period ONCE and passes them in (the old
// uncontrolled fallback ran a second anchor timer, T37).

interface Props {
  section: SectionId
  onSectionChange: (s: SectionId) => void
  range: HealthRange
}

export function HealthTab({ section, onSectionChange, range }: Props) {
  const { anchor, setAnchor, period, setPeriod } = range
  const today = todayStr()
  const win = useRangeWindow(range)

  // The pill strip scrolls on a phone and the right-edge fade paints over
  // whatever sits under it — keep the ACTIVE pill scrolled into view.
  const activePillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [section])

  const label = SECTIONS.find(s => s.id === section)?.label ?? 'Health'

  return (
    <div className="flex flex-col gap-4">
      {/* The ONE day/period control for every section. Changing the period
          keeps the day you were looking at (it used to jump back to today). */}
      <div className="flex flex-wrap items-center gap-2">
        <DateNav
          label={labelForAnchor(period, anchor)}
          onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
          canGoNext={anchor < today}
          value={anchor}
          onPick={d => setAnchor(d > today ? today : d)}
        />
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      <div role="tablist" aria-label="Health sections" className="scroll-x -mx-1 flex gap-1 px-1">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            ref={section === s.id ? activePillRef : undefined}
            onClick={() => onSectionChange(s.id)}
            className="pill-tab shrink-0 gap-1.5 px-3"
          >
            <s.icon className="h-4 w-4" aria-hidden />{s.label}
          </button>
        ))}
      </div>

      {/* Each section renders free-form HAE data; a bad field stays inside
          its own card instead of blanking the page (H-23). Keyed by section so
          switching away resets a crashed one. */}
      <ErrorBoundary key={section} label={label} action={`health_section_${section}`}>
        {section === 'overview' && (
          <div className="flex flex-col gap-3">
            <ActivityRings win={win} date={anchor} />
            <HealthWorkoutsList win={win} />
          </div>
        )}
        {section === 'steps'  && <StepsSection  range={range} />}
        {section === 'energy' && <EnergySection range={range} />}
        {section === 'heart'  && <HeartSection  range={range} />}
        {section === 'sleep'  && <SleepSection  range={range} />}
        {section === 'body'   && <BodySection   range={range} />}
      </ErrorBoundary>
    </div>
  )
}
